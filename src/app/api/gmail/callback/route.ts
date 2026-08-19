import { createClient, createAdminClient } from '@/lib/supabase/server'
import { guardarCuenta } from '@/lib/gmailCuentas'
import { getAuthCtx } from '@/lib/authz'
import { getOAuthClient, OAUTH_STATE_COOKIE } from '@/lib/gmail'
import { google } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'

// `NEXT_PUBLIC_APP_URL || ''` producía `NextResponse.redirect('/dashboard?...')`,
// que lanza ERR_INVALID_URL: un 500 en blanco justo en medio del flujo de
// conexión de Gmail. El origen de la propia petición es un fallback siempre válido.
const appOrigin = (request: NextRequest): string =>
  process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin

export async function GET(request: NextRequest) {
  const base = appOrigin(request)
  // El nonce es de un solo uso: se borra en cuanto se consume, para que un
  // callback capturado no pueda reproducirse dentro de la ventana de 10 min.
  const done = (to: string) => {
    const r = NextResponse.redirect(to)
    r.cookies.delete(OAUTH_STATE_COOKIE)
    return r
  }
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state') || ''
  const oauthError = searchParams.get('error')

  if (oauthError) {
    return done(`${base}/dashboard?gmail=denied`)
  }

  if (!code || !state) {
    return done(`${base}/dashboard?gmail=error`)
  }

  const [userId, account = 'personal', nonce] = state.split(':')

  // Anti-CSRF. La comprobación de sesión de abajo impide inyectar en la cuenta de
  // OTRO, pero sin esto seguía siendo posible engañar a alguien ya logueado para
  // que abriese un callback preparado con el `code` del atacante: el resultado era
  // el Gmail del atacante conectado a la cuenta de la víctima, y con
  // account=colabs, convertido en el buzón compartido de la empresa.
  // El atacante no puede escribir esta cookie httpOnly, así que no puede fabricar
  // un state que case.
  const expected = request.cookies.get(OAUTH_STATE_COOKIE)?.value
  if (!nonce || nonce !== expected) {
    // Código propio: si la cookie ya no está, casi siempre es que el usuario tardó
    // más que su vida útil en la pantalla de consentimiento. Con el mensaje
    // genérico era indistinguible de un fallo de red y nadie sabía que bastaba
    // con repetir.
    return done(`${base}/dashboard?gmail=${expected ? 'error' : 'expired'}`)
  }

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user || user.id !== userId) {
    return done(`${base}/dashboard?gmail=error`)
  }

  if (!userId) {
    return done(`${base}/dashboard?gmail=error`)
  }

  // El rol, resuelto por el servidor. `profiles.role` es la unica senal de
  // autorizacion; nada de esto sale del state, que lo escribe el cliente.
  const ctx = await getAuthCtx()

  const oauth2Client = getOAuthClient()
  let tokens: { refresh_token?: string | null } = {}
  try {
    const result = await oauth2Client.getToken(code)
    tokens = result.tokens as { refresh_token?: string | null }
  } catch {
    return done(`${base}/dashboard?gmail=error`)
  }

  if (!tokens.refresh_token) {
    return done(`${base}/dashboard?gmail=no_refresh_token`)
  }
  // Atado a una constante tras la guarda: `tokens.refresh_token` es `string | null`
  // en el tipo del SDK y TypeScript no lo estrecha a través de las ramas de abajo.
  const refreshToken: string = tokens.refresh_token

  // Resolve the authenticated email address and cache it in the profile
  let email: string | null = null
  try {
    oauth2Client.setCredentials({ refresh_token: tokens.refresh_token })
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const { data: info } = await oauth2.userinfo.get()
    email = info.email || null
  } catch {}

  // Sin dirección no se puede seguir, y antes sí se podía.
  //
  // Con dos columnas fijas daba igual: el token iba a «la ranura personal» o a «la
  // de colabs» y punto. Ahora las cuentas se identifican POR SU DIRECCIÓN —es lo
  // que permite tener dos propias— así que una conexión sin dirección no se puede
  // guardar, ni distinguir, ni desconectar después.
  //
  // No debería pasar: pedimos `userinfo.email` en el consentimiento. Si pasa es que
  // algo va mal de verdad, y decirlo es mejor que guardar una conexión que luego no
  // sincroniza nada y nadie sabe por qué.
  if (!email) {
    console.error('[gmail] Google no devolvió la dirección de la cuenta; no se guarda la conexión')
    return done(`${base}/dashboard?gmail=error`)
  }
  const correoCuenta: string = email

  const supabase = await createAdminClient()

  if (account === 'colabs') {
    // El rol se comprueba AQUI, no solo en /api/gmail/connect.
    //
    // El nonce impide que un extrano fabrique un state; NO impide que el dueno
    // legitimo de ese nonce lo modifique. Un miembro pide conectar su Gmail
    // PERSONAL —permitido para cualquiera—, y al volver de Google cambia
    // `personal` por `colabs` en el state: su nonce sigue casando, porque es el
    // suyo, y `user.id === userId` tambien, porque es el. El buzon compartido de
    // la empresa acaba apuntando a su correo personal, y su correo personal
    // acaba en el inbox de las siete personas.
    //
    // Es la misma asimetria que ya aparecio en connect/disconnect, una puerta mas
    // adentro: el `account` del state es entrada del cliente, y ninguna de las
    // dos comprobaciones de arriba lo cubre.
    if (ctx?.role !== 'owner') {
      console.warn(`[gmail] ${userId} intento conectar el buzon compartido sin ser owner`)
      return done(`${base}/dashboard?gmail=colabs_no_autorizado`)
    }
    // El error se mira. supabase-js no lanza, y la ruta hermana (disconnect) SI lo
    // comprobaba: sin esto se anunciaba «conectado», el dashboard saltaba a Ajustes
    // y alli seguia el boton CONECTAR. El `code` de Google es de un solo uso, asi
    // que hay que rehacer el flujo entero sin saber por que.
    //
    // `count` ademas de `error`: un update que no casa ninguna fila NO es error
    // —devuelve error null— y dejaba el mismo anuncio falso por otra puerta.
    //
    // `=== 0` y NO `!filas`, que es lo que puse primero y estaba mal. El `count`
    // solo se rellena si PostgREST devuelve la cabecera `content-range`
    // (postgrest-js: `if (countHeader && contentRange && contentRange.length > 1)`).
    // Si algun dia no llega, `count` es null y `!count` seria true: romperia la
    // conexion de Gmail para TODO EL MUNDO, siempre. Una comprobacion defensiva que
    // puede tumbar el camino bueno es peor que el hueco que tapa. Asi solo corta
    // cuando la base dice explicitamente que no toco ninguna fila.
    const { error: errColabs, count: filasColabs } = await supabase
      .from('profiles')
      .update({
        gmail_colabs_refresh_token: tokens.refresh_token,
        gmail_colabs_connected: true,
        gmail_colabs_account: email,
      }, { count: 'exact' })
      .eq('id', userId)
    if (errColabs || filasColabs === 0) {
      console.error('[gmail] no se pudo guardar el token de colabs:', errColabs?.message ?? 'ninguna fila actualizada')
      return done(`${base}/dashboard?gmail=error`)
    }
    // Y en la tabla de cuentas, que es la que mandan los sincronizadores desde
    // ahora. Se escriben LAS DOS mientras las columnas viejas existan: así volver
    // atrás es revertir el código, sin tocar la base ni pedir reconexiones.
    const gc = await guardarCuenta(supabase, { profile_id: userId, email: correoCuenta, refresh_token: refreshToken, compartida: true })
    if (!gc.ok) return done(`${base}/dashboard?gmail=error`)
    return done(`${base}/dashboard?gmail=colabs_connected`)
  }

  // Igual que la rama de colabs de arriba: sin esto se decia «Gmail personal
  // conectado» y en Ajustes seguia el boton CONECTAR, en la misma pantalla.
  const { error: errPersonal, count: filasPersonal } = await supabase
    .from('profiles')
    .update({
      gmail_refresh_token: tokens.refresh_token,
      gmail_connected: true,
      gmail_account: email,
    }, { count: 'exact' })
    .eq('id', userId)
  if (errPersonal || filasPersonal === 0) {
    console.error('[gmail] no se pudo guardar el token personal:', errPersonal?.message ?? 'ninguna fila actualizada')
    return done(`${base}/dashboard?gmail=error`)
  }

  const gcp = await guardarCuenta(supabase, { profile_id: userId, email: correoCuenta, refresh_token: refreshToken, compartida: false })
  if (!gcp.ok) return done(`${base}/dashboard?gmail=error`)

  return done(`${base}/dashboard?gmail=connected`)
}
