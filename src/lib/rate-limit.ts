import { createAdminClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting.
//
// El límite de Harvey y de las rutas de IA caras se guarda en la tabla
// `rate_limits` (compartida entre todas las instancias serverless de Vercel).
// Un Map en memoria NO sirve: cada cold start crea una instancia nueva y el
// contador se reinicia.
//
// FAIL-OPEN: ante un error transitorio se permite la petición — nunca
// bloqueamos por un fallo de infraestructura. La tabla la crea
// migrations/20260809_audit_fixes.sql (ya aplicada en producción).
// ─────────────────────────────────────────────────────────────────────────────

// Devuelve true si se ha SUPERADO el límite (hay que bloquear).
export async function checkRateLimit(
  admin: SupabaseClient,
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  try {
    const now = Date.now()
    const { data, error } = await admin
      .from('rate_limits')
      .select('count, window_start')
      .eq('key', key)
      .maybeSingle()

    // Tabla ausente u otro error → fail-open (no bloquear)
    if (error) return false

    const windowStart = data ? new Date(data.window_start).getTime() : 0
    if (!data || now - windowStart > windowMs) {
      await admin.from('rate_limits').upsert({ key, count: 1, window_start: new Date(now).toISOString() })
      return false
    }
    if ((data.count ?? 0) >= limit) return true
    await admin.from('rate_limits').update({ count: (data.count ?? 0) + 1 }).eq('key', key)
    return false
  } catch {
    return false
  }
}

// Chat IA (texto): 30 mensajes/min. Se cuenta sobre chat_messages ya existentes.
export async function checkChatRateLimit(userId: string): Promise<boolean> {
  const admin = await createAdminClient()
  const since = new Date(Date.now() - 60_000).toISOString()
  const { count } = await admin
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('role', 'user')
    .gte('created_at', since)
  return (count ?? 0) >= 30
}

// Harvey (voz): 20 peticiones/min por usuario, respaldado en BD.
export async function checkHarveyRateLimit(admin: SupabaseClient, userId: string): Promise<boolean> {
  return checkRateLimit(admin, `harvey:${userId}`, 20, 60_000)
}

// Rutas de IA caras (PDF, borradores, consejos): 10 peticiones/min por usuario.
export async function checkAiRateLimit(admin: SupabaseClient, userId: string, bucket: string): Promise<boolean> {
  return checkRateLimit(admin, `ai:${bucket}:${userId}`, 10, 60_000)
}
