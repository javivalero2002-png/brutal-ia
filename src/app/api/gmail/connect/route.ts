import { createClient } from '@/lib/supabase/server'
import { getAuthUrl, OAUTH_STATE_COOKIE } from '@/lib/gmail'
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = request.nextUrl.searchParams.get('account') === 'colabs' ? 'colabs' : 'personal'

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
