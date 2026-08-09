import webpush from 'web-push'
import type { SupabaseClient } from '@supabase/supabase-js'

// Las suscripciones push se guardan en la tabla `reglas` como filas especiales
// (name = PUSH_ROW) para no requerir una migración de esquema:
//   description    → endpoint (identificador único de la suscripción)
//   condition_text → JSON completo de la suscripción (endpoint + claves)
//   created_by     → usuario dueño de la suscripción
// La API de reglas y la UI las filtran por nombre.
export const PUSH_ROW = '__push_subscription__'

let configured = false
function ensureConfigured() {
  if (configured) return true
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) {
    // Sin este log, todo el sistema de notificaciones puede estar apagado y no
    // hay forma de saberlo: todos los llamantes rematan con `.catch(() => {})`.
    console.error('[push] faltan las claves VAPID — las notificaciones están desactivadas')
    return false
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:pablo@brutalstudios.es', pub, priv)
  configured = true
  return true
}

export type PushPayload = { title: string; body?: string; url?: string; tag?: string; urgent?: boolean }

// Throttle de notificaciones por ámbito ('company' o un user_id). Usa la tabla
// dedicada `push_rate_limits`; si aún no existe (migración pendiente), permite
// el envío en lugar de bloquearlo. Devuelve true si SE PUEDE enviar.
export async function canSendPush(admin: SupabaseClient, scope: string, windowMs = 90_000): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from('push_rate_limits')
      .select('last_sent')
      .eq('scope', scope)
      .maybeSingle()
    if (error) return true // tabla ausente → no bloquear
    const last = data ? new Date(data.last_sent).getTime() : 0
    if (Date.now() - last <= windowMs) return false
    await admin.from('push_rate_limits').upsert({ scope, last_sent: new Date().toISOString() })
    return true
  } catch {
    return true
  }
}

// Registra el aviso en el historial (best-effort). Si la tabla notification_log
// aún no existe (migración pendiente), el fallo se ignora silenciosamente.
async function logNotifications(admin: SupabaseClient, userIds: string[], payload: PushPayload) {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (ids.length === 0) return
  try {
    await admin.from('notification_log').insert(
      ids.map(user_id => ({ user_id, title: payload.title, body: payload.body || null, url: payload.url || null, tag: payload.tag || null }))
    )
  } catch { /* tabla ausente o error transitorio: no bloquear el envío */ }
}

async function sendToRows(admin: SupabaseClient, rows: { id: string; condition_text: string | null }[], payload: PushPayload) {
  if (!ensureConfigured() || rows.length === 0) return 0
  let sent = 0
  await Promise.all(rows.map(async (row) => {
    try {
      const sub = JSON.parse(row.condition_text || '')
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600 })
      sent++
    } catch (err: any) {
      // Suscripción caducada o revocada: eliminarla
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await admin.from('reglas').delete().eq('id', row.id)
      } else {
        // Cualquier otro fallo (p. ej. 403 por VAPID mal firmada) se tragaba
        // entero, así que un push roto era indistinguible de "nadie suscrito".
        console.error('[push] envío fallido:', err?.statusCode, err?.message)
      }
    }
  }))
  return sent
}

export async function sendPushToUser(admin: SupabaseClient, userId: string, payload: PushPayload) {
  const { data } = await admin.from('reglas').select('id,condition_text').eq('name', PUSH_ROW).eq('created_by', userId)
  await logNotifications(admin, [userId], payload)
  return sendToRows(admin, data || [], payload)
}

export async function sendPushToAll(admin: SupabaseClient, payload: PushPayload, exceptUserId?: string) {
  let q = admin.from('reglas').select('id,condition_text,created_by').eq('name', PUSH_ROW)
  if (exceptUserId) q = q.neq('created_by', exceptUserId)
  const { data } = await q
  await logNotifications(admin, (data || []).map((r: any) => r.created_by), payload)
  return sendToRows(admin, data || [], payload)
}
