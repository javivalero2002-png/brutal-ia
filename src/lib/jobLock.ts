import type { SupabaseClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────────────────
// Cerrojo entre instancias, apoyado en la clave primaria de Postgres.
//
// Por qué hace falta: el motor de automatizaciones lee sus marcas de dedup del
// snapshot INICIAL y las escribe al final. Dos ejecuciones solapadas ven las dos
// que la marca no existe, y las dos crean la tarea y avisan a los 7 del equipo.
// La guardia `if (running) return` de la UI solo cubre la pestaña que la ejecuta;
// dos personas distintas —o una persona y el cron de la hora en punto— son dos
// instancias serverless que no comparten memoria. El estado tiene que estar en
// la base de datos, igual que el rate limit.
//
// Se apoya en un INSERT contra la PK: ante dos INSERT simultáneos Postgres deja
// pasar exactamente uno y al otro le da 23505. No hay ventana entre comprobar y
// escribir porque es la MISMA sentencia.
//
// Si el cerrojo está caducado se recupera con un UPDATE condicional
// (`expires_at < ahora`), que también es una sola sentencia: si dos instancias lo
// intentan a la vez, la segunda espera al COMMIT de la primera y reevalúa el
// WHERE contra la fila ya actualizada, que ya no está caducada → 0 filas. Borrar
// y reinsertar sí abriría esa ventana; por eso no se hace.
//
// FAIL-OPEN si la tabla no existe. La migración la aplica una persona a mano, y
// que el motor deje de funcionar entero por eso es peor que la duplicación rara
// que evita. Contención real (otra instancia lo tiene) sí bloquea: eso no es un
// fallo de infraestructura, es exactamente el caso que el cerrojo existe para
// cubrir.
// ─────────────────────────────────────────────────────────────────────────────

// La tabla puede no existir todavía: 42P01 = undefined_table.
const TABLA_AUSENTE = '42P01'
// 23505 = unique_violation → la fila ya está, alguien tiene el cerrojo.
const CLAVE_DUPLICADA = '23505'

export type Cerrojo = { adquirido: boolean; holder: string; degradado: boolean }

export async function acquireLock(
  admin: SupabaseClient,
  key: string,
  ttlMs: number,
): Promise<Cerrojo> {
  const holder = crypto.randomUUID()
  const ahora = Date.now()
  const expires = new Date(ahora + ttlMs).toISOString()

  const { error } = await admin
    .from('job_locks')
    .insert({ key, holder, acquired_at: new Date(ahora).toISOString(), expires_at: expires })

  if (!error) return { adquirido: true, holder, degradado: false }

  if (error.code === TABLA_AUSENTE) {
    console.warn(`[lock] la tabla job_locks no existe — «${key}» se ejecuta SIN cerrojo`)
    return { adquirido: true, holder, degradado: true }
  }

  if (error.code !== CLAVE_DUPLICADA) {
    // Error inesperado (red, permisos). Mismo criterio que el rate limit: no
    // dejamos la app sin funcionar por un fallo transitorio de infraestructura.
    console.error(`[lock] no se pudo tomar «${key}», se sigue sin cerrojo:`, error.message)
    return { adquirido: true, holder, degradado: true }
  }

  // Ya existe. Solo se recupera si el anterior caducó (instancia muerta a mitad,
  // p. ej. el corte de 60 s de Vercel, que no ejecuta ningún `finally`).
  const { data, error: errUpd } = await admin
    .from('job_locks')
    .update({ holder, acquired_at: new Date(ahora).toISOString(), expires_at: expires })
    .eq('key', key)
    .lt('expires_at', new Date(ahora).toISOString())
    .select('key')

  if (errUpd) {
    console.error(`[lock] fallo al recuperar «${key}» caducado:`, errUpd.message)
    return { adquirido: false, holder, degradado: false }
  }
  // 0 filas = seguía vigente, lo tiene otro. 1 fila = estaba caducado y es nuestro.
  return { adquirido: (data?.length ?? 0) > 0, holder, degradado: false }
}

export async function releaseLock(admin: SupabaseClient, key: string, holder: string): Promise<void> {
  // El `holder` evita soltar un cerrojo ajeno: si el nuestro caducó y otra
  // instancia ya lo recuperó, este DELETE no toca nada. Sin esa condición
  // liberaríamos la ejecución del otro y volveríamos a tener dos motores a la vez.
  const { error } = await admin.from('job_locks').delete().eq('key', key).eq('holder', holder)
  if (error && error.code !== TABLA_AUSENTE) {
    // No es fatal: expires_at lo suelta solo. Pero deja constancia.
    console.error(`[lock] no se pudo soltar «${key}»:`, error.message)
  }
}
