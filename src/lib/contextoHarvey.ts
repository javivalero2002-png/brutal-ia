import { todayKey, localDayKey, madridDateLabel, estadoDeadline } from '@/components/shared/helpers'
import { cuandoEnMadrid } from '@/lib/ventanaCalendario'
import { memoriaRelevante, lineasDeMemoria } from '@/lib/memoriaRelevante'

/**
 * EL CONTEXTO QUE SE LE MANDA A HARVEY. Uno, no dos.
 *
 * Estaba escrito DOS VECES —`buildCtx` en HoySection y `buildContext` en
 * HarveySection— con once diferencias entre ambos. No eran variantes a propósito:
 * eran arreglos que se le hicieron a una copia y no a la otra. Cada fichero lleva
 * escrito en un comentario el arreglo que recibió él, diciendo «el gemelo ya lo
 * hacía bien» — y el gemelo, a su vez, dice lo mismo de otro arreglo distinto.
 *
 * Lo que divergía, y qué se conserva de cada uno:
 *
 *   · ATRASADOS con sus nombres      → de Hoy. El servidor PARSEA esa línea en su
 *                                       respuesta de emergencia; sin ella, ese
 *                                       número era siempre 0 al preguntar desde
 *                                       Harvey.
 *   · urgentes CON responsable        → de Hoy. «arréglalo tú» necesita saber quién.
 *   · VENCEN HOY                      → de Harvey. Hoy no lo tenía.
 *   · resumen Y acción del correo     → de Hoy. Harvey enseñaba la acción solo si
 *                                       faltaba el resumen, que es justo cuando
 *                                       menos falta hace.
 *   · 8 proyectos y 10 correos        → los topes más generosos de los dos.
 *   · el formateador de memoria       → el compartido, no la tercera copia a mano.
 *
 * Y el recuento del inbox se dice ENTERO, que es lo que estaba mal en los dos:
 * cuántos hay sin leer de verdad, cuántos se enseñan, y cuántos hay cargados. Hoy
 * ponía «(N total)» sobre `data.inbox.length`, que está topado a 100 por
 * `/api/inbox`: con 865 correos en la base, Harvey afirmaba «100 en total».
 */

type Lista = Record<string, unknown>[]

export type DatosContexto = {
  tasks?: Lista; projects?: Lista; clients?: Lista; agenda?: Lista
  inbox?: Lista; calendarEvents?: Lista; team?: Lista; memoria?: Lista
}

const txt = (v: unknown) => (v == null ? '' : String(v))

