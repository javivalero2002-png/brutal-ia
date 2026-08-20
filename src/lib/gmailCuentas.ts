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
  // La MÁS RECIENTE, no la más antigua. El código que esto sustituyó decía por
  // qué, y la razón no cambió: «si alguien reconecta, su token nuevo debe ganar al
  // viejo». Con `ascending: true` pasaba justo lo contrario — reconectar el buzón
  // compartido después de que caducara creaba una fila nueva que SIEMPRE perdía
  // contra la vieja y muerta, así que reconectarlo no lo arreglaba nunca.
  const { data, error } = await admin
    .from('gmail_cuentas')
    .select('id, profile_id, email, refresh_token, compartida')
    .eq('compartida', true)
    .order('creada_at', { ascending: false })
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

/**
 * Retirar una conexión.
 *
 * Mira dos cosas que la primera versión no miraba: cuántas filas borró de verdad
 * —un `delete` sin filas no es un error en Postgres, así que sin esto un email mal
 * escrito respondía «desconectada» sin haber desconectado nada— y si esa dirección
 * es también la que vive en las columnas viejas de `profiles`. Mientras esas
 * columnas existan como respaldo, dejarlas con el token vivo después de borrar la
 * fila de la tabla es el mismo fallo desde el otro lado: el cron se cae a ellas y
 * el correo sigue entrando después de haber dicho que no.
 */
export async function quitarCuenta(
  admin: SupabaseClient,
  profileId: string,
  email: string,
): Promise<{ ok: boolean; quitadas: number; error?: string }> {
  const correo = email.toLowerCase().trim()
  const { data, error } = await admin
    .from('gmail_cuentas')
    .delete()
    .eq('profile_id', profileId)
    .eq('email', correo)
    .select('id')
  if (error) {
    console.error('[gmail] no se pudo quitar la cuenta:', error.message)
    return { ok: false, quitadas: 0, error: error.message }
  }
  const quitadas = data?.length || 0

  // Si esa misma dirección es la de las columnas viejas, se limpian también. Se
  // hace por DIRECCIÓN y no a ciegas: borrar `gmail_refresh_token` porque se quitó
  // CUALQUIER cuenta desconectaría de golpe la que la persona quería conservar.
  const { data: perfil } = await admin
    .from('profiles').select('gmail_account, gmail_colabs_account').eq('id', profileId).maybeSingle()
  if (perfil?.gmail_account?.toLowerCase().trim() === correo) {
    await admin.from('profiles').update({ gmail_connected: false, gmail_refresh_token: null, gmail_account: null }).eq('id', profileId)
  }
  if (perfil?.gmail_colabs_account?.toLowerCase().trim() === correo) {
    await admin.from('profiles').update({ gmail_colabs_connected: false, gmail_colabs_refresh_token: null, gmail_colabs_account: null }).eq('id', profileId)
  }

  return { ok: true, quitadas }
}

/**
 * Retirar TODAS las conexiones que cumplan un criterio, sin conocer sus emails uno
 * a uno.
 *
 * Para `/api/gmail/disconnect`: el botón de desconectar borra por perfil o por
 * «es la compartida», no por dirección — al revés que `quitarCuenta`, que borra
 * una concreta porque la persona ya sabe cuál.
 */
export async function quitarCuentaTodas(
  admin: SupabaseClient,
  criterio: { profileId?: string; compartida: boolean },
): Promise<string | null> {
  let q = admin.from('gmail_cuentas').delete().eq('compartida', criterio.compartida)
  if (criterio.profileId) q = q.eq('profile_id', criterio.profileId)
  const { error } = await q
  return error?.message ?? null
}
