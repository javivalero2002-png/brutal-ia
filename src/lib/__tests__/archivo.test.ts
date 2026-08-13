import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'

// ─────────────────────────────────────────────────────────────────────────────
// /api/archivo — el enlace estable a un fichero del Storage.
//
// Existe porque MemoriaSection guarda el enlace del documento DENTRO del texto de
// la nota, y eso no se puede firmar al leer sin parsear texto libre. La nota
// apunta aquí, y aquí se comprueba la sesión y se redirige a una firma fresca.
//
// Es una ruta que REDIRIGE a donde diga un parámetro de la URL, así que tiene dos
// formas de salir mal y las dos se fijan aquí:
//   · servir un fichero a quien no ha iniciado sesión;
//   · convertirse en un redirector abierto — un enlace de brutalia.tech que lleva
//     a donde quiera el atacante, que es lo que hace creíble un phishing.
// ─────────────────────────────────────────────────────────────────────────────

const RUTA = 'src/app/api/archivo/route.ts'
let src = ''
beforeAll(() => { src = readFileSync(RUTA, 'utf8') })

describe('/api/archivo · no sirve nada sin sesión', () => {
  it('resuelve al usuario antes de mirar el parámetro', () => {
    const posAuth = src.indexOf('auth.getUser()')
    const posParam = src.indexOf("searchParams.get('u')")
    expect(posAuth, 'la ruta no resuelve al usuario').toBeGreaterThan(-1)
    expect(posParam, 'la ruta no lee el parámetro').toBeGreaterThan(-1)
    expect(posAuth, 'lee el parámetro antes de comprobar la sesión').toBeLessThan(posParam)
  })

  it('corta con 401 si no hay usuario', () => {
    expect(/if \(!user\)[\s\S]*401/.test(src.slice(0, src.indexOf("searchParams.get('u')")))).toBe(true)
  })
})

describe('/api/archivo · no puede ser un redirector abierto', () => {
  // Se exige la GUARDA entera, no que la palabra aparezca: con solo buscar el
  // identificador, cambiar la condicion por `if (false)` dejaba el import intacto
  // y el test pasaba. Comprobado reintroduciendo ese cambio exacto.
  it('valida el destino contra el Storage propio', () => {
    expect(/if\s*\(\s*!\s*isOwnStorageUrl\s*\(/.test(src),
      'no hay guarda real: cualquiera con sesión podría hacer que brutalia.tech redirija a donde quiera').toBe(true)
  })

  it('la guarda corta con 400, no sigue adelante', () => {
    const i = src.search(/if\s*\(\s*!\s*isOwnStorageUrl\s*\(/)
    expect(i).toBeGreaterThan(-1)
    expect(/return [\s\S]*400/.test(src.slice(i, i + 320)), 'la guarda no devuelve 400').toBe(true)
  })

  it('valida ANTES de redirigir', () => {
    expect(src.indexOf('isOwnStorageUrl')).toBeLessThan(src.indexOf('NextResponse.redirect'))
  })

  it('la redirección no se puede cachear: la firma caduca', () => {
    // Un 301/308 dejaría al navegador reusando para siempre una firma de 1 hora.
    expect(/status:\s*30[178]/.test(src) && !/status:\s*30[18]\b/.test(src.replace('307', '')))
      .toBe(true)
    expect(/no-store/.test(src), 'falta Cache-Control: no-store').toBe(true)
  })
})

describe('Memoria · el enlace guardado no puede ser una firma que caduca', () => {
  const MEMORIA = 'src/components/sections/MemoriaSection.tsx'

  it('la nota apunta a /api/archivo, no al Storage', () => {
    const m = readFileSync(MEMORIA, 'utf8')
    const linea = m.split('\n').find(l => l.includes('📎 Documento:')) || ''
    expect(linea, 'no se encontró la línea que compone la nota del documento').not.toBe('')
    expect(/\/api\/archivo/.test(linea),
      'guarda la URL del Storage directamente: caduca en 1 h si es firmada, y muere al cerrar el bucket si es pública').toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// isOwnStorageUrl, probada de verdad y no solo "aparece en el fichero".
//
// Las reglas de arriba comprueban que la GUARDA está puesta. Esto comprueba que
// la guarda sirve para algo, que es una pregunta distinta: decide a dónde hace
// `fetch` el servidor y a dónde redirige /api/archivo.
// ─────────────────────────────────────────────────────────────────────────────
describe('isOwnStorageUrl · qué deja pasar de verdad', () => {
  // `supabaseHost()` lee la variable EN CADA llamada, así que se fija aquí: en
  // los tests no hay .env y sin ella la función devuelve false para todo — que es
  // el fail-closed correcto, pero deja el test sin comprobar nada.
  const HOST = 'ejemplo.supabase.co'
  beforeAll(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${HOST}` })

  it('acepta un objeto del Storage, público o firmado', async () => {
    const { isOwnStorageUrl } = await import('@/lib/safeFetch')
    expect(isOwnStorageUrl(`https://${HOST}/storage/v1/object/public/content-videos/docs/a.pdf`)).toBe(true)
    expect(isOwnStorageUrl(`https://${HOST}/storage/v1/object/sign/content-videos/docs/a.pdf?token=x`)).toBe(true)
  })

  it('rechaza otro host, aunque lo lleve dentro', async () => {
    const { isOwnStorageUrl } = await import('@/lib/safeFetch')
    expect(isOwnStorageUrl('https://malo.example/storage/v1/object/public/x')).toBe(false)
    // El clásico: el host propio metido en el userinfo o en la ruta de otro.
    expect(isOwnStorageUrl(`https://${HOST}.malo.example/storage/v1/object/public/x`)).toBe(false)
    expect(isOwnStorageUrl(`https://malo.example/?x=https://${HOST}/storage/v1/object/public/x`)).toBe(false)
  })

  it('rechaza http, que degradaría a red interna por nombre', async () => {
    const { isOwnStorageUrl } = await import('@/lib/safeFetch')
    expect(isOwnStorageUrl(`http://${HOST}/storage/v1/object/public/x`)).toBe(false)
  })

  // Lo que se añadió el 2026-08-13: el host no basta cuando el destino se usa
  // para REDIRIGIR. Aceptar cualquier ruta del host de Supabase convierte un
  // enlace de brutalia.tech en un salto a la API de Supabase.
  it('rechaza otras rutas del mismo host', async () => {
    const { isOwnStorageUrl } = await import('@/lib/safeFetch')
    expect(isOwnStorageUrl(`https://${HOST}/auth/v1/authorize?redirect_to=https://malo.example`)).toBe(false)
    expect(isOwnStorageUrl(`https://${HOST}/rest/v1/profiles?select=*`)).toBe(false)
  })

  it('rechaza lo que no es una URL', async () => {
    const { isOwnStorageUrl } = await import('@/lib/safeFetch')
    for (const v of [null, undefined, '', '   ', 42, {}, 'javascript:alert(1)', '//evil.example/x']) {
      expect(isOwnStorageUrl(v as unknown), `dejó pasar ${JSON.stringify(v)}`).toBe(false)
    }
  })
})
