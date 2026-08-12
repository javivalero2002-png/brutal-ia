import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// LucideIcon pinta `{d && <path d={d}/>}`: si el nombre no está en el mapa, sale
// un <svg> VACÍO. Un hueco del tamaño correcto, sin error y sin nada en consola.
//
// Trece iconos vivían así, y el más visible era 'grid-2x2': la sexta pestaña de la
// barra inferior del móvil, la que abre Clientes/Contenido/Calendario/Harvey/
// Operativa/Equipo. Está en pantalla en TODAS las secciones del iPhone.
//
// Nada podía detectarlo: el nombre es una cadena, así que TypeScript no ayuda, y
// no hay error en tiempo de ejecución. Este test es la única red posible.
const RAIZ = join(__dirname, '../../..')
const MAPA = readFileSync(join(RAIZ, 'src/components/shared/LucideIcon.tsx'), 'utf8')

const NOMBRES_DEFINIDOS = new Set(
  [...MAPA.matchAll(/^\s*'?([a-z0-9-]+)'?\s*:\s*'/gm)].map(m => m[1])
)

function tsxDelRepo(dir: string, salida: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    if (entrada === 'node_modules' || entrada === '.next') continue
    const ruta = join(dir, entrada)
    if (statSync(ruta).isDirectory()) tsxDelRepo(ruta, salida)
    else if (entrada.endsWith('.tsx')) salida.push(ruta)
  }
  return salida
}

/** Todos los nombres de icono que se usan, con el fichero donde aparecen. */
function nombresUsados(): Map<string, Set<string>> {
  const usos = new Map<string, Set<string>>()
  for (const ruta of tsxDelRepo(join(RAIZ, 'src'))) {
    const src = readFileSync(ruta, 'utf8')
    const corto = ruta.slice(RAIZ.length + 1)
    const apunta = (nombre: string) => {
      if (!usos.has(nombre)) usos.set(nombre, new Set())
      usos.get(nombre)!.add(corto)
    }
    // <LucideIcon name="x"/> y name={'x'}
    for (const m of src.matchAll(/name=[{]?["']([a-z0-9-]+)["'][}]?/g)) apunta(m[1])
    // Las listas de navegación y de acciones lo llevan como `icon:'x'`
    for (const m of src.matchAll(/\bicon:\s*'([a-z0-9-]+)'/g)) apunta(m[1])
  }
  return usos
}

describe('iconos: ningun nombre puede pintar un hueco vacio', () => {
  it('el mapa tiene el numero de iconos que se espera', () => {
    expect(NOMBRES_DEFINIDOS.size).toBeGreaterThanOrEqual(100)
  })

  it('todos los nombres usados existen en el mapa', () => {
    const rotos: string[] = []
    for (const [nombre, ficheros] of nombresUsados()) {
      if (!NOMBRES_DEFINIDOS.has(nombre)) {
        rotos.push(`«${nombre}» en ${[...ficheros].join(', ')}`)
      }
    }
    expect(rotos).toEqual([])
  })

  // Un `d` vacío pinta lo mismo que un nombre que no existe.
  it('ningun icono tiene el path vacio', () => {
    const vacios = [...MAPA.matchAll(/^\s*'?([a-z0-9-]+)'?\s*:\s*''/gm)].map(m => m[1])
    expect(vacios).toEqual([])
  })

  // Los paths se pintan con fill="none", asi que tienen que empezar con un
  // moveto. Uno mal copiado se veria raro pero no daria error.
  it('todos los paths empiezan por M', () => {
    const malos: string[] = []
    for (const m of MAPA.matchAll(/^\s*'?([a-z0-9-]+)'?\s*:\s*'([^']+)'/gm)) {
      if (!m[2].startsWith('M')) malos.push(`${m[1]}: empieza por «${m[2][0]}»`)
    }
    expect(malos).toEqual([])
  })
})
