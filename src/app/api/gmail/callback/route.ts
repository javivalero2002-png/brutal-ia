import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getOAuthClient } from '@/lib/gmail'
import { google } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state') || ''
  const oauthError = searchParams.get('error')

  if (oauthError) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL || ''}/dashboard?gmail=denied`)
  }

  if (!code || !state) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL || ''}/dashboard?gmail=error`)
  }

  const [userId, account = 'personal'] = state.split(':')

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user || user.id !== userId) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL || ''}/dashboard?gmail=error`)
  }

  if (!userId) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL || ''}/dashboard?gmail=error`)
  }

  const oauth2Client = getOAuthClient()
  let tokens: { refresh_token?: string | null } = {}
  try {
    const result = await oauth2Client.getToken(code)
    tokens = result.tokens as { refresh_token?: string | null }
  } catch {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL || ''}/dashboard?gmail=error`)
  }

  if (!tokens.refresh_token) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL || ''}/dashboard?gmail=no_refresh_token`)
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
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL || ''}/dashboard?gmail=colabs_connected`)
  }

  await supabase
    .from('profiles')
    .update({
      gmail_refresh_token: tokens.refresh_token,
      gmail_connected: true,
      gmail_account: email,
    })
    .eq('id', userId)

  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL || ''}/dashboard?gmail=connected`)
}
