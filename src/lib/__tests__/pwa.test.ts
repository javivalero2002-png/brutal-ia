import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// El manifest y el código son dos ficheros que nadie mira a la vez, y ahí se
// cayó: `public/manifest.json` prometía tres atajos (`/dashboard?s=harvey`,
// `?s=tareas`, `?s=inbox`) —los que salen al mantener pulsado el icono de la app
// instalada— y el dashboard solo leía `?gmail=`. Los tres abrían en Hoy.
//
// No lo detecta ni TypeScript ni el build: el manifest es JSON estático y el
// parámetro es una cadena. Solo se ve instalando la PWA y probando los atajos,
// que es exactamente lo que nadie hace en cada despliegue.
const RAIZ = join(__dirname, '../../..')
const MANIFEST = JSON.parse(readFileSync(join(RAIZ, 'public/manifest.json'), 'utf8'))
const DASHBOARD = readFileSync(join(RAIZ, 'src/components/NexusDashboard.tsx'), 'utf8')
// SECCIONES vive aquí desde que las secciones necesitan el tipo `Section` para
// declarar su prop `onNavigate` (importarlo del dashboard sería un ciclo).
const SECCIONES_TS = readFileSync(join(RAIZ, 'src/components/shared/secciones.ts'), 'utf8')
const PAGINA = readFileSync(join(RAIZ, 'src/app/dashboard/page.tsx'), 'utf8')
const CLIENTE = readFileSync(join(RAIZ, 'src/components/DashboardClient.tsx'), 'utf8')

function seccionesDelCodigo(): string[] {
  const m = SECCIONES_TS.match(/const SECCIONES = \[([^\]]+)\] as const/)
  if (!m) throw new Error('No se encontró SECCIONES en shared/secciones.ts')
  return m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
}

/** Cada ruta de página que existe de verdad en el App Router. */
function rutaExiste(url: string): boolean {
  const camino = url.split('?')[0].replace(/^\//, '')
  if (!camino) return existsSync(join(RAIZ, 'src/app/page.tsx'))
  return existsSync(join(RAIZ, 'src/app', camino, 'page.tsx'))
}

describe('PWA: el manifest tiene que apuntar a algo que exista', () => {
  it('start_url apunta a una pagina real', () => {
    expect(MANIFEST.start_url).toBeTruthy()
    expect(rutaExiste(MANIFEST.start_url)).toBe(true)
  })

  it('cada atajo apunta a una pagina real', () => {
    for (const atajo of MANIFEST.shortcuts || []) {
      expect(rutaExiste(atajo.url), `atajo "${atajo.name}" -> ${atajo.url}`).toBe(true)
    }
  })

  // El que de verdad importa: que alguien LEA el parametro. Un atajo que apunta a
  // una pagina que existe pero ignora el parametro es peor que uno roto, porque
  // parece que funciona.
  //
  // Se comprueba la cadena entera —servidor -> cliente -> dashboard— porque el
  // fallo puede estar en cualquiera de los tres eslabones y ninguno da error de
  // compilacion: la prop es opcional, asi que perderla por el camino compila.
  it('la cadena que lleva ?s= hasta la seccion esta completa', () => {
    const conParametro = (MANIFEST.shortcuts || []).filter((a: { url: string }) => a.url.includes('?s='))
    expect(conParametro.length).toBeGreaterThan(0)

    // 1. La pagina (servidor) lee searchParams y lo pasa hacia abajo.
    expect(PAGINA).toMatch(/searchParams/)
    expect(PAGINA).toMatch(/initialSection=\{/)

    // 2. El cliente lo reenvia en vez de tragarselo.
    expect(CLIENTE).toMatch(/initialSection/)
    expect(CLIENTE).toMatch(/initialSection=\{initialSection\}/)

    // 3. El dashboard lo valida antes de usarlo (viene de la URL).
    expect(DASHBOARD).toContain('esSeccion(initialSection')
  })

  it('cada ?s= de un atajo es una seccion que existe', () => {
    const secciones = seccionesDelCodigo()
    expect(secciones.length).toBeGreaterThanOrEqual(14)
    for (const atajo of MANIFEST.shortcuts || []) {
      const s = new URL(atajo.url, 'https://x').searchParams.get('s')
      if (!s) continue
      expect(secciones, `atajo "${atajo.name}" apunta a la seccion "${s}"`).toContain(s)
    }
  })

  it('los iconos declarados existen en public/', () => {
    const faltan: string[] = []
    for (const icono of MANIFEST.icons || []) {
      if (!existsSync(join(RAIZ, 'public', icono.src.replace(/^\//, '')))) faltan.push(icono.src)
    }
    for (const atajo of MANIFEST.shortcuts || []) {
      for (const icono of atajo.icons || []) {
        if (!existsSync(join(RAIZ, 'public', icono.src.replace(/^\//, '')))) faltan.push(icono.src)
      }
    }
    expect(faltan).toEqual([])
  })
})
