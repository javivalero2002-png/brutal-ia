// Columnas del tablero de Proyectos, en un único sitio.
//
// Estaban escritas dos veces —NexusDashboard y PreviewClient— y las dos copias
// arrastraban el mismo fallo: «Plan.» y «Revisión» declaraban el color con
// rgba() mientras las otras tres eran hex. ProyectosSection concatena opacidad
// sobre `col.color` en TRES sitios (`${col.color}70` en la barra de acento,
// `${col.color}80` en el punto y `col.color+'15'` / `+'99'` en el contador), y
// con rgba() sale `rgba(255,176,32,0.7)70`: el navegador descarta la
// declaración entera, sin error y sin nada en consola. Esas dos columnas se
// pintaban sin barra y con el contador sin fondo, en la app y en /preview.
//
// Por eso los colores de aquí tienen que seguir siendo hex de 6 dígitos.
import type { Project } from '@/types'
import { BLU, RED, GRN, AMBAR } from './design-tokens'

export interface KanbanCol {
  title: string
  color: string
  status: Project['status']
  items: Project[]
}

const COLUMNAS: Omit<KanbanCol, 'items'>[] = [
  { title: 'Plan.',      color: '#F0F0F8', status: 'plan.' },   // el gris de texto de la app
  { title: 'Progreso',   color: BLU,       status: 'activo' },
  { title: 'Urgente',    color: RED,       status: 'urgente' },
  { title: 'Revisión',   color: AMBAR,     status: 'revisión' },
  { title: 'Completado', color: GRN,       status: 'completado' },
]

export const construirKanbanCols = (proyectos: Project[]): KanbanCol[] =>
  COLUMNAS.map(c => ({ ...c, items: proyectos.filter(p => p.status === c.status) }))
