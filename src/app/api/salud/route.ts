import { NextRequest, NextResponse } from 'next/server'

// Corto a propósito: esto tiene que contestar rápido o no sirve como sonda. Si
// una comprobación tarda más que esto, el problema ya es la respuesta.
export const maxDuration = 15
export const dynamic = 'force-dynamic'

// ─────────────────────────────────────────────────────────────────────────────
// ¿ESTÁ VIVA LA APP?
//
// El 27 de agosto Supabase rechazó la clave de servicio durante ~40 minutos
// (PGRST303, un bug de PostgREST validando contra un reloj cacheado). La app
// arrancaba —el login daba 200— y no traía un solo dato. Javi se enteró porque
// la abrió. Con clientes, eso es una llamada a las nueve de la mañana de alguien
// que no puede trabajar.
//
// Esto existe para que se entere una máquina antes que una persona. Se le apunta
// un vigilante externo gratuito (UptimeRobot, Better Stack, el que sea) y avisa
// solo. Tiene que ser EXTERNO: un vigilante que viva dentro de la app se cae con
// ella, y justo el día que hace falta no dice nada.
//
// Es PÚBLICO a propósito —un monitor no tiene sesión— y por eso no cuenta nada:
// devuelve qué pieza falla, nunca por qué. El detalle va detrás de CRON_SECRET.
//
// Comprueba lo que tumba la app, no todo: la base por las dos claves, el Storage
// y el Auth. Nada de IA aquí — una sonda que cuesta dinero cada minuto se acaba
// apagando, y una sonda apagada es peor que ninguna.
// ─────────────────────────────────────────────────────────────────────────────

type Pieza = { nombre: string; ok: boolean; ms: number; detalle?: string }

/**
 * Una comprobación con plazo propio.
 *
 * `signal` no es opcional: sin él rigen los defaults de undici —300 s— y el modo
 * de fallo no es una caída, es un cuelgue. La plataforma mataría la función sin
 * respuesta y el monitor externo leería «timeout» en vez de «la base está mal»,
 * que es una información peor.
 */
async function comprobar(nombre: string, url: string, headers: Record<string, string>): Promise<Pieza> {
  const t0 = Date.now()
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(6000), cache: 'no-store' })
    const ms = Date.now() - t0
    if (r.ok) return { nombre, ok: true, ms }
    const cuerpo = await r.text().catch(() => '')
    return { nombre, ok: false, ms, detalle: `HTTP ${r.status} ${cuerpo.slice(0, 160)}` }
  } catch (e) {
    return { nombre, ok: false, ms: Date.now() - t0, detalle: e instanceof Error ? e.message : String(e) }
  }
}

export async function GET(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secreta = process.env.SUPABASE_SERVICE_ROLE_KEY
  const publica = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !secreta || !publica) {
    // Faltan variables: la app no puede funcionar y hay que decirlo con 503, no
    // con un 200 que diga «todo bien porque no he mirado nada».
    return NextResponse.json(
      { ok: false, fallo: ['configuracion'] },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const piezas = await Promise.all([
    // La de servicio primero: es la que usa casi toda la app y la que falló.
    comprobar('base', `${url}/rest/v1/profiles?select=id&limit=1`,
      { apikey: secreta, Authorization: `Bearer ${secreta}` }),
    // Y la pública, que es por la que entra el navegador. Las dos porque el 27 de
    // agosto una funcionaba y la otra no: mirar solo una habría dicho «todo bien».
    comprobar('base-publica', `${url}/rest/v1/profiles?select=id&limit=1`, { apikey: publica }),
    comprobar('storage', `${url}/storage/v1/bucket`,
      { apikey: secreta, Authorization: `Bearer ${secreta}` }),
    comprobar('auth', `${url}/auth/v1/settings`, { apikey: publica }),
  ])

  const fallo = piezas.filter(p => !p.ok).map(p => p.nombre)
  const ok = fallo.length === 0

  // El detalle solo para quien tiene la llave. Un endpoint público que cuenta el
  // mensaje de error de tu base de datos le está contando a cualquiera qué usas
  // y qué versión.
  const secret = process.env.CRON_SECRET
  const conLlave = !!secret && request.nextUrl.searchParams.get('detalle') === secret

  return NextResponse.json(
    conLlave ? { ok, fallo, piezas } : { ok, fallo },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  )
}
