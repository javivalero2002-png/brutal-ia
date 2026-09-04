// Las secciones de la app, y el tipo de la función que navega entre ellas.
//
// La lista es la fuente de verdad y el tipo se deriva de ella, no al revés: hace
// falta poder validar en tiempo de ejecución lo que llega por `?s=` (los atajos
// de la PWA), y una unión de tipos no existe en tiempo de ejecución. Escribir
// las dos por separado invita a que se desincronicen.
//
// Vive aquí y no en NexusDashboard porque las secciones necesitan el TIPO para
// declarar su prop `onNavigate`, e importar desde el dashboard sería un ciclo:
// el dashboard ya las importa a ellas.
export const SECCIONES = ['hoy','inbox','tareas','clientes','proyectos','campanas','contenido','calendario','memoria','diario','automatizaciones','chat','equipo','reportes','ajustes','harvey'] as const

export type Section = typeof SECCIONES[number]

export const esSeccion = (v: string | null): v is Section =>
  !!v && (SECCIONES as readonly string[]).includes(v)

// El tipo de `onNavigate`, que estaba declarado `any` en las NUEVE secciones que
// lo reciben. Con `any` no se comprueba nada: `onNavigate('proyecto')` —en
// singular, que es la clase de error que de verdad se comete— compilaba sin una
// queja y en ejecución dejaba la app en una sección que no existe.
//
// El propio `setSection` del dashboard ya estaba tipado; lo que se perdía era
// justo al cruzar la frontera hacia la sección.
export type IrASeccion = (s: Section) => void
