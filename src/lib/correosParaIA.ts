/**
 * QUÉ CORREOS VE LA IA, Y EN QUÉ ORDEN.
 *
 * El contexto lleva un tope —diez para Harvey, quince para Brutal.IA— y se llenaba
 * por ORDEN DE LLEGADA entre los no leídos. Con 704 sin leer, de los cuales la
 * inmensa mayoría son boletines y publicidad, eso significa que el tope se gasta
 * antes de llegar a nada que importe.
 *
 * Medido: el contexto real de Harvey traía diez correos y eran DHGate, Polymarket,
 * Creator Spotlight, LinkedIn, Temu, adidas, idealista… Un correo de un cliente que
 * entrara ayer no aparecía por ningún lado, y la IA contestaba «no tienes nada» con
 * toda la razón del mundo desde su punto de vista.
 *
 * El tope no es el problema: el problema es GASTARLO MAL. Aquí se decide qué entra.
 */

export type CorreoIA = {
  is_read?: boolean | null
  ai_urgency?: string | null
  ai_client?: string | null
  from_user_id?: string | null
  received_at?: string | null
  shared?: boolean | null
}

/**
 * De más a menos importante. Números bajos entran antes.
 *
 * @param esCliente Si `ai_client` corresponde a un cliente REAL. Se pasa de fuera
 *   porque la lista de clientes la tiene quien llama — y porque `ai_client` lleva
 *   años guardando la marca de quien envía, que no es lo mismo.
 */
export function prioridadCorreo(m: CorreoIA, esCliente: (m: CorreoIA) => boolean): number {
  // Un mensaje de un compañero por la propia app: siempre primero. Es la única
  // clase de correo que nadie más va a mandar.
  if (m.from_user_id) return 0
  if (m.ai_urgency === 'urgent') return 1
  if (esCliente(m)) return 2
  if (m.ai_urgency === 'high') return 3
  if (!m.is_read) return 4
  return 5
}

/**
 * Los `tope` correos que la IA debe ver, ordenados por importancia y, dentro de
 * cada nivel, por fecha (lo más reciente primero).
 */
export function correosParaIA<T extends CorreoIA>(
  correos: T[],
  tope: number,
  esCliente: (m: CorreoIA) => boolean = () => false,
): T[] {
  return [...(correos || [])]
    .map((m, i) => ({ m, p: prioridadCorreo(m, esCliente), i }))
    .sort((a, b) =>
      (a.p - b.p) ||
      // Dentro del mismo nivel, lo más reciente. `localeCompare` sobre el ISO: el
      // orden alfabético de un ISO coincide con el cronológico.
      String(b.m.received_at || '').localeCompare(String(a.m.received_at || '')) ||
      (a.i - b.i))
    .slice(0, tope)
    .map(x => x.m)
}
