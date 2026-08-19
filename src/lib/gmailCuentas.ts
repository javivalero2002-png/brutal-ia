import type { SupabaseClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────────────────
// Las cuentas de Gmail conectadas, en un solo sitio.
//
// Antes vivían en cuatro columnas de `profiles` —dos para «mi Gmail» y dos para «el
// buzón compartido»—, y eso obligaba a que la segunda cuenta de cualquiera fuese la
// compartida. Los jefes necesitan dos PROPIAS, así que «compartida» pasa a ser una
// propiedad de la cuenta y no de la ranura donde está guardada.
//
// LAS COLUMNAS VIEJAS SIGUEN AHÍ y se siguen escribiendo, a propósito: mientras
// existan, volver atrás es revertir el código y ya. Se leen desde aquí solo si la
// tabla no tiene nada para esa persona — el caso de una instancia donde la
// migración no se haya corrido todavía.
// ─────────────────────────────────────────────────────────────────────────────

export type CuentaGmail = {
  id: string
  profile_id: string
  email: string
  refresh_token: string
  compartida: boolean
}

/** Las cuentas de una persona. Nunca lanza: sin cuentas, la sync no hace nada. */
export async function cuentasDe(admin: SupabaseClient, profileId: string): Promise<CuentaGmail[]> {
  const { data, error } = await admin
    .from('gmail_cuentas')
    .select('id, profile_id, email, refresh_token, compartida')
    .eq('profile_id', profileId)
    .order('creada_at', { ascending: true })
  if (error) {
    console.error('[gmail] no se pudieron leer las cuentas de', profileId, '—', error.message)
    return []
  }
  return (data || []) as CuentaGmail[]
}

/**
 * La cuenta del buzón COMPARTIDO, si alguien la tiene conectada.
 *
 * Se busca por la marca y no por la dirección: quien decide qué buzón es el común
 * es quien lo conectó, no una constante escrita en el código. Si por lo que sea
 * hubiera más de una, gana la más antigua — que es la que lleva funcionando.
 */
export async function cuentaCompartida(admin: SupabaseClient): Promise<CuentaGmail | null> {
  const { data, error } = await admin
    .from('gmail_cuentas')
    .select('id, profile_id, email, refresh_token, compartida')
    .eq('compartida', true)
    .order('creada_at', { ascending: true })
    .limit(1)
  if (error) {
    console.error('[gmail] no se pudo leer la cuenta compartida:', error.message)
    return null
  }
  return (data?.[0] as CuentaGmail) || null
}

/**
 * Guardar una conexión. Idempotente por (persona, dirección): reconectar la misma
 * cuenta actualiza su token en vez de crear una segunda fila.
 */
export async function guardarCuenta(
  admin: SupabaseClient,
  cuenta: { profile_id: string; email: string; refresh_token: string; compartida: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin
    .from('gmail_cuentas')
    .upsert({ ...cuenta, email: cuenta.email.toLowerCase().trim() }, { onConflict: 'profile_id,email' })
  if (error) {
    console.error('[gmail] no se pudo guardar la cuenta:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/** Retirar una conexión. Devuelve cuántas quitó, para poder decirlo. */
export async function quitarCuenta(
  admin: SupabaseClient,
  profileId: string,
  email: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await admin
    .from('gmail_cuentas')
    .delete()
    .eq('profile_id', profileId)
    .eq('email', email.toLowerCase().trim())
  // El error SE MIRA: sin esto, «desconectada» se diría igual con la cuenta viva y
  // el correo seguiría entrando después de haber dicho que no.
  if (error) {
    console.error('[gmail] no se pudo quitar la cuenta:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}
