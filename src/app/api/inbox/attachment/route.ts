import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getOAuthClient } from '@/lib/gmail'
import { google } from 'googleapis'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const gmailMessageId = searchParams.get('msgId')
  const attachmentId = searchParams.get('attId')
  const filename = searchParams.get('filename') || 'download'

  if (!gmailMessageId || !attachmentId) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('gmail_refresh_token, gmail_connected')
    .eq('id', user.id)
    .single()

  if (!profile?.gmail_refresh_token) {
    return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 })
  }

  const oauth2Client = getOAuthClient()
  oauth2Client.setCredentials({ refresh_token: profile.gmail_refresh_token })
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

  const att = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId: gmailMessageId,
    id: attachmentId,
  })

  const data = att.data.data
  if (!data) return NextResponse.json({ error: 'No data' }, { status: 404 })

  const bytes = Buffer.from(data, 'base64url')
  return new Response(bytes, {
    headers: {
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(bytes.length),
    },
  })
}
