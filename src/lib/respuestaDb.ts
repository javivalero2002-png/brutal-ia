/**
 * ¿De quién es la culpa de este error de la base? Del cliente (400) o nuestra (500).
 *
 * `if (error) return 500` metía en el mismo saco dos cosas distintas: un fallo
 * REAL del servidor (la base caída, una columna que no existe) y un error que
 * causa el CLIENTE con su entrada (una FK que apunta a algo inexistente, un
 * CHECK que rebota, un texto con un byte nulo). Los segundos son 400, no 500 —
 * y la diferencia no es cosmética: un 500 debería significar «se ha roto algo
 * nuestro», y llenar ese cubo de entradas malas del cliente hace que la
 * vigilancia de 500s deje de valer para lo que está.
 *
 * Se decide por el SQLSTATE de Postgres, que supabase-js expone en `error.code`:
 *  · clase 22 (data_exception): dato con mala forma —byte nulo, número fuera de
 *    rango, fecha imposible—. Lo manda el cliente.
 *  · clase 23 (integrity_constraint_violation): FK a algo que no existe, CHECK
 *    incumplido, NOT NULL, UNIQUE. Lo manda el cliente.
 * Todo lo demás es 500: es nuestro hasta que se demuestre lo contrario.
 */
export function codigoHttpDeError(error: { code?: string | null } | null | undefined): number {
  const code = error?.code || ''
  if (/^(22|23)/.test(code)) return 400
  return 500
}

/**
 * EL MENSAJE QUE SE LE ENSEÑA A UNA PERSONA.
 *
 * `error.message` de Postgres es correcto y es ilegible: «new row for relation
 * "clients" violates check constraint "clients_status_check"». Quien lo lee no es
 * quien puede arreglarlo, y sobre todo no dice QUÉ hay que hacer.
 *
 * Este caso concreto tiene una causa única y una solución de una línea: la
 * migración `20260901_clientes_potenciales.sql` no está aplicada en Supabase. Es
 * exactamente el fallo que ya vivió meses en esta app —`content_agenda.feedback`
 * faltaba y la revisión con cliente devolvía un 404, así que parecía que la página
 * no existía— y lo que lo hizo durar tanto fue que el síntoma no nombraba la causa.
 *
 * Todo lo demás sale tal cual: inventarle un mensaje bonito a un error que no se
 * conoce es cómo se pierde la única pista que había.
 */
export function mensajeDeError(error: { code?: string | null; message?: string | null } | null | undefined): string {
  const msg = error?.message || 'Error'
  if (error?.code === '23514' && /clients_status_check/.test(msg)) {
    return 'Falta aplicar la migración 20260901_clientes_potenciales.sql en Supabase: la base todavía no admite el estado «Potencial».'
  }
  return msg
}
