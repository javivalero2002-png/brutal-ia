import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getOAuthClient } from '@/lib/gmail'
import { google } from 'googleapis'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const gmailMessageId = searchParams.get('msgId')
  const attachmentId = searchParams.get('attId')
  const rawFilename = searchParams.get('filename') || 'download'
  const filename = rawFilename.replace(/[^\w.\-]/g, '_').slice(0, 200)

  if (!gmailMessageId || !attachmentId) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()

  // Check if this attachment belongs to a shared (colabs) message
  const { data: inboxMsg } = await admin
    .from('inbox_messages')
    .select('shared')
    .eq('gmail_id', gmailMessageId)
    .maybeSingle()

  let token: string | null = null

  if (inboxMsg?.shared) {
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
    return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 })
  }

  const oauth2Client = getOAuthClient()
  oauth2Client.setCredentials({ refresh_token: token })
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

  let data: string | null | undefined
  try {
    const att = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: gmailMessageId,
      id: attachmentId,
    })
    data = att.data.data
  } catch {
    return NextResponse.json({ error: 'No se pudo descargar el adjunto' }, { status: 502 })
  }
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
