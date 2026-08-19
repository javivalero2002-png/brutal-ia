/**
 * Qué trozo de Memoria se le enseña al modelo.
 *
 * Memoria es «lo que el estudio sabe», y desde que los documentos entran solos
 * crece rápido: cada PDF de un cliente o de un proyecto se guarda como una nota
 * más. Mandarla entera no cabe, así que hay que elegir — y elegir «las N más
 * recientes» es la peor forma posible, porque subir tres presupuestos empuja
 * fuera de la ventana justo lo que nunca caduca: cómo se trabaja aquí.
 *
 * Eso pasó de verdad. `HoySection` cogía las 12 más recientes, así que a partir
 * del documento trece el orbe de la pantalla de inicio ya no veía ni una decisión
 * del estudio; en `HarveySection` la misma función estaba arreglada. Gemelo de
 * libro: corregido en una copia y vivo en la otra. Vive aquí, en un solo sitio y
 * con tests, para que la próxima sección que necesite contexto no escriba una
 * tercera versión.
 *
 * El criterio: **lo curado entra siempre, los documentos por relevancia.** Las
 * notas escritas a mano son pocas y son la doctrina; los documentos son muchos y
 * solo importan si tienen que ver con lo que se está preguntando.
 */

export type NotaMemoria = { title?: string; category?: string; content?: string | null }

/** Sin tildes y en minúsculas, para que «diseno» encuentre «diseño». */
const limpia = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

const esDocumento = (m: NotaMemoria) => (m.category || '').toLowerCase() === 'documento'

/**
 * @param notas   Todas las de Memoria, como vienen de la base.
 * @param pregunta Lo que se está preguntando. Sin ella no hay nada que puntuar, y
 *   se cae a unos pocos documentos recientes: es el caso del resumen del día, que
 *   no responde a una pregunta concreta.
 */
export function memoriaRelevante(notas: NotaMemoria[] | null | undefined, pregunta?: string): NotaMemoria[] {
  const todas = notas || []
  const curadas = todas.filter(m => !esDocumento(m))
  const docs = todas.filter(esDocumento)

  // Palabras de 4+ letras: las cortas («que», «con», «para») casan con todo, así
  // que puntúan igual a todos los documentos y no seleccionan nada.
  const claves = limpia(pregunta || '').split(/[^a-z0-9]+/).filter(p => p.length >= 4)

  const puntua = (m: NotaMemoria) => {
    if (!claves.length) return 0
    const texto = limpia(`${m.title || ''} ${m.content || ''}`)
    return claves.reduce((n, k) => n + (texto.includes(k) ? 1 : 0), 0)
  }

  const docsElegidos = claves.length
    ? [...docs].map(m => ({ m, p: puntua(m) })).filter(x => x.p > 0)
        .sort((a, b) => b.p - a.p).slice(0, 6).map(x => x.m)
    : docs.slice(0, 4)

  return [...curadas.slice(0, 10), ...docsElegidos]
}

/** Las mismas notas, ya en las líneas que se le pasan al modelo. */
export const lineasDeMemoria = (notas: NotaMemoria[], corte = 400) =>
  notas
    .map(m => `  - ${m.title}${m.category ? ` [${m.category}]` : ''}: ${(m.content || '').replace(/\s+/g, ' ').slice(0, corte)}`)
    .join('\n')
