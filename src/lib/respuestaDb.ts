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
