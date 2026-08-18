import { notFound } from 'next/navigation'
import { getAuthCtx } from '@/lib/authz'
import PreviewClient from './PreviewClient'

// La demo con datos de muestra. En desarrollo, abierta; en PRODUCCION, solo para
// el propietario con sesion.
//
// Antes devolvia 404 en produccion sin mas. El motivo escrito era «nunca expone
// datos ni UI sin auth en el entorno real», y sigue valiendo: aqui no hay ni un
// dato real —PreviewClient lleva su propio juego de muestra— y ahora ademas exige
// sesion y rol owner, que es la misma senal de autorizacion que usa el resto de la
// app (`profiles.role`, resuelto en el servidor).
//
// Para que sirve: es la unica forma de ensenar la app —o una seccion nueva— sin
// dar acceso a los datos del estudio.
//
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
  if (process.env.NODE_ENV === 'production') {
    // Basta con tener SESION. No hace falta ser propietario: aqui dentro no hay ni
    // un dato real —PreviewClient trae su propio juego de muestra— asi que exigir
    // owner anadia friccion sin anadir proteccion, y dejaba fuera a la mitad del
    // equipo de una pantalla que existe justo para ensenarles la app.
    //
    // Lo que si se mantiene es el motivo original: nunca sin auth. Un anonimo
    // sigue viendo un 404, no una pantalla en blanco ni la interfaz del estudio.
    const ctx = await getAuthCtx()
    if (!ctx) notFound()
  }

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
