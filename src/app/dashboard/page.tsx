import DashboardClient from '@/components/DashboardClient'

// `?s=` se lee AQUÍ, en el servidor, y baja como prop — igual que en /preview y
// por el mismo motivo. Lo usan los tres atajos de public/manifest.json: los que
// salen al mantener pulsado el icono de la app instalada.
//
// Leerlo en un useEffect también funciona, pero deja ver la sección por defecto
// un fotograma antes de saltar a la buena. Como prop, la sección correcta es la
// primera que se pinta.
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const p = await searchParams
  const s = p.s
  return <DashboardClient initialSection={Array.isArray(s) ? s[0] : s} />
}
