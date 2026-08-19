import { getAuthCtx } from '@/lib/authz'
import { hacerCopia, podarCopias, BUCKET_COPIAS, ES_COPIA } from '@/lib/copiaSeguridad'
import { acquireLock, releaseLock } from '@/lib/jobLock'
import { todayKey } from '@/components/shared/helpers'
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 300

// ─────────────────────────────────────────────────────────────────────────────
// Las copias, desde la app. Solo el propietario.
//
// Por qué esto y no solo el cron: una copia que nadie ha visto nunca no es una
// copia, es una intención. Poder pulsar un botón y ver «17 tablas, 4.312 filas,
// hace 2 minutos» es lo que convierte el respaldo en algo en lo que confías —y lo
// que hace que se note el día que deje de funcionar.
//
// Solo owner porque el fichero es la base entera: quién cobra cuánto, qué se
// habla de cada cliente, el diario de cada uno. Es el mismo criterio que el
// briefing del equipo.
// ─────────────────────────────────────────────────────────────────────────────

/** Qué copias hay, de la más nueva a la más vieja. Con `?descargar=`, el enlace. */
export async function GET(request: NextRequest) {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (ctx.role !== 'owner') {
    return NextResponse.json({ error: 'Solo el propietario puede ver las copias' }, { status: 403 })
  }

  const admin = ctx.admin

  // Descargar una copia concreta.
  //
  // Una copia que no te puedes llevar no te salva de nada: el escenario que hay
  // que cubrir es «Supabase no responde», y entonces el fichero que vive DENTRO de
  // Supabase tampoco. Esto es lo que permite tener una fuera.
  const pedida = new URL(request.url).searchParams.get('descargar')
  if (pedida) {
    // El nombre viaja en la URL, así que se valida en vez de confiar: sin esto,
    // `?descargar=../otro-bucket/algo` es una travesía de rutas. La forma es
    // exactamente 'YYYY-MM-DD.json' y nada más.
    if (!ES_COPIA.test(pedida)) {
      return NextResponse.json({ error: 'Nombre de copia no válido' }, { status: 400 })
    }
    const { data, error } = await admin.storage.from(BUCKET_COPIAS).createSignedUrl(pedida, 300)
    if (error || !data?.signedUrl) {
      return NextResponse.json({ error: error?.message || 'No se pudo firmar la copia' }, { status: 500 })
    }
    // Cinco minutos: lo justo para pulsar y que se descargue. Es la base entera.
    return NextResponse.json({ url: data.signedUrl })
  }
  const { data, error } = await admin.storage.from(BUCKET_COPIAS).list('', {
    limit: 60,
    sortBy: { column: 'name', order: 'desc' },
  })

  // El bucket no existe hasta la primera copia. Eso NO es un error: es «todavía
  // no hay ninguna», y decirlo así permite a la pantalla ofrecer el botón en vez
  // de enseñar un fallo rojo el primer día.
  if (error) {
    if (/not found|does not exist|bucket/i.test(error.message)) {
      return NextResponse.json({ copias: [], sinEstrenar: true })
    }
    console.error('[admin/backup] no se pudieron listar las copias:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const copias = (data || [])
    .filter(f => ES_COPIA.test(f.name))
    .map(f => ({
      nombre: f.name,
      // Extraído con un patrón y no cortando por posición: aquí es el nombre de
      // un fichero y no un ISO, pero `.slice(0,10)` sobre algo con forma de fecha
      // es justo el gesto que en esta app da el día en UTC — la regla que lo
      // prohíbe hizo bien en pararme, y así se lee lo que de verdad hace.
      dia: /^\d{4}-\d{2}-\d{2}/.exec(f.name)?.[0] ?? f.name,
      bytes: (f.metadata as { size?: number } | null)?.size ?? null,
      creada: f.created_at ?? null,
    }))

  return NextResponse.json({ copias, sinEstrenar: false })
}

/** Hacer una copia ahora mismo. */
export async function POST() {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (ctx.role !== 'owner') {
    return NextResponse.json({ error: 'Solo el propietario puede hacer copias' }, { status: 403 })
  }

  const admin = ctx.admin
  // Mismo cerrojo que el cron: si coinciden, la segunda no repite el trabajo.
  const cerrojo = await acquireLock(admin, 'copia-seguridad', 10 * 60 * 1000)
  if (!cerrojo.adquirido) {
    return NextResponse.json({ error: 'Ya hay una copia en marcha, espera un momento' }, { status: 409 })
  }

  try {
    const resumen = await hacerCopia(admin, todayKey())
    const podadas = await podarCopias(admin)
    return NextResponse.json({ ok: true, ...resumen, podadas })
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e)
    console.error('[admin/backup] la copia falló:', motivo)
    return NextResponse.json({ error: motivo }, { status: 500 })
  } finally {
    await releaseLock(admin, 'copia-seguridad', cerrojo.holder)
  }
}
