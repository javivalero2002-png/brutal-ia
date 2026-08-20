import type { SupabaseClient } from '@supabase/supabase-js'
import { sendPushToUser, canSendPush } from '@/lib/push'

// Cuándo una conexión de Gmail está rota, en un solo sitio.
//
// Esto estaba escrito CUATRO veces —gmail/sync, gmail/status, colabsSync (×2)—
// y las cuatro copias miraban solo `invalid_grant`. El 2026-08-13 los logs de
// producción enseñaron a Google devolviendo `unauthorized_client` para el buzón
// de un compañero: no casaba en ninguna, así que caía como error genérico.
//
// El resultado era el peor de los posibles: `gmail_connected` seguía en `true`,
// la pantalla de Sincronización decía «CONECTADO», y su correo llevaba días sin
// entrar. Un fallo que parece un éxito.

type ErrorGoogle = Error & {
  code?: number
  response?: { data?: { error?: string; error_description?: string } }
}

const codigo = (err: unknown): string => {
  const e = err as ErrorGoogle
  return (e?.response?.data?.error || '').toLowerCase()
}
const mensaje = (err: unknown): string => ((err as ErrorGoogle)?.message || '').toLowerCase()

/**
 * El refresh token de ESTA persona ya no vale: lo revocó, caducó, o cambió la
 * contraseña. Es seguro borrarlo, porque no hay nada que recuperar — la única
 * salida es que vuelva a conectar.
 */
export function esTokenMuerto(err: unknown): boolean {
  return codigo(err) === 'invalid_grant'
    || mensaje(err).includes('invalid_grant')
    || mensaje(err).includes('token has been expired or revoked')
}

/**
 * La conexión no funciona, pero la culpa puede NO ser del token.
 *
 * `unauthorized_client` e `invalid_client` los devuelve Google cuando el cliente
 * OAuth no está autorizado para ese grant — y eso puede venir de la configuración
 * GLOBAL (un `GOOGLE_CLIENT_ID` o `GOOGLE_CLIENT_SECRET` mal puestos), no de la
 * persona. Por eso están aquí y no en `esTokenMuerto`: **no se borra el token**.
 *
 * Borrarlo sería el error caro: si un día se rota mal la credencial de Google,
 * la primera vuelta del cron dejaría a las SIETE personas sin refresh token, y
 * arreglar la variable ya no bastaría — habría que pedirle a todo el mundo que
 * volviera a conectar Gmail a mano.
 *
 * Lo que sí hay que hacer es avisar: esto no se arregla solo.
 */
export function esConexionRota(err: unknown): boolean {
  const c = codigo(err)
  return esTokenMuerto(err) || c === 'unauthorized_client' || c === 'invalid_client'
    || mensaje(err).includes('unauthorized_client')
}

/** Códigos de error que exigen que un humano haga algo. Los usa el cron. */
export const ERRORES_ACCIONABLES = new Set(['token_expired', 'auth_rota'])

/** El código que se devuelve al cliente según lo que haya pasado. */
export const codigoDeFallo = (err: unknown): 'token_expired' | 'auth_rota' | null =>
  esTokenMuerto(err) ? 'token_expired' : esConexionRota(err) ? 'auth_rota' : null

/**
 * Avisa por push a quien se le ha caído la conexión de Gmail.
 *
 * Por qué hace falta: las cuatro ramas que detectan un token muerto borraban la
 * conexión y devolvían un error que NADIE proactivo lee. El sync automático del
 * cliente lo llama con `.catch(()=>{})`, y el cron solo lo deja escrito en su
 * respuesta JSON, que lee Vercel y nadie más. Resultado: los correos dejan de
 * entrar y te enteras cuando un cliente pregunta por qué no le contestas.
 *
 * Y no es un caso raro: mientras la app de Google esté en modo de prueba, el
 * token muere CADA SIETE DÍAS. Una herramienta cuya razón de ser es avisar de
 * correos nuevos tiene que avisar del fallo que corta los correos.
 *
 * Con `await` a propósito, como el resto de los push del repo: en serverless la
 * instancia se congela al devolver y un envío suelto se pierde.
 */
export async function avisarConexionCaida(
  admin: SupabaseClient,
  userId: string,
  cual: 'personal' | 'colabs',
  /** La dirección concreta, si la persona tiene más de una cuenta personal. Sin
   * esto, «tu Gmail» no dice CUÁL de las dos hay que reconectar. */
  correo?: string,
) {
  // Como mucho uno cada seis horas por buzón. El cron corre cada hora y el token
  // sigue muerto hasta que alguien lo reconecta: sin freno serían 24 avisos al
  // día de lo mismo, y eso no es avisar, es enseñar a ignorar los avisos.
  // El freno de deduplicación va por CUENTA cuando hay dirección, no por perfil:
  // si Pablo tiene dos y la primera cae, la segunda que caiga después tiene que
  // poder avisar aparte — son dos averías distintas.
  const clave = correo ? `gmail-caido:${cual}:${userId}:${correo}` : `gmail-caido:${cual}:${userId}`
  const puede = await canSendPush(admin, clave, 6 * 60 * 60 * 1000)
  if (!puede) return

  const nombre = cual === 'colabs' ? 'el buzón de colaboraciones' : correo ? `tu Gmail (${correo})` : 'tu Gmail'
  try {
    await sendPushToUser(admin, userId, {
      title: 'Se ha desconectado el correo',
      // Dice qué pasa Y qué hacer: un aviso que no lleva a una acción concreta
      // solo produce inquietud.
      body: `Han dejado de entrar correos de ${nombre}. Vuelve a conectarlo en Operativa → Sincronización.`,
      url: '/dashboard?s=ajustes',
      tag: `gmail-caido-${cual}`,
      categoria: 'averia',
      urgent: true,
    })
  } catch (err) {
    // No puede tumbar el sync: la conexión ya está caída, y fallar aquí además
    // dejaría el error original sin devolver.
    console.error('[gmailAuth] no se pudo avisar de la conexión caída:', err)
  }
}
