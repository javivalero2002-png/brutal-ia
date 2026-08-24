import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * El único sitio por el que entran mensajes en `inbox_messages`.
 *
 * Existe por una razón concreta: la columna `cuenta` —de qué buzón entró el
 * correo, migración `20260824_inbox_cuenta.sql`— la escriben TRES caminos
 * distintos (el sync compartido, el personal, y la cola de aplazados). Si la
 * migración no se ha corrido todavía, los tres fallan con 42703 y el equipo se
 * queda sin correo entrante SIN QUE NADIE VEA UN ERROR: los correos simplemente
 * dejan de aparecer. Es el modo de fallo más caro de este repo, y ya mordió con
 * las fuentes bloqueadas por la CSP y con el sync que no desplegaba.
 *
 * Así que aquí se reintenta una vez sin la columna. Es andamio temporal: en
 * cuanto la migración esté aplicada en todas partes, esto se puede quitar —y la
 * regla de `regresiones.test.ts` que exige `cuenta` seguirá valiendo—.
 *
 * La marca es de módulo para no pagar un insert fallido por cada mensaje. Se
 * reinicia sola en el siguiente arranque en frío, así que aplicar la migración
 * surte efecto en minutos sin tener que tocar nada.
 */
let faltaColumnaCuenta = false

export async function insertarEnInbox(
  admin: SupabaseClient,
  filas: Record<string, unknown> | Record<string, unknown>[],
) {
  if (!faltaColumnaCuenta) {
    const r = await admin.from('inbox_messages').insert(filas as never)
    if (!r.error) return r
    if (r.error.code !== '42703') return r
    faltaColumnaCuenta = true
    console.warn('[inbox] la columna `cuenta` no existe — ¿falta correr 20260824_inbox_cuenta.sql? Se sigue sin ella.')
  }
  const quitar = (f: Record<string, unknown>) => { const c = { ...f }; delete c.cuenta; return c }
  const sinCuenta = Array.isArray(filas) ? filas.map(quitar) : quitar(filas)
  return await admin.from('inbox_messages').insert(sinCuenta as never)
}
