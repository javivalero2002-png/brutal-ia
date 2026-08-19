import webpush from 'web-push'
import type { SupabaseClient } from '@supabase/supabase-js'

// Las suscripciones push se guardan en la tabla `reglas` como filas especiales
// (name = PUSH_ROW) para no requerir una migración de esquema:
//   description    → endpoint (identificador único de la suscripción)
//   condition_text → JSON completo de la suscripción (endpoint + claves)
//   created_by     → usuario dueño de la suscripción
// La API de reglas y la UI las filtran por nombre.
// Definido en reglaRows.ts junto al resto de filas que no son reglas, para que el
// filtro que las excluye y los nombres no puedan volver a separarse. Se reexporta
// aquí porque varios llamantes ya lo importaban desde este módulo.
export { PUSH_ROW } from '@/lib/reglaRows'
import { PUSH_ROW, PREFS_ROW } from '@/lib/reglaRows'
import { quiereAviso, type CategoriaAviso } from '@/lib/avisos'

let configured = false
function ensureConfigured() {
  if (configured) return true
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) {
    // Sin este log, todo el sistema de notificaciones puede estar apagado y no
    // hay forma de saberlo: esto no lanza, así que el llamante solo ve un 0 —
    // idéntico a "nadie suscrito".
    console.error('[push] faltan las claves VAPID — las notificaciones están desactivadas')
    return false
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:pablo@brutalstudios.es', pub, priv)
  configured = true
  return true
}

export type PushPayload = {
  title: string
  body?: string
  url?: string
  tag?: string
  urgent?: boolean
  /**
   * De qué es este aviso. OBLIGATORIA: sin ella no se puede saber si quien lo
   * recibe la ha silenciado, y —peor— la pantalla de Notificaciones se queda
   * describiendo una lista que ya no es la de verdad. Hay una regla que la exige.
   */
  categoria: CategoriaAviso
}

// La fila vive en `reglaRows.ts` con las otras que no son reglas: declararla
// aquí la habría dejado fuera del filtro, y el panel de Automatizaciones la
// contaría como una automatización. Ya pasó con el logo de cuenta.
export { PREFS_ROW } from '@/lib/reglaRows'

/**
 * Qué categorías ha silenciado esta gente. Una consulta para todos.
 *
 * Devuelve un mapa userId → preferencias. Los que no aparecen no han tocado
 * nada, y eso significa QUE LO QUIEREN TODO: quien activó los avisos espera
 * recibirlos, y solo silencia quien lo pide expresamente.
 */
async function leerPrefs(admin: SupabaseClient, userIds: string[]): Promise<Record<string, Record<string, boolean>>> {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (!ids.length) return {}
  const { data, error } = await admin
    .from('reglas').select('created_by,condition_text').eq('name', PREFS_ROW).in('created_by', ids)
  // Si no se pueden leer, se manda igual. Perder un aviso por no saber si alguien
  // lo quería es peor que mandar uno de más: el silencio no se nota, el ruido sí.
  if (error) {
    console.error('[push] no se pudieron leer las preferencias de avisos:', error.message)
    return {}
  }
  const mapa: Record<string, Record<string, boolean>> = {}
  for (const r of data || []) {
    try { mapa[(r as any).created_by] = JSON.parse((r as any).condition_text || '{}') } catch { /* ilegible = todo */ }
  }
  return mapa
}

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
    // `error` recogido: el catch de abajo solo pilla lo que LANZA, y supabase-js
    // no lanza. Sin esto, la tabla existiendo pero rechazando la fila era silencio
    // absoluto, indistinguible de haberla escrito.
    const { error } = await admin.from('notification_log').insert(
      ids.map(user_id => ({ user_id, title: payload.title, body: payload.body || null, url: payload.url || null, tag: payload.tag || null }))
    )
    if (error) console.error('[push] no se pudo registrar el aviso:', error.message)
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

// "Cero suscritos" y "no se pudo mirar quién está suscrito" son cosas distintas,
// y hasta aquí se devolvían igual: un 0. Con `const { data }` a secas —supabase-js
// NO lanza, devuelve { data: null, error }— un timeout o un fallo de permisos en
// `reglas` dejaba `data` en null, `sendToRows` recibía [] y la función salía con 0
// sin llegar siquiera a `ensureConfigured`.
//
// Eso mentía en los dos extremos: en el servidor todos los llamantes lo remataban
// con `.catch(() => {})`, y /api/push/test contestaba `{ ok: true, sent: 0 }`, que
// la UI traduce como «Sin dispositivos suscritos» — un diagnóstico falso que manda
// a revisar los permisos del navegador cuando el problema está en la base.
//
// Por eso se LANZA en vez de devolver 0: así 0 significa "cero suscritos" y nada
// más. TODOS los llamantes envuelven el envío en try/catch con console.error
// (inbox, tasks, gmail/sync, colabsSync y las reglas de aviso de automations, donde
// además el try/catch impide que un aviso roto pare el motor entero). Y
// /api/push/test distingue ahora los dos casos que antes daban el mismo mensaje:
// 409 «no hay dispositivos suscritos» frente a 503 «no se pudieron leer».
function fallaLectura(scope: string, error: { message: string }): never {
  console.error(`[push] no se pudieron leer las suscripciones (${scope}):`, error.message)
  throw new Error(`[push] no se pudieron leer las suscripciones: ${error.message}`)
}

export async function sendPushToUser(admin: SupabaseClient, userId: string, payload: PushPayload) {
  // Lo primero, ¿lo quiere? Si no, ni se lee su suscripción ni se registra en el
  // historial: un aviso silenciado no ha ocurrido para quien lo silenció.
  const prefs = await leerPrefs(admin, [userId])
  if (!quiereAviso(prefs[userId], payload.categoria)) return 0

  const { data, error } = await admin.from('reglas').select('id,condition_text').eq('name', PUSH_ROW).eq('created_by', userId)
  if (error) fallaLectura(`usuario ${userId}`, error)
  await logNotifications(admin, [userId], payload)
  return sendToRows(admin, data || [], payload)
}

export async function sendPushToAll(admin: SupabaseClient, payload: PushPayload, exceptUserId?: string) {
  let q = admin.from('reglas').select('id,condition_text,created_by').eq('name', PUSH_ROW)
  if (exceptUserId) q = q.neq('created_by', exceptUserId)
  // Gemela de la de arriba: descartaba `error` igual, y esta avisa a los siete.
  const { data, error } = await q
  if (error) fallaLectura('todo el equipo', error)

  // Se filtra POR PERSONA: en un envío a todo el equipo, quien haya silenciado
  // esa categoría no lo recibe, y los demás sí. Antes o lo recibían todos o
  // ninguno, que es lo mismo que no poder elegir.
  const prefs = await leerPrefs(admin, (data || []).map((r: any) => r.created_by))
  const quieren = (data || []).filter((r: any) => quiereAviso(prefs[r.created_by], payload.categoria))
  if (!quieren.length) return 0

  await logNotifications(admin, quieren.map((r: any) => r.created_by), payload)
  return sendToRows(admin, quieren, payload)
}
