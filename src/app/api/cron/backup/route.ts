import { createAdminClient } from '@/lib/supabase/server'
import { hacerCopia, podarCopias } from '@/lib/copiaSeguridad'
import { acquireLock, releaseLock } from '@/lib/jobLock'
import { marcarLatido } from '@/lib/reglaRows'
import { todayKey } from '@/components/shared/helpers'
import { NextRequest, NextResponse } from 'next/server'

// La copia lee todas las tablas y sube un fichero: es lenta y no pasa nada porque
// lo sea, pero tiene que tener techo. Sin `maxDuration` un cuelgue de Storage no
// se distingue de un fallo y no deja mensaje.
export const maxDuration = 300

// ─────────────────────────────────────────────────────────────────────────────
// Copia SEMANAL de la base: los miércoles a las 04:00 UTC (`vercel.json`).
//
// A esa hora en Madrid son las 05:00 o las 06:00 según la estación: da igual, lo
// que importa es que nadie esté escribiendo. Miércoles porque a mitad de semana
// una copia cubre por igual lo de antes y lo de después del fin de semana.
//
// Si se cambia la frecuencia, hay que cambiar TAMBIÉN la cadencia esperada en
// `/api/admin/latido`, o el panel avisa de una avería que no existe. Y el nombre del fichero SÍ usa el
// día de Madrid (`todayKey()`), no el del servidor, para que la copia de «el 19»
// sea la del 19 que ve el equipo.
//
// Vercel añade `Authorization: Bearer ${CRON_SECRET}` a la petición.
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = await createAdminClient()

  // Cerrojo: si una copia manual y la automática coinciden, la segunda leería la
  // base entera para escribir encima de la primera. Trabajo doble para el mismo
  // fichero, y a esta escala el doble de lecturas se nota.
  const cerrojo = await acquireLock(admin, 'copia-seguridad', 10 * 60 * 1000)
  if (!cerrojo.adquirido) {
    return NextResponse.json({ ok: true, saltada: 'ya hay una copia en marcha' })
  }

  try {
    const resumen = await hacerCopia(admin, todayKey())
    const podadas = await podarCopias(admin)

    // De paso, el historial de avisos: crece con cada push y la campana solo pide
    // los 40 últimos. Va aquí y no en su propio cron porque es la misma idea
    // —mantener la base en su sitio— y un cron menos es una cosa menos que vigilar.
    let notificacionesPodadas: number | null = null
    const { data, error } = await admin.rpc('podar_notificaciones', { dias: 60 })
    if (error) {
      // No tumba la copia, que es lo que importa; pero se registra, porque una
      // poda que lleva meses fallando llena la base igual que no tenerla.
      console.error('[cron/backup] la poda de notificaciones falló:', error.message)
    } else {
      notificacionesPodadas = typeof data === 'number' ? data : null
    }

    await marcarLatido(admin, 'copia', true, `${resumen.total} filas`)
    return NextResponse.json({ ok: true, ...resumen, podadas, notificacionesPodadas })
  } catch (e) {
    // Una copia que falla en silencio es exactamente igual de útil que no tenerla,
    // y peor: crees que la tienes. El error sube con su motivo.
    const motivo = e instanceof Error ? e.message : String(e)
    console.error('[cron/backup] la copia falló:', motivo)
    // El latido se escribe TAMBIÉN al fallar: «corrió y se rompió» es
    // información distinta de «no corrió», y la pantalla debe poder decir cuál.
    await marcarLatido(admin, 'copia', false, motivo.slice(0, 200))
    return NextResponse.json({ ok: false, error: motivo }, { status: 500 })
  } finally {
    await releaseLock(admin, 'copia-seguridad', cerrojo.holder)
  }
}
