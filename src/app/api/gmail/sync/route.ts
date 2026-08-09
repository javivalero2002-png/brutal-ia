import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getEmailsWithRefreshToken, getGmailAccountEmail } from '@/lib/gmail'
import { analyzeEmail, EmailAnalysis } from '@/lib/ai'
import { NextResponse } from 'next/server'
import { sendPushToUser, sendPushToAll, canSendPush } from '@/lib/push'

// Hasta 20 analisis de email con Claude en secuencia: el default de Vercel se queda corto.
export const maxDuration = 60

const MEETING_RE = /meet\.google\.com\/[a-z-]+|zoom\.us\/j\/\d+|teams\.microsoft\.com\/l\/meetup/i

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
    const error = err as Error & { code?: number; response?: { data?: { error?: string } } }
    const isTokenExpired = error.message?.includes('invalid_grant')
      || error.response?.data?.error === 'invalid_grant'
      || error.message?.includes('Token has been expired or revoked')

    if (isTokenExpired) {
      await admin.from('profiles').update({ gmail_connected: false, gmail_refresh_token: null }).eq('id', user.id)
      return NextResponse.json(
        { error: 'token_expired', message: 'El token de Gmail ha caducado. Reconecta tu cuenta desde Operativa → Sincronización.' },
        { status: 401 }
      )
    }

    console.error('Gmail sync error:', error.message, error.code)
    return NextResponse.json(
      { error: 'gmail_error', message: 'Error al conectar con Gmail. Inténtalo de nuevo.' },
      { status: 500 }
    )
  }

  // Messages from the company email are visible to the whole team
  const isCompanyAccount = gmailAccount === COMPANY_EMAIL

  // Count existing undone gmail-sourced tasks for this user
  const { count: existingGmailTasks } = await admin
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', user.id)
    .eq('source', 'gmail')
    .eq('done', false)
  let gmailTasksCreated = existingGmailTasks || 0
  const GMAIL_TASK_LIMIT = 4

  let newCount = 0
  let aiFailures = 0
  const newUnread: { from_name: string; subject: string; urgency: string }[] = []

  // Una sola consulta para saber cuáles ya existen (antes: un SELECT por email).
  const gmailIds = emails.map(e => e.gmail_id).filter(Boolean)
  const { data: existingRows } = await admin
    .from('inbox_messages')
    .select('gmail_id')
    .in('gmail_id', gmailIds)
  const known = new Set((existingRows || []).map((r: { gmail_id: string }) => r.gmail_id))

  for (const email of emails) {
    if (known.has(email.gmail_id)) continue

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
      aiFailures++
    }
    // analyzeEmail captura por dentro y no lanza: la señal real de degradación
    // es este flag, no el catch de arriba.
    if (analysis.degraded) aiFailures++

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

    // Solo el correo de colaboraciones genera tareas — cuentas personales no
    if (isCompanyAccount && analysis.suggestedTask && analysis.urgency !== 'normal' && gmailTasksCreated < GMAIL_TASK_LIMIT) {
      const { error: taskErr } = await admin.from('tasks').insert({
        created_by: user.id,
        text: analysis.suggestedTask,
        level: analysis.urgency === 'urgent' ? 'urgent' : 'high',
        source: 'gmail',
      })
      if (!taskErr) gmailTasksCreated++
    }

    // Email con enlace de reunión → tarea con fecha (aparece en el Calendario)
    const meetingText = `${email.subject || ''} ${email.body_preview || ''}`
    if (MEETING_RE.test(meetingText)) {
      const day = (email.received_at || new Date().toISOString()).slice(0, 10)
      await admin.from('tasks').insert({
        created_by: user.id,
        assigned_to: isCompanyAccount ? null : user.id,
        text: `Reunión: ${email.subject || email.from_name || 'sin asunto'}`,
        level: 'high',
        due_date: day,
        source: 'gmail',
      })
    }

    if (email.is_unread) newUnread.push({ from_name: email.from_name || '?', subject: email.subject || '(sin asunto)', urgency: analysis.urgency })
    newCount++
  }

  // Notificación push por los emails nuevos sin leer (con rate-limit de 90s para evitar duplicados)
  if (newUnread.length > 0) {
    const first = newUnread[0]
    const payload = {
      title: newUnread.length === 1 ? `📩 ${first.from_name}` : `📩 ${newUnread.length} emails nuevos`,
      body: newUnread.length === 1 ? first.subject : `${first.from_name}: ${first.subject} y ${newUnread.length - 1} más`,
      url: '/dashboard',
      tag: 'gmail-sync',
    }
    const lockKey = isCompanyAccount ? 'company' : user.id
    if (await canSendPush(admin, lockKey)) {
      if (isCompanyAccount) sendPushToAll(admin, payload).catch(() => {})
      else sendPushToUser(admin, user.id, payload).catch(() => {})
    }
  }

  if (aiFailures) console.error(`[sync] analyzeEmail falló en ${aiFailures} de ${emails.length} emails`)
  return NextResponse.json({ synced: newCount, total: emails.length, account: gmailAccount, shared: isCompanyAccount, aiFailures })
}
