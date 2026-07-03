import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getEmailsWithRefreshToken } from '@/lib/gmail'
import { analyzeEmail } from '@/lib/ai'
import { NextResponse } from 'next/server'

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

  const emails = await getEmailsWithRefreshToken(profile.gmail_refresh_token, 20)

  let newCount = 0

  for (const email of emails) {
    const { data: existing } = await admin
      .from('inbox_messages')
      .select('id')
      .eq('gmail_id', email.gmail_id)
      .single()

    if (existing) continue

    const analysis = await analyzeEmail(
      email.subject || '',
      email.body_preview || '',
      email.from_name,
      knownClients
    )

    await admin.from('inbox_messages').insert({
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
    })

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

  return NextResponse.json({ synced: newCount, total: emails.length })
}
