/**
 * `2026-08-26` + `18:30` → el instante real, en hora de Madrid.
 *
 * Se prueban los dos desfases que tiene España (+01:00 en invierno, +02:00 en
 * verano) y se queda el que, formateado de vuelta EN MADRID, devuelve la hora y
 * el día que se pidieron. Sin librería y sin depender de la zona del servidor,
 * que en Vercel es UTC — construir `new Date(`${dia}T${hora}`)` allí daría una
 * hora de menos o de más según el mes, que es justo el bug que CLAUDE.md manda
 * no repetir.
 *
 * Devuelve null si ninguno cuadra: en el salto de hora hay minutos que no
 * existen, y estampar uno inventado es peor que decir que no.
 */
export function instanteEnMadrid(dia: string, hora: string): string | null {
  const fmt = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  for (const desfase of ['+01:00', '+02:00']) {
    const d = new Date(`${dia}T${hora}:00.000${desfase}`)
    if (Number.isNaN(d.getTime())) continue
    const p = Object.fromEntries(fmt.formatToParts(d).map(x => [x.type, x.value]))
    if (`${p.year}-${p.month}-${p.day}` === dia && `${p.hour}:${p.minute}` === hora) return d.toISOString()
  }
  return null
}
