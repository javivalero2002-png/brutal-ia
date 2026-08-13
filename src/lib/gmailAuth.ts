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
