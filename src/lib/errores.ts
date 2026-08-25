import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * ANOTAR LO QUE FALLA, para que exista mañana.
 *
 * Javi: «estaría bien que se anotasen en algún lado para notificártelos... que yo
 * te dijese "hay algún error detectado" y sacases los errores detectados».
 *
 * Sale del hallazgo de fondo de la auditoría de Gmail: lo que falla en esta app no
 * da error A NADIE. Un buzón cuyo token revoca Google deja de traer correo, el
 * cron responde 200, el latido se pinta verde, y la única traza es un
 * `console.error` que dura lo que dure la retención de logs de Vercel. Si nadie
 * mira ese día, el fallo no existió.
 *
 * TRES DECISIONES que son las que hacen que esto se lea en vez de acumularse:
 *
 *   1. AGRUPA POR CLAVE. El mismo fallo cada hora son 24 filas al día; a la semana
 *      nadie las mira. Con la clave son UNA fila con `veces` y su primera y última
 *      vez — que es lo que de verdad importa de un fallo repetido.
 *   2. NUNCA LANZA. Anotar un error no puede romper lo que estaba pasando. Si la
 *      escritura falla, se queda en el `console.error` de siempre y ya está.
 *   3. NO GUARDA SECRETOS. El contexto pasa por un filtro que tira cualquier clave
 *      que huela a credencial. Un registro de errores es lo último que debería
 *      convertirse en un sitio donde mirar tokens.
 */

const SECRETO = /token|secret|password|clave|apikey|api_key|authorization|cookie/i

/** El contexto, sin nada que no deba quedar escrito. */
function limpiar(contexto: Record<string, unknown> | undefined) {
  if (!contexto) return null
  const salida: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(contexto)) {
    if (SECRETO.test(k)) { salida[k] = '[omitido]'; continue }
    // Y se acota: un contexto de 40 KB por fila convierte esto en otro problema.
    salida[k] = typeof v === 'string' ? v.slice(0, 500) : v
  }
  return salida
}

export type Anotacion = {
  /** Lo que agrupa. Estable entre repeticiones: 'gmail:auth_rota:javi@…' */
  clave: string
  /** Dónde, en palabras de quien lo va a leer: «sync personal», «calendario». */
  donde: string
  /** Qué pasó, en una frase. */
  que: string
  gravedad?: 'alta' | 'media' | 'baja'
  contexto?: Record<string, unknown>
}

export async function anotarError(admin: SupabaseClient, a: Anotacion): Promise<void> {
  // El console.error se conserva SIEMPRE, pase lo que pase con la tabla: es el
  // camino que ya funcionaba y no se cambia uno bueno por otro sin probar.
  console.error(`[${a.donde}] ${a.que}`, a.contexto ? JSON.stringify(limpiar(a.contexto)) : '')

  try {
    // ¿Ya estaba anotado? Se lee para poder SUMAR, que es lo que convierte 168
    // filas en una que dice «168 veces desde el lunes».
    const { data: previo } = await admin
      .from('errores')
      .select('id, veces')
      .eq('clave', a.clave)
      .maybeSingle()

    const ahora = new Date().toISOString()
    if (previo) {
      await admin.from('errores').update({
        donde: a.donde,
        que: a.que,
        gravedad: a.gravedad || 'media',
        contexto: limpiar(a.contexto),
        veces: Number(previo.veces || 0) + 1,
        ultima_at: ahora,
        // SE REABRE. Un error que vuelve después de darlo por arreglado es la
        // señal más valiosa que hay aquí: significa que el arreglo no era.
        resuelto_at: null,
      }).eq('id', previo.id)
      return
    }

    const { error: errIns } = await admin.from('errores').insert({
      clave: a.clave,
      donde: a.donde,
      que: a.que,
      gravedad: a.gravedad || 'media',
      contexto: limpiar(a.contexto),
      veces: 1,
      primera_at: ahora,
      ultima_at: ahora,
    })
    // Se mira, aunque estemos dentro de un try: `insert` no lanza —devuelve
    // `{ error }`— asi que sin esto un fallo de escritura seria justo lo que este
    // fichero existe para evitar. Hay una regla que lo exige, y tiene razon.
    if (errIns) console.error('[errores] el insert fallo —', errIns.message)
  } catch (err) {
    // A propósito mudo hacia fuera: si la tabla no existe todavía —despliegue por
    // delante de la migración— o falla la escritura, lo que NO puede pasar es que
    // anotar un fallo provoque otro.
    console.error('[errores] no se pudo anotar —', err instanceof Error ? err.message : err)
  }
}
