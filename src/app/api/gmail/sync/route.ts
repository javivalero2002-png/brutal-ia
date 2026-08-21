import { createClient, createAdminClient } from '@/lib/supabase/server'
import { syncPersonalInbox } from '@/lib/colabsSync'
import { checkAiRateLimit } from '@/lib/rate-limit'
import { NextResponse } from 'next/server'

// ─────────────────────────────────────────────────────────────────────────────
// «Sincronizar» de un buzón PERSONAL, disparado desde el navegador.
//
// ESTO ERA UNA SEGUNDA IMPLEMENTACIÓN DE 355 LÍNEAS. Sincronizar un buzón personal
// estaba escrito dos veces —aquí y en `syncPersonalInbox`, que es lo que corre el
// cron— y el propio fichero lo decía en un comentario: «fusionarlas es un refactor
// que no toca hacer hoy». Mientras las dos copias hacían lo mismo, la duplicación
// solo costaba mantenimiento. Dejaron de hacerlo:
//
//   · Al pasar a varias cuentas de Gmail por persona, el cron aprendió a recorrer
//     todas y esta copia se quedó leyendo una sola columna. Pulsar el botón
//     sincronizaba UNA cuenta de las dos, sin decirlo.
//   · Y desde antes de eso, esta copia creaba tareas de reunión y la del cron no.
//     Un enlace de Meet en tu Gmail personal creaba tarea solo si pulsabas el
//     botón a mano. Nadie echa de menos una tarea que no sabe que debería existir.
//
// Dos caminos que hacen lo mismo con distinto resultado es el fallo de fondo de
// este repo. Se arregla borrando uno, no sincronizando los dos a mano cada vez.
//
// Lo que se queda AQUÍ y no baja a la librería es el límite de ritmo: es una
// defensa contra este botón concreto —el cron no la necesita, corre una vez por
// hora— y bajarla frenaría también al cron.
//
// El endpoint de colabs ya era así. Este es el que faltaba.
// ─────────────────────────────────────────────────────────────────────────────

export const maxDuration = 60

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()

  // Cada sincronización analiza correos con Claude, así que pulsarlo en bucle es
  // la forma más cara de gastar el presupuesto del mes. El automático del cliente
  // cae aquí también, y le viene bien: si algo lo dispara en bucle se frena solo.
  if (await checkAiRateLimit(admin, user.id, 'sync')) {
    return NextResponse.json({ error: 'Demasiadas sincronizaciones seguidas. Espera un momento.' }, { status: 429 })
  }

  // El perfil se lee aquí para pasarle la preferencia de análisis y el token de
  // respaldo; las CUENTAS las resuelve la librería, que es quien sabe de eso.
  const { data: profile, error: errPerfil } = await admin
    .from('profiles')
    .select('id, gmail_refresh_token, analizar_correo')
    .eq('id', user.id)
    .maybeSingle()
  // El error SE MIRA: sin esto un fallo de consulta es indistinguible de «no tiene
  // perfil» y se responde «no conectado» a alguien que sí lo está.
  if (errPerfil) {
    console.error('[sync] no se pudo leer el perfil:', errPerfil.message)
    return NextResponse.json({ error: 'No se pudo comprobar tu conexión' }, { status: 503 })
  }
  if (!profile) return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 })

  const result = await syncPersonalInbox(admin, profile)

  if (!result.ok) {
    // Los mismos códigos que devolvía la implementación vieja, porque la pantalla
    // ya los distingue: `token_expired` y `auth_rota` piden reconectar (401),
    // `dedup_failed` es transitorio y pide reintentar (503).
    const status =
      result.error === 'not connected' ? 400
      : result.error === 'token_expired' || result.error === 'auth_rota' ? 401
      : result.error === 'dedup_failed' ? 503
      : 500
    const message =
      result.error === 'token_expired' ? 'El token de Gmail ha caducado. Reconecta tu cuenta desde Operativa → Sincronización.'
      : result.error === 'auth_rota' ? 'Google ha rechazado la conexión. Vuelve a conectar Gmail desde Operativa → Sincronización.'
      : result.error === 'dedup_failed' ? 'No se pudo comprobar qué emails ya estaban guardados. Inténtalo de nuevo.'
      : undefined
    return NextResponse.json({ error: result.error, message, code: result.code, details: result.details }, { status })
  }

  return NextResponse.json({
    synced: result.synced,
    total: result.total,
    account: result.account,
    // Emails analizados y NO guardados. Sin esto, un buzón con la escritura rota
    // se anuncia como «0 nuevos» y parece que no había correo.
    insertFailures: result.insertFailures ?? 0,
    // No se hizo nada porque otra instancia lo estaba haciendo. Sin este campo la
    // respuesta es `synced: 0`, que desde el cliente es igual que «no había nada».
    saltado: result.saltado ?? false,
    truncado: result.truncado ?? false,
  })
}
