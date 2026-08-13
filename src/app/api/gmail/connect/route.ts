import { createClient } from '@/lib/supabase/server'
import { getAuthCtx } from '@/lib/authz'
import { getAuthUrl, OAUTH_STATE_COOKIE } from '@/lib/gmail'
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = request.nextUrl.searchParams.get('account') === 'colabs' ? 'colabs' : 'personal'

  // Simetria con /api/gmail/disconnect, que ya exige owner para colabs.
  //
  // Faltaba aqui, y la asimetria era el bug: DESconectar el buzon compartido estaba
  // protegido, pero CONECTARLO no. Cualquiera del equipo podia apuntar el correo de
  // la empresa a su Gmail personal — el token de colabs se guarda en el perfil de
  // quien conecta, asi que el buzon compartido de los siete pasaba a leer su bandeja.
  // Y sin mala fe: basta con pulsar el boton equivocado en Sincronizacion.
  if (account === 'colabs') {
    const ctx = await getAuthCtx()
    if (!ctx || ctx.role !== 'owner') {
      return NextResponse.json(
        { error: 'Solo el propietario puede conectar el buzón compartido' },
        { status: 403 },
      )
    }
  }

  // Nonce anti-CSRF: viaja en el `state` de OAuth Y en una cookie httpOnly. El
  // callback exige que coincidan, así que un tercero no puede fabricar un enlace
  // de callback válido — no puede escribir esta cookie.
  const nonce = randomBytes(32).toString('hex')

  const res = NextResponse.redirect(getAuthUrl(user.id, account, nonce))
  res.cookies.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // 'lax' y no 'strict': el callback llega desde Google
    path: '/',
    maxAge: 1200, // 20 min: 4 scopes + selector de cuenta + posible login. Sigue
    // siendo de un solo uso y atado a la sesión (el callback exige user.id === userId).
  })
  return res
}
