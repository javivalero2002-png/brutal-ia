import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getEmailsWithRefreshToken, getGmailAccountEmail } from '@/lib/gmail'
import { analyzeEmail, EmailAnalysis } from '@/lib/ai'
import { NextResponse } from 'next/server'

const COMPANY_EMAIL = 'colaboraciones@brutalstudios.es'

export async function POST() {
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
    return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 })
  }

  const { data: clientsData } = await admin.from('clients').select('name')
  const knownClients = (clientsData || []).map(c => c.name)

  let emails: Awaited<ReturnType<typeof getEmailsWithRefreshToken>>
  let gmailAccount = ''
  try {
    emails = await getEmailsWithRefreshToken(profile.gmail_refresh_token, 20)
    gmailAccount = await getGmailAccountEmail(profile.gmail_refresh_token)
  } catch (err: unknown) {
    const error = err as Error & { code?: number; response?: { data?: unknown } }
    return NextResponse.json(
      { error: 'Gmail API error', message: error.message, code: error.code, details: error.response?.data },
      { status: 500 }
    )
  }

  // Messages from the company email are visible to the whole team
  const isCompanyAccount = gmailAccount === COMPANY_EMAIL

  let newCount = 0

  for (const email of emails) {
    const { data: existing } = await admin
      .from('inbox_messages')
      .select('id')
      .eq('gmail_id', email.gmail_id)
      .single()

    if (existing) continue

    let analysis: EmailAnalysis = { summary: email.subject || '(sin asunto)', action: 'Revisar email', client: 'Desconocido', urgency: 'normal' }
    try {
      analysis = await analyzeEmail(
        email.subject || '',
        (email.body_preview || '').slice(0, 800),
        email.from_name,
        knownClients
      )
    } catch {
      // AI analysis failed — save email with basic info anyway
    }

    const { error: insertErr } = await admin.from('inbox_messages').insert({
      user_id: user.id,
      source: 'gmail',
      gmail_id: email.gmail_id,
      from_name: email.from_name,
      from_email: email.from_email,
      subject: email.subject,
      body_preview: email.body_preview,
      ai_summary: analysis.summary,
      ai_action: analysis.action,
      ai_client: analysis.client,
      ai_urgency: analysis.urgency,
      is_read: !email.is_unread,
      is_unread: email.is_unread,
      received_at: email.received_at,
      shared: isCompanyAccount,
      attachments: email.attachments?.length ? email.attachments : [],
    })

    if (insertErr) continue

    if (analysis.suggestedTask) {
      await admin.from('tasks').insert({
        created_by: user.id,
        text: analysis.suggestedTask,
        level: analysis.urgency === 'urgent' ? 'urgent' : 'high',
        source: 'gmail',
      })
    }

    newCount++
  }

  return NextResponse.json({ synced: newCount, total: emails.length, account: gmailAccount, shared: isCompanyAccount })
}
