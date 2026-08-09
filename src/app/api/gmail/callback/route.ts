import { createClient, createAdminClient } from '@/lib/supabase/server'
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

  // Resolve the authenticated email address and cache it in the profile
  let email: string | null = null
  try {
    oauth2Client.setCredentials({ refresh_token: tokens.refresh_token })
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const { data: info } = await oauth2.userinfo.get()
    email = info.email || null
  } catch {}

  const supabase = await createAdminClient()

  if (account === 'colabs') {
    await supabase
      .from('profiles')
      .update({
        gmail_colabs_refresh_token: tokens.refresh_token,
        gmail_colabs_connected: true,
        gmail_colabs_account: email,
      })
      .eq('id', userId)
    return done(`${base}/dashboard?gmail=colabs_connected`)
  }

  await supabase
    .from('profiles')
    .update({
      gmail_refresh_token: tokens.refresh_token,
      gmail_connected: true,
      gmail_account: email,
    })
    .eq('id', userId)

  return done(`${base}/dashboard?gmail=connected`)
}