export function construirContexto(data: DatosContexto, pregunta?: string): string {
  const tasks = data.tasks || []
  const projects = data.projects || []
  const inbox = data.inbox || []
  const hoy = todayKey()

  const pendientes = tasks.filter(t => !t.done)
  const urgentes = pendientes.filter(t => t.level === 'urgent')
  const altas = pendientes.filter(t => t.level === 'high')
  const venceHoy = pendientes.filter(t => t.due_date === hoy)
  const hechasHoy = tasks.filter(t =>
    t.done && localDayKey(txt(t.completed_at || t.updated_at || t.created_at)) === hoy).length

  const activos = projects.filter(p => p.status !== 'completado')
  const atrasados = activos.filter(p => estadoDeadline(txt(p.deadline))?.vencido)
  const clientes = (data.clients || []).filter(c => c.status === 'Activo')
  const pipeline = (data.agenda || []).filter(a => a.status !== 'publicado')

  // El recuento REAL de no leídos, aparte de la lista que se enseña. La lista
  // lleva tope Y mete a propósito urgentes de hoy ya leídos, así que su longitud
  // no es «sin leer»: etiquetarla así hacía que Harvey dijera siempre el tope.
  const sinLeer = inbox.filter(m => !m.is_read).length
  const aEnsenar = inbox.filter(m =>
    // `localDayKey` y no cortar el ISO: `received_at` va en UTC y `hoy` es el día
    // de Madrid. De 00:00 a 02:00 no son el mismo día, y un correo urgente de esta
    // madrugada ya leído desaparecía del contexto.
    !m.is_read || ((m.ai_urgency === 'urgent' || m.ai_urgency === 'high') && localDayKey(txt(m.received_at)) === hoy)
  ).slice(0, 10)

  const lineasCorreo = aEnsenar.map(m => {
    const urg = m.ai_urgency === 'urgent' ? '[URGENTE]' : m.ai_urgency === 'high' ? '[ALTA]' : '[NORMAL]'
    const buzon = m.shared ? '[COLABS]' : '[PERSONAL]'
    const resumen = m.ai_summary ? ` | Resumen: ${txt(m.ai_summary)}` : ''
    const accion = m.ai_action && m.ai_action !== 'Ninguna acción requerida' ? ` → Acción: ${txt(m.ai_action)}` : ''
    return `  • De: ${txt(m.from_name) || '?'} | Asunto: "${txt(m.subject) || 'Sin asunto'}" ${urg}${buzon}${resumen}${accion}`
  }).join('\n')

  const eventos = (data.calendarEvents || []).filter(e => txt(e.start) >= hoy).slice(0, 5)
  // `cuandoEnMadrid` y NO cortar el ISO. Google devuelve cada evento en el
  // desfase del calendario donde vive: el personal de Javi va en +01:00 y el
  // compartido en +02:00. Cortando el texto, «reunion brutal» salía como las
  // 10:30 aquí y como las 11:30 en la pantalla — la misma reunión.
  const lineasEvento = eventos.map(e =>
    `${txt(e.title)} (${cuandoEnMadrid(txt(e.start))})`).join(' · ')

  const lineasProyecto = activos.slice(0, 8).map(p =>
    `${txt(p.name)} ${txt(p.progress)}%${atrasados.some(o => o.id === p.id) ? ' [ATRASADO]' : ''}`).join(' | ')

  const lineasUrgentes = urgentes.slice(0, 5).map(t => {
    const quien = (t.assignee as { name?: string } | undefined)?.name
    return `"${txt(t.text)}"${quien ? ` (${quien})` : ''}`
  }).join(', ')

  const memoria = lineasDeMemoria(memoriaRelevante((data.memoria || []) as never, pregunta))

  return `BRUTAL STUDIOS — ${madridDateLabel()}

TAREAS: ${pendientes.length} pendientes | ${hechasHoy} completadas hoy
URGENTES (${urgentes.length}): ${lineasUrgentes || 'ninguna'}
ALTA PRIORIDAD (${altas.length}): ${altas.slice(0, 3).map(t => txt(t.text)).join(', ') || 'ninguna'}
${venceHoy.length > 0 ? `VENCEN HOY (${venceHoy.length}): ${venceHoy.map(t => txt(t.text)).join(' · ')}\n` : ''}
PROYECTOS ACTIVOS (${activos.length}): ${lineasProyecto || 'ninguno'}
${atrasados.length > 0 ? `ATRASADOS (${atrasados.length}): ${atrasados.map(p => txt(p.name)).join(', ')}\n` : ''}
CLIENTES ACTIVOS (${clientes.length}): ${clientes.map(c => txt(c.name)).join(', ') || 'ninguno'}
EQUIPO: ${(data.team || []).map(m => txt(m.name)).filter(Boolean).join(', ') || 'sin datos'}
PIPELINE CONTENIDO: ${pipeline.length} piezas pendientes

INBOX — ${sinLeer} sin leer (${aEnsenar.length} en esta lista, de ${inbox.length} cargados):
${lineasCorreo || '  Sin correos que enseñar'}

CALENDARIO PRÓXIMO: ${lineasEvento || 'sin eventos próximos'}

DOCUMENTOS Y CONOCIMIENTO (memoria — úsalo si es relevante):
${memoria || '  sin documentos'}`
}
