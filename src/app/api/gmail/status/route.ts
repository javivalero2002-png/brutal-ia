import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getOAuthClient } from '@/lib/gmail'
import { google } from 'googleapis'
import { NextResponse } from 'next/server'

async function validateToken(refreshToken: string): Promise<{ valid: boolean; email: string | null }> {
  try {
    const oauth2Client = getOAuthClient()
    oauth2Client.setCredentials({ refresh_token: refreshToken })
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const { data: info } = await oauth2.userinfo.get()
    return { valid: true, email: info.email || null }
  } catch (err: unknown) {
    const error = err as Error & { response?: { data?: { error?: string } } }
    const isExpired = error.message?.includes('invalid_grant')
      || error.response?.data?.error === 'invalid_grant'
      || error.message?.includes('Token has been expired or revoked')
    return { valid: !isExpired, email: null }
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('gmail_connected, gmail_account, gmail_refresh_token, gmail_colabs_connected, gmail_colabs_account, gmail_colabs_refresh_token')
    .eq('id', user.id)
    .single()

  const hasPersonalToken = !!(profile?.gmail_connected && profile?.gmail_refresh_token)

  // Validate the personal token if it exists
  let personalConnected = hasPersonalToken
  let personalExpired = false
  let gmailAccount = profile?.gmail_account || null

  if (hasPersonalToken) {
    const result = await validateToken(profile!.gmail_refresh_token!)
    if (!result.valid) {
      personalConnected = false
      personalExpired = true
      await admin.from('profiles').update({ gmail_connected: false, gmail_refresh_token: null }).eq('id', user.id)
    } else if (result.email && !gmailAccount) {
      gmailAccount = result.email
      await admin.from('profiles').update({ gmail_account: result.email }).eq('id', user.id)
    }
  }

  // Colaboraciones: shared mailbox — connected if ANY team member has token
  const { data: colabsOwner } = await admin
    .from('profiles')
    .select('id, gmail_colabs_account, gmail_colabs_refresh_token')
    .not('gmail_colabs_refresh_token', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let colabsConnected = !!colabsOwner
  let colabsExpired = false

  if (colabsOwner?.gmail_colabs_refresh_token) {
    const result = await validateToken(colabsOwner.gmail_colabs_refresh_token)
    if (!result.valid) {
      colabsConnected = false
      colabsExpired = true
      await admin.from('profiles').update({ gmail_colabs_connected: false, gmail_colabs_refresh_token: null }).eq('id', colabsOwner.id)
    }
  }

  return NextResponse.json({
    connected: personalConnected,
    gmail_account: gmailAccount,
    personal_expired: personalExpired,
    colabs_connected: colabsConnected,
    colabs_account: colabsOwner?.gmail_colabs_account || 'colaboraciones@brutalstudios.es',
    colabs_expired: colabsExpired,
  })
}
