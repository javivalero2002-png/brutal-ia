// La tabla `reglas` no guarda solo reglas: se usa además como almacén de
// clave/valor para un par de cosas que no tenían tabla propia. Esas filas NO son
// automatizaciones y no deben aparecer ni en la lista de la UI ni en el motor.
//
// Existe este módulo porque el filtro se olvidó una vez: `__push_subscription__`
// se excluía en los dos sitios y `__account_logo__`, añadido después, en ninguno.
// El resultado era visible en producción — el panel de Automatizaciones contaba
// el logo como "1 de 1 activas" y mostraba un JPEG en base64 como condición.
//
// Sin dependencias a propósito: lo importan tanto rutas API como el motor, y
// `automations.ts` arrastra web-push (que rompe el bundle del navegador).
export const PUSH_ROW = '__push_subscription__'
export const LOGO_ROW = '__account_logo__'
/**
 * Cuándo corrió por última vez cada proceso automático.
 *
 * Vive aquí y no en una tabla propia por lo mismo que las otras dos: es un par
 * clave/valor y crear una tabla para dos filas es peor que reutilizar esta. Lo
 * importante es que quede EXCLUIDA de la lista de automatizaciones, que es el
 * fallo que este módulo existe para evitar.
 */
export const LATIDO_ROW = '__latido_cron__'

/** Nombres de filas de la tabla `reglas` que no son automatizaciones. */
export const NON_RULE_ROWS = [PUSH_ROW, LOGO_ROW, LATIDO_ROW] as const

/** Filtro PostgREST para excluirlas: `.not('name', 'in', NON_RULE_ROWS_FILTER)`. */
export const NON_RULE_ROWS_FILTER = `(${NON_RULE_ROWS.map(n => `"${n}"`).join(',')})`

export type Latido = { tarea: string; en: string; ok: boolean; detalle: string | null }

/**
 * Deja constancia de que un proceso automático ha corrido, y cuándo.
 *
 * Por qué: el cron horario estuvo muerto un día entero sin que nadie lo notara —
 * no había forma de distinguir «hoy no ha llegado correo» de «lleva ocho horas
 * sin ejecutarse». Un latido convierte lo segundo en algo que se ve.
 *
 * Escribe SIEMPRE, haya ido bien o mal: un proceso que corre y falla es
 * información distinta de uno que no corre, y las dos hay que poder verlas.
 *
 * Una fila POR TAREA (`description` lleva el nombre), no una fila con todo
 * dentro: los dos crons coinciden a las 04:00 y con una sola fila el segundo
 * pisaría el latido del primero al escribir su copia del JSON.
 */
export async function marcarLatido(
  admin: { from: (t: string) => any },
  tarea: string,
  ok: boolean,
  detalle?: string,
) {
  // `condition_text` como almacén de JSON y `description` como clave: es el mismo
  // apaño que ya usan la suscripción push y el logo de cuenta, y por el mismo
  // motivo —no obligar a una migración por un par de valores—. La tabla no tiene
  // `name` único, así que no hay upsert: se busca y se actualiza o se inserta.
  const payload = JSON.stringify({ en: new Date().toISOString(), ok, detalle: detalle || null })
  try {
    const { data } = await admin.from('reglas')
      .select('id').eq('name', LATIDO_ROW).eq('description', tarea).limit(1).maybeSingle()
    const { error } = data?.id
      ? await admin.from('reglas')
          .update({ condition_text: payload, last_triggered_at: new Date().toISOString() }).eq('id', data.id)
      : await admin.from('reglas')
          .insert({ name: LATIDO_ROW, description: tarea, condition_text: payload, active: false })

    // El error SÍ se mira. supabase-js no lanza, así que sin esto un latido que
    // no se guarda es indistinguible de uno que sí — y el panel diría «no ha
    // corrido» para siempre con el proceso perfectamente vivo. Sería el mismo
    // fallo silencioso que el latido existe para destapar, un piso más abajo.
    if (error) console.error(`[latido] no se pudo registrar «${tarea}»:`, error.message)
  } catch (e) {
    // Un latido que falla no puede tumbar la tarea que estaba latiendo, pero
    // tampoco puede desaparecer sin dejar rastro.
    console.error(`[latido] excepción al registrar «${tarea}»:`, e)
  }
}

/** Los latidos de todos los procesos, para pintarlos. */
export async function leerLatidos(admin: { from: (t: string) => any }): Promise<Latido[]> {
  const { data, error } = await admin.from('reglas')
    .select('description,condition_text').eq('name', LATIDO_ROW)
  // Sin latidos y «no pude leerlos» son cosas distintas: quien llama decide.
  if (error) throw new Error(error.message)
  return (data || []).map((r: { description: string | null; condition_text: string | null }) => {
    try {
      const j = JSON.parse(r.condition_text || '{}')
      return { tarea: r.description || '?', en: j.en || '', ok: !!j.ok, detalle: j.detalle ?? null }
    } catch {
      return { tarea: r.description || '?', en: '', ok: false, detalle: 'latido ilegible' }
    }
  })
}
