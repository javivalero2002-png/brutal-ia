import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

// Los botones de "crear desde aquí" prellenaban el formulario con dos llamadas en
// el mismo handler:
//
//     onSetMf?.({cliente: selected.name}); onOpenModal('tarea')
//
// y openModal hacía setMf({}) nada más entrar. React agrupa las dos
// actualizaciones de estado y gana la última, así que el prellenado se borraba
// SIEMPRE. Los siete botones de ese tipo abrían el formulario en blanco.
//
// Nada lo detectaba: compila, no hay error en consola, y el modal se abre. Solo se
// nota si te fijas en que el campo que debería venir puesto está vacío.
//
// Este test es la red. No comprueba el resultado —para eso haría falta montar el
// dashboard, que exige sesión— sino que la forma rota no puede volver.
const RAIZ = join(__dirname, '../../..')
const DASHBOARD = readFileSync(join(RAIZ, 'src/components/NexusDashboard.tsx'), 'utf8')

const SECCIONES = readdirSync(join(RAIZ, 'src/components/sections'))
  .filter(f => f.endsWith('.tsx'))
  .map(f => [f, readFileSync(join(RAIZ, 'src/components/sections', f), 'utf8')] as const)

describe('modales: el prellenado no puede borrarse solo', () => {
  it('openModal recibe el prellenado como parametro', () => {
    expect(DASHBOARD).toMatch(/const openModal = useCallback\(\(type: string \| null, prellenado/)
    expect(DASHBOARD).toContain('setMf(prellenado)')
  })

  // El setMf tiene que seguir estando: `mf` no se limpia al cerrar con Escape ni
  // con la X, así que sin él los campos de un modal se colarían en el siguiente.
  it('openModal sigue reiniciando los campos, con {} por defecto', () => {
    expect(DASHBOARD).toMatch(/prellenado: Record<string,\s*string> = \{\}/)
  })

  // La forma rota, prohibida explícitamente.
  it('ninguna seccion prellena con un setter aparte antes de abrir', () => {
    const culpables: string[] = []
    for (const [nombre, src] of SECCIONES) {
      if (/onSetMf/.test(src)) culpables.push(`${nombre}: usa onSetMf, que ya no existe`)
      // Dos llamadas en el mismo handler, en cualquier orden.
      if (/setMf[^\n]{0,80}onOpenModal|onOpenModal[^\n]{0,40}setMf/.test(src)) {
        culpables.push(`${nombre}: llama a setMf y onOpenModal en el mismo handler`)
      }
    }
    expect(culpables).toEqual([])
  })

  it('los botones que prellenan siguen pasando algo', () => {
    const conPrellenado = SECCIONES.flatMap(([nombre, src]) =>
      [...src.matchAll(/onOpenModal\('[a-z]+',\s*\{/g)].map(() => nombre))
    // Eran siete cuando se arregló: cuatro en Calendario, dos en Clientes, uno en
    // Proyectos. Si este número baja, alguien ha quitado un prellenado sin querer.
    expect(conPrellenado.length).toBeGreaterThanOrEqual(7)
  })
})
