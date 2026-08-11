import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// ─────────────────────────────────────────────────────────────────────────────
// Reglas estructurales de las rutas API.
//
// Las 58 rutas no tenían NINGÚN test, y son la barrera de seguridad de verdad:
// RLS es defensa en profundidad, pero quien decide qué puede hacer cada persona
// es el código de estas rutas.
//
// Estos tests no comprueban qué devuelve cada ruta —eso serían 58 tests que
// envejecen mal y no cubren la 59—: comprueban las REGLAS del proyecto sobre
// TODAS las rutas, incluidas las que se escriban mañana. Una ruta nueva que se
// salte una regla pone el build en rojo sin que nadie tenga que acordarse.
//
// Cada excepción va en una lista con su motivo escrito. Si algún día sobra, se
// nota: el test avisa de las entradas de la lista que ya no existen.
// ─────────────────────────────────────────────────────────────────────────────

const RAIZ = 'src/app/api'

function rutas(dir = RAIZ, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) rutas(p, out)
    else if (e === 'route.ts') out.push(p)
  }
  return out
}

const TODAS = rutas()
const leer = (f: string) => readFileSync(f, 'utf8')
const nombre = (f: string) => f.replace(`${RAIZ}/`, '').replace('/route.ts', '')

// ── Excepciones, cada una con su motivo ──────────────────────────────────────

/** No resuelven usuario porque su barrera es otra, no porque se olvidara. */
const SIN_SESION: Record<string, string> = {
  'cron/sync-colabs': 'la ejecuta Vercel, no una persona: se autentica con CRON_SECRET',
  'whatsapp': 'webhook entrante: valida la firma del proveedor, no una sesión',
  'review/[token]': 'página pública de revisión para clientes: el token ES la credencial',
  'auth/callback': 'canjea el código OAuth; todavía no hay sesión que resolver',
  'agenda/[id]/upload-video': 'devuelve 400 siempre — la subida de vídeos está desactivada',
}

describe('rutas API · toda ruta que use el service role resuelve antes al usuario', () => {
  // createAdminClient se salta RLS por completo. Usarlo sin haber resuelto quién
  // llama deja la tabla entera expuesta a cualquiera que sepa la URL. Ya pasó.
  it.each(TODAS.map(f => [nombre(f), f]))('%s', (_n, f) => {
    const s = leer(f)
    const usaAdmin = /createAdminClient|ctx\.admin/.test(s)
    if (!usaAdmin) return

    const resuelveUsuario = /getAuthCtx|requireOwner|auth\.getUser\(/.test(s)
    if (resuelveUsuario) return

    const motivo = SIN_SESION[nombre(f)]
    expect(motivo, `${nombre(f)} usa el service role sin resolver al usuario y no está en la lista de excepciones`).toBeTruthy()
  })
})

describe('rutas API · nadie puede ascenderse a owner', () => {
  // profiles.role es la ÚNICA señal de autorización del servidor. Si una ruta
  // deja que el rol llegue en el cuerpo de la petición, cualquiera se hace owner.
  const escribenProfiles = TODAS.filter(f => /from\('profiles'\)[\s\S]{0,120}(update|insert|upsert)\(/.test(leer(f)))

  it('hay rutas que escriben en profiles (si no, este test no protege nada)', () => {
    expect(escribenProfiles.length).toBeGreaterThan(0)
  })

  it.each(escribenProfiles.map(f => [nombre(f), f]))('%s no mete `role` sin comprobar quién llama', (_n, f) => {
    const s = leer(f)
    const tocaRole = /\brole\b\s*[,:]/.test(s)
    if (!tocaRole) return
    // Si toca el rol, la ruta tiene que exigir owner. admin/team lo hace con
    // requireOwner; cualquier otra que aparezca tendrá que hacer lo propio.
    expect(/requireOwner|role\s*!==\s*'owner'|ctx\.role\s*===\s*'owner'/.test(s),
      `${nombre(f)} escribe en profiles tocando 'role' sin exigir owner`).toBe(true)
  })
})

describe('rutas API · el cuerpo de la petición nunca se vuelca entero en la base', () => {
  // Volcar el body permite escribir columnas que el cliente no debería tocar
  // (created_by, role, id). O se filtra con pick(), o se construye campo a campo.
  it.each(TODAS.map(f => [nombre(f), f]))('%s', (_n, f) => {
    const s = leer(f)
    const vuelca = /\.(insert|update|upsert)\(\s*\{\s*\.\.\.\s*body\s*[,}]/.test(s)
      || /\.(insert|update|upsert)\(\s*body\s*\)/.test(s)
    expect(vuelca, `${nombre(f)} escribe el body sin filtrar: usa pick() o construye el objeto campo a campo`).toBe(false)
  })
})

describe('rutas API · las fechas de negocio son de Madrid', () => {
  // new Date().toISOString().slice(0,10) da el día UTC: a partir de las ~22:00 de
  // Madrid salta al día siguiente. Ya costó un bug real con tareas vencidas.
  it.each(TODAS.map(f => [nombre(f), f]))('%s', (_n, f) => {
    const s = leer(f)
    expect(/new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/.test(s),
      `${nombre(f)} calcula un día en UTC: usa todayKey() o localDayKey() de components/shared/helpers`).toBe(false)
  })
})

describe('rutas API · las excepciones anotadas siguen existiendo', () => {
  // Una lista de excepciones que nadie repasa acaba tapando rutas que ya no son
  // excepcionales. Si una desaparece o deja de necesitar la exención, se avisa.
  it.each(Object.keys(SIN_SESION).map(k => [k]))('%s sigue siendo una ruta real', (clave) => {
    expect(TODAS.map(nombre), `«${clave}» está en la lista de excepciones pero ya no existe: bórrala`).toContain(clave)
  })
})
