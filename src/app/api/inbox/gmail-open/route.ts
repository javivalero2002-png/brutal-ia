import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getOAuthClient } from '@/lib/gmail'
import { google } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'

// Resolves a Gmail message ID → thread ID → redirect to the correct Gmail URL
export async function GET(request: NextRequest) {
  const msgId = request.nextUrl.searchParams.get('id')
  if (!msgId) return NextResponse.redirect('https://mail.google.com')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    // Not authenticated — best we can do is open Gmail inbox
    return NextResponse.redirect(`https://mail.google.com/mail/u/0/#inbox`)
  }

  const admin = await createAdminClient()

  // Check if this is a shared (colabs) message to pick the right token
  const { data: inboxMsg } = await admin
    .from('inbox_messages')
    .select('shared')
    .eq('gmail_id', msgId)
    .maybeSingle()

  const isShared = !!inboxMsg?.shared

  let token: string | null = null

  if (isShared) {
    // Colabs messages live in the shared account — use its token regardless of who opened it
    const { data: colabsOwner } = await admin
      .from('profiles')
      .select('gmail_colabs_refresh_token')
      .not('gmail_colabs_refresh_token', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    token = colabsOwner?.gmail_colabs_refresh_token ?? null
  } else {
    const { data: profile } = await admin
      .from('profiles')
      .select('gmail_refresh_token')
      .eq('id', user.id)
      .single()
    token = profile?.gmail_refresh_token ?? null
  }

  if (!token) {
    return NextResponse.redirect(`https://mail.google.com/mail/u/0/#all/${msgId}`)
  }

  try {
    const oauth2Client = getOAuthClient()
    oauth2Client.setCredentials({ refresh_token: token })
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })
    const msg = await gmail.users.messages.get({ userId: 'me', id: msgId, format: 'minimal' })
    const threadId = msg.data.threadId || msgId
    return NextResponse.redirect(`https://mail.google.com/mail/u/0/#all/${threadId}`)
  } catch {
    return NextResponse.redirect(`https://mail.google.com/mail/u/0/#all/${msgId}`)
  }
}
