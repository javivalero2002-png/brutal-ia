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

  // LO CURADO TAMBIÉN SE ORDENA POR RELEVANCIA, no por orden de llegada.
  //
  // Aquí ponía `curadas.slice(0, 10)` a secas: las diez primeras que se guardaron,
  // mirase lo que mirase la pregunta. Con once decisiones curadas, la undécima era
  // invisible para las dos IAs PARA SIEMPRE — preguntases lo que preguntases, y por
  // mucho que fuera exactamente sobre ella.
  //
  // Es el mismo fallo que el `.limit(120)` que se arregló ayer, un piso más arriba:
  // recortar por antigüedad lo que hay que recortar por relevancia.
  //
  // La diferencia con los documentos es deliberada: a un documento que no casa se le
  // DESCARTA (`filter(p > 0)`), y a una nota curada no. Lo curado lo escribió alguien
  // a mano y vale como base aunque la pregunta no lo mencione; solo se reordena para
  // que lo que encaja suba. Sin pregunta —o sin ninguna coincidencia— todas puntúan
  // 0 y el orden se conserva, así que sale exactamente lo mismo que antes.
  const curadasElegidas = curadas
    .map((m, i) => ({ m, p: puntua(m), i }))
    // `i` como desempate: `sort` es estable en la práctica, pero apoyarse en eso
    // deja el resultado a merced del motor, y aquí importa que sea reproducible.
    .sort((a, b) => (b.p - a.p) || (a.i - b.i))
    .slice(0, 10)
    .map(x => x.m)

  return [...curadasElegidas, ...docsElegidos]
}

/**
 * Los DATOS de una nota: cliente, fechas, importe, tipo, estado.
 *
 * Existe porque el extractor de PDF los escribe AL FINAL, después del resumen
 * en prosa, y el corte caía justo encima. Medido sobre la memoria real: de las
 * cinco notas que llevaban esta línea, las CINCO la perdían. O sea que a «¿de
 * qué cliente es esta propuesta?» no había ni una que supiera contestar, y a
 * «¿qué importe tiene EL TRAIDOR?» las dos IAs dijeron que no lo tenían —
 * teniéndolo, 80 caracteres más allá de la tijera.
 *
 * Es lo más pequeño y lo más preguntable de la nota. Va siempre, esté donde esté.
 */
// Los nombres de campo son los de `CAMPOS_FICHA` en `notaDocumento.ts`. Aqui
// ponia cinco y faltaban `Presupuesto` y `Alcance`, que son justo los que escribe
// el camino de Proyectos: un documento subido desde un proyecto perdia su
// presupuesto y su alcance, y esta lista no los rescataba porque no sabia que
// existian. Los dos caminos escribian la misma idea con nombres distintos.
const DATOS = /(?:Tipo|Cliente|Sector|Fechas|Importe|Presupuesto|Alcance|Estado):\s*[^·\n]+/g

/**
 * Las mismas notas, ya en las líneas que se le pasan al modelo.
 *
 * Dos cortes y no uno: una nota escrita a mano son dos frases, y un documento es
 * el resumen de un PDF entero. Con 400 para todo, de un resumen de 1.380
 * caracteres llegaban 400 y se perdían mil — el resto del documento, no un
 * detalle. `memoriaRelevante` ya deja como mucho 6 documentos, así que el techo
 * está acotado: no es «mandarlo todo», es no partir por la mitad lo poco que se
 * ha elegido mandar.
 *
 * 5.500 y no 1.400 desde que la nota de un documento lleva dentro el DOCUMENTO y
 * no solo su resumen. El motivo, medido: Javi preguntó «¿qué tipo de campaña
 * hicimos con Nutella?» y las dos IAs dijeron que no había ninguna — el PDF tiene
 * 4.529 caracteres y NUTELLA & PAN sale en el primer tercio, pero en Memoria solo
 * había un resumen de 684 que no la nombraba.
 *
 * El techo real: 6 documentos × 5.500 = 33.000 caracteres, unos 8.000 tokens por
 * mensaje. A la escala de esto —siete personas, unas decenas de documentos— eso
 * son céntimos, y es la diferencia entre una IA que sabe de qué va un PDF y una
 * que sabe lo que pone dentro.
 */
export const lineasDeMemoria = (notas: NotaMemoria[], corte = 400, corteDoc = 5500) =>
  notas
    .map(m => {
      const plano = (m.content || '').replace(/\s+/g, ' ')
      const esDoc = /documento/i.test(m.category || '')
      const cuerpo = plano.slice(0, esDoc ? corteDoc : corte)
      const datos = (plano.match(DATOS) || [])
        .map(d => d.trim())
        .filter(d => !cuerpo.includes(d))
      const cola = datos.length ? ` · ${datos.join(' · ')}` : ''
      return `  - ${m.title}${m.category ? ` [${m.category}]` : ''}: ${cuerpo}${cola}`
    })
    .join('\n')
