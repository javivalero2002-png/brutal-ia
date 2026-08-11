import { notFound } from 'next/navigation'
import PreviewClient from './PreviewClient'

// Ruta de preview SOLO para desarrollo. En producción devuelve 404 —
// nunca expone datos ni UI sin auth en el entorno real.
//
// Los parámetros de la URL se leen AQUÍ, en el servidor, y bajan como props.
// Leerlos en el cliente —da igual si en el render o en un useEffect— hace que el
// servidor pinte la sección por defecto y el navegador otra distinta: React
// aborta la hidratación y regenera el árbol, y la consola se llena de errores de
// hidratación que tapan los de verdad. Eso ya me costó varias horas de dudar de
// diagnósticos correctos.
export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()

  const p = await searchParams
  const uno = (k: string) => { const v = p[k]; return Array.isArray(v) ? v[0] : v }

  return (
    <PreviewClient
      initialSection={uno('s') || 'tareas'}
      initialView={uno('v')}
      initialFocus={uno('focus') === '1'}
      initialGroupBy={uno('g') === 'priority' || uno('g') === 'project' ? (uno('g') as 'priority' | 'project') : undefined}
    />
  )
}
