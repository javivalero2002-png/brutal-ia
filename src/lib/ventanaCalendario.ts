/**
 * QUÉ TRAMO DEL CALENDARIO SE TRAE DE GOOGLE, y cómo se dice una hora.
 *
 * Las dos cosas viven juntas porque las dos son «cómo se lee un evento», y las
 * dos estaban mal de la misma forma: la app afirmaba algo que no había mirado.
 *
 * ── La ventana ────────────────────────────────────────────────────────────────
 * Se traía desde el día 1 del mes actual hasta tres meses después. La sección, en
 * cambio, deja navegar a CUALQUIER mes con las flechas: julio salía vacío y
 * diciembre salía vacío, sin un solo aviso — o sea que el calendario decía «no
 * tienes nada» de meses que ni había pedido.
 *
 * Peor con Harvey de por medio: crear un evento a cuatro meses vista contesta
 * «hecho», Google lo guarda, y la app no lo enseña nunca. Medido: un evento del
 * 30 de diciembre se creó con 200 y no aparecía al releer.
 *
 * Ahora: dos meses atrás y trece adelante. La paginación ya estaba resuelta, así
 * que el coste es de red y no de corrección.
 */
export function ventanaCalendario(hoy: Date = new Date()) {
  const desde = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 2, 1))
  const hasta = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 13, 1))
  return { desde, hasta, timeMin: desde.toISOString(), timeMax: hasta.toISOString() }
}

/** ¿Ese mes (año, mes 0-11) está dentro de lo que se ha traído? */
export function mesCargado(anio: number, mes: number, hoy: Date = new Date()): boolean {
  const { desde, hasta } = ventanaCalendario(hoy)
  const primero = Date.UTC(anio, mes, 1)
  return primero >= desde.getTime() && primero < hasta.getTime()
}

/**
 * La hora de un evento EN MADRID.
 *
 * Google devuelve cada evento en el desfase del calendario donde vive, no en el
 * del usuario. El calendario personal de Javi va en +01:00 y el compartido en
 * +02:00, así que cortar el texto ISO —`s.slice(11,16)`, que es lo que hacían
 * los dos constructores de contexto— daba una hora distinta según el calendario.
 *
 * Medido sobre los eventos reales: «reunion brutal» del 4 de agosto salía como
 * las 10:30 para Harvey y como las 11:30 en la pantalla. La misma reunión.
 *
 * La sección ya lo hacía bien (`toLocaleTimeString`), que es lo que convertía
 * esto en la peor versión del fallo: la app y la IA decían cosas distintas.
 */
const HORA_MADRID = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false,
})

export function horaMadrid(iso: string): string {
  if (!iso || !iso.includes('T')) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return HORA_MADRID.format(d)
}

/** «2026-09-10 a las 09:00» — o solo el día si es de día completo. */
export function cuandoEnMadrid(iso: string): string {
  if (!iso) return '?'
  const dia = iso.slice(0, 10)
  const hora = horaMadrid(iso)
  return hora ? `${dia} a las ${hora}` : dia
}
