import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getOAuthClient } from '@/lib/gmail'
import { google } from 'googleapis'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('gmail_refresh_token, gmail_connected')
    .eq('id', user.id)
    .single()

  if (!profile?.gmail_connected || !profile.gmail_refresh_token) {
    return NextResponse.json({ connected: false, error: 'No refresh token stored' })
  }

  try {
    const oauth2Client = getOAuthClient()
    oauth2Client.setCredentials({ refresh_token: profile.gmail_refresh_token })

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const { data: info } = await oauth2.userinfo.get()

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 5,
      q: 'in:inbox',
    })

    return NextResponse.json({
      connected: true,
      gmail_account: info.email,
      token_length: profile.gmail_refresh_token.length,
      recent_message_count: listRes.data.messages?.length || 0,
    })
  } catch (err: unknown) {
    const error = err as Error & { code?: number; response?: { data?: unknown } }
    return NextResponse.json({
      connected: false,
      error: error.message,
      code: error.code,
      details: error.response?.data,
    })
  }
}
