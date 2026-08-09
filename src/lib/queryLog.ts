// Registra (sin lanzar) los errores de un lote de consultas Supabase.
//
// Por qué existe: supabase-js NO lanza cuando una consulta falla — devuelve
// `{ data: null, error }`. En un `Promise.all` que desestructura solo `data`,
// el error desaparece sin dejar rastro, y el resultado es indistinguible de
// "no hay filas".
//
// Esto no es teórico: /api/chat consultaba una tabla `agenda` que no existe.
// El error se descartaba, el modelo recibía un 0, y Brutal.IA respondió
// "0 piezas en el pipeline" durante semanas mientras la sección Contenido
// mostraba piezas reales. Nadie podía verlo porque nada lo registraba.
//
// Deliberadamente no lanza: un contexto parcial sigue siendo útil (el chat
// funciona igual con una consulta menos). Lo que no vale es que falle en silencio.
export function logQueryErrors(tag: string, results: readonly unknown[]): number {
  const errs = results
    .map((r, i) => {
      const e = (r as { error?: { message?: string } } | null)?.error
      return e ? `[${i}] ${e.message}` : null
    })
    .filter(Boolean)
  if (errs.length) console.error(`[${tag}] consultas con error:`, errs.join(' | '))
  return errs.length
}
