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
  if (!pub || !priv) return false
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:pablo@brutalstudios.es', pub, priv)
  configured = true
  return true
}

export type PushPayload = { title: string; body?: string; url?: string; tag?: string; urgent?: boolean }

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
      }
    }
  }))
  return sent
}

export async function sendPushToUser(admin: SupabaseClient, userId: string, payload: PushPayload) {
  const { data } = await admin.from('reglas').select('id,condition_text').eq('name', PUSH_ROW).eq('created_by', userId)
  return sendToRows(admin, data || [], payload)
}

export async function sendPushToAll(admin: SupabaseClient, payload: PushPayload, exceptUserId?: string) {
  let q = admin.from('reglas').select('id,condition_text').eq('name', PUSH_ROW)
  if (exceptUserId) q = q.neq('created_by', exceptUserId)
  const { data } = await q
  return sendToRows(admin, data || [], payload)
}
