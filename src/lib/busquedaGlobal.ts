import { buscaEnTexto } from '@/components/shared/helpers'

/**
 * QUÉ SALE AL BUSCAR CON ⌘K.
 *
 * Vive aquí y no dentro de `NexusDashboard` porque era el único buscador de la app
 * que no usaba `buscaEnTexto`: las seis secciones ya iban con él y la lupa —la más
 * a mano— se quedó con `title.toLowerCase().includes(q)`. Gemelo de libro, y del
 * peor tipo: el arreglo estaba hecho y escrito, y el sitio más visible no lo tenía.
 *
 * Dentro del componente esto no se podía probar. Ahora sí.
 */

export type Resultado = {
  type: string
  title: string
  sub?: string
  /** Lo que NO se pinta pero sí se busca: el cuerpo de una nota, el resumen de un correo. */
  extra?: string
}

/** Cuántos de cada tipo como mucho, para que ninguno se coma la lista. */
export const POR_TIPO = 3
export const TOTAL = 12

export function filtrarBusqueda<T extends Resultado>(todos: T[], consulta: string): T[] {
  const q = (consulta || '').trim()
  if (q.length < 2) return []
  const casan = todos.filter(r => buscaEnTexto(`${r.title} ${r.sub || ''} ${r.extra || ''}`, q))
  // REPARTIDO POR TIPO, no los N primeros de la lista.
  //
  // Se concatenaba en orden fijo —clientes, proyectos, tareas, memoria, contenido,
  // inbox, equipo— y se cortaba a 9. Con 871 correos cargados casi cualquier
  // palabra llenaba el hueco con inbox, y el EQUIPO, que va el último, NO SALÍA
  // NUNCA: buscabas a una persona por su nombre y no aparecía.
  const salida: T[] = []
  for (const r of casan) {
    if (salida.filter(x => x.type === r.type).length < POR_TIPO) salida.push(r)
    if (salida.length >= TOTAL) break
  }
  return salida
}
