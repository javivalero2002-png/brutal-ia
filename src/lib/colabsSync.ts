import type { SupabaseClient } from '@supabase/supabase-js'
import { getEmailsWithRefreshToken, getGmailAccountEmail } from '@/lib/gmail'
import { analyzeEmail, EmailAnalysis } from '@/lib/ai'
import { sendPushToAll, sendPushToUser, canSendPush } from '@/lib/push'

const MEETING_RE = /meet\.google\.com\/[a-z-]+|zoom\.us\/j\/\d+|teams\.microsoft\.com\/l\/meetup/i

type SyncResult =
  | { ok: true; synced: number; total: number; account: string }
  | { ok: false; error: string; code?: number; details?: unknown }

/**
 * Sincroniza el buzón COMPARTIDO de colaboraciones.
 * Es un buzón único de la empresa: usa el refresh token de quien lo tenga conectado
 * (no el del usuario que dispara la sync) e inserta los mensajes como `shared: true`,
 * de modo que aparecen para todo el equipo. Idempotente por `gmail_id`.
 */
export async function syncColabsInbox(
  admin: SupabaseClient,
  opts: { triggeredBy?: string; max?: number } = {}
): Promise<SyncResult> {
  // Token del buzón compartido: el MÁS RECIENTE de cualquier perfil que lo tenga
  // (si alguien reconecta, su token nuevo debe ganar al viejo de otro perfil)
  const { data: owner } = await admin
    .from('profiles')
    .select('id, gmail_colabs_refresh_token')
    .not('gmail_colabs_refresh_token', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const token = owner?.gmail_colabs_refresh_token as string | undefined
  if (!token) return { ok: false, error: 'Colaboraciones not connected' }

  // El user_id de los mensajes: quien dispara la sync, o el dueño del buzón (cron)
  const ownerId = opts.triggeredBy || owner!.id

  const { data: clientsData } = await admin.from('clients').select('name')
  const knownClients = (clientsData || []).map((c: { name: string }) => c.name)

  let emails: Awaited<ReturnType<typeof getEmailsWithRefreshToken>>
  let gmailAccount = ''
  try {
    emails = await getEmailsWithRefreshToken(token, opts.max ?? 20)
    gmailAccount = await getGmailAccountEmail(token)
  } catch (err: unknown) {
    const error = err as Error & { code?: number; response?: { data?: { error?: string } } }
    const isTokenExpired = error.message?.includes('invalid_grant')
      || error.response?.data?.error === 'invalid_grant'
      || error.message?.includes('Token has been expired or revoked')

    if (isTokenExpired) {
      await admin.from('profiles').update({ gmail_colabs_connected: false, gmail_colabs_refresh_token: null }).eq('id', owner!.id)
      return { ok: false, error: 'token_expired' }
    }

    return { ok: false, error: error.message || 'Gmail API error', code: error.code, details: error.response?.data }
  }

  let newCount = 0
  const newUnread: { from_name: string; subject: string; urgent?: boolean }[] = []

  // Una sola consulta para saber cuáles ya existen (antes: un SELECT por email).
  const colabsIds = emails.map(e => e.gmail_id).filter(Boolean)
  const { data: colabsExisting } = await admin
    .from('inbox_messages')
    .select('gmail_id')
    .in('gmail_id', colabsIds)
  const colabsKnown = new Set((colabsExisting || []).map((r: { gmail_id: string }) => r.gmail_id))

  for (const email of emails) {
    if (colabsKnown.has(email.gmail_id)) continue

    let analysis: EmailAnalysis = { summary: email.subject || '(sin asunto)', action: 'Revisar email', client: 'Desconocido', urgency: 'normal' }
    try {
      analysis = await analyzeEmail(email.subject || '', (email.body_preview || '').slice(0, 800), email.from_name, knownClients)
    } catch {
      // fallback a info básica
    }

    const { error: insertError } = await admin.from('inbox_messages').insert({
      user_id: ownerId,
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
      shared: true,
      attachments: email.attachments?.length ? email.attachments : [],
    })

    if (!insertError) {
      newCount++
      // Email con enlace de reunión → tarea con fecha (aparece en el Calendario)
      const meetingText = `${email.subject || ''} ${email.body_preview || ''}`
      if (MEETING_RE.test(meetingText)) {
        const day = (email.received_at || new Date().toISOString()).slice(0, 10)
        await admin.from('tasks').insert({
          created_by: ownerId,
          text: `Reunión: ${email.subject || email.from_name || 'sin asunto'}`,
          level: 'high',
          due_date: day,
          source: 'gmail',
        })
      }
      if (email.is_unread) newUnread.push({ from_name: email.from_name || '?', subject: email.subject || '(sin asunto)', urgent: analysis.urgency === 'urgent' })
    }
  }

  // Los emails de colaboraciones son de todo el equipo: push a todos los suscritos (rate-limit 90s)
  if (newUnread.length > 0) {
    const first = newUnread[0]
    const anyUrgent = newUnread.some(m => m.urgent)
    if (await canSendPush(admin, 'company')) {
      sendPushToAll(admin, {
        title: anyUrgent ? `🔴 URGENTE · Colabs · ${first.from_name}`
          : newUnread.length === 1 ? `📩 Colabs · ${first.from_name}` : `📩 Colabs · ${newUnread.length} emails nuevos`,
        body: newUnread.length === 1 ? first.subject : `${first.from_name}: ${first.subject} y ${newUnread.length - 1} más`,
        url: '/dashboard',
        tag: 'colabs-sync',
        urgent: anyUrgent,
      }).catch(() => {})
    }
  }

  return { ok: true, synced: newCount, total: emails.length, account: gmailAccount }
}

/**
 * Sincroniza el Gmail PERSONAL de un perfil (para el cron horario: los emails
 * llegan y notifican aunque nadie tenga la app abierta). Idempotente por gmail_id.
 */
export async function syncPersonalInbox(
  admin: SupabaseClient,
  profile: { id: string; gmail_refresh_token: string | null }
): Promise<SyncResult> {
  const token = profile.gmail_refresh_token
  if (!token) return { ok: false, error: 'not connected' }

  const { data: clientsData } = await admin.from('clients').select('name')
  const knownClients = (clientsData || []).map((c: { name: string }) => c.name)

  let emails: Awaited<ReturnType<typeof getEmailsWithRefreshToken>>
  let gmailAccount = ''
  try {
    emails = await getEmailsWithRefreshToken(token, 15)
    gmailAccount = await getGmailAccountEmail(token)
  } catch (err: unknown) {
    const error = err as Error & { code?: number; response?: { data?: { error?: string } } }
    const isTokenExpired = error.message?.includes('invalid_grant')
      || error.response?.data?.error === 'invalid_grant'
      || error.message?.includes('Token has been expired or revoked')

    if (isTokenExpired) {
      await admin.from('profiles').update({ gmail_connected: false, gmail_refresh_token: null }).eq('id', profile.id)
      return { ok: false, error: 'token_expired' }
    }

    return { ok: false, error: error.message || 'Gmail API error', code: error.code }
  }

  let newCount = 0
  const newUnread: { from_name: string; subject: string; urgent?: boolean }[] = []

  // Una sola consulta para saber cuáles ya existen (antes: un SELECT por email).
  const personalIds = emails.map(e => e.gmail_id).filter(Boolean)
  const { data: personalExisting } = await admin
    .from('inbox_messages')
    .select('gmail_id')
    .in('gmail_id', personalIds)
  const personalKnown = new Set((personalExisting || []).map((r: { gmail_id: string }) => r.gmail_id))

  for (const email of emails) {
    if (personalKnown.has(email.gmail_id)) continue

    let analysis: EmailAnalysis = { summary: email.subject || '(sin asunto)', action: 'Revisar email', client: 'Desconocido', urgency: 'normal' }
    try {
      analysis = await analyzeEmail(email.subject || '', (email.body_preview || '').slice(0, 800), email.from_name, knownClients)
    } catch {}

    const { error: insertError } = await admin.from('inbox_messages').insert({
      user_id: profile.id,
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
      shared: false,
      attachments: email.attachments?.length ? email.attachments : [],
    })
    if (!insertError) {
      newCount++
      if (email.is_unread) newUnread.push({ from_name: email.from_name || '?', subject: email.subject || '(sin asunto)', urgent: analysis.urgency === 'urgent' })
    }
  }

  if (newUnread.length > 0) {
    const first = newUnread[0]
    const anyUrgent = newUnread.some(m => m.urgent)
    if (await canSendPush(admin, profile.id)) {
      sendPushToUser(admin, profile.id, {
        title: anyUrgent ? `🔴 URGENTE · ${first.from_name}`
          : newUnread.length === 1 ? `📩 ${first.from_name}` : `📩 ${newUnread.length} emails nuevos`,
        body: newUnread.length === 1 ? first.subject : `${first.from_name}: ${first.subject} y ${newUnread.length - 1} más`,
        url: '/dashboard',
        tag: 'gmail-personal',
        urgent: anyUrgent,
      }).catch(() => {})
    }
  }

  return { ok: true, synced: newCount, total: emails.length, account: gmailAccount }
}
