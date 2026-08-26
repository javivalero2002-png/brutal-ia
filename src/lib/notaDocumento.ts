/**
 * La nota de Memoria que representa un documento.
 *
 * Existe porque se componía en DOS sitios —MemoriaSection al subir un PDF y
 * ProyectosSection al llevarse el PDF de un proyecto— con la MISMA idea y
 * NOMBRES DE CAMPO DISTINTOS: uno escribía `Importe:` y el otro `Presupuesto:`,
 * uno `Tipo:` y el otro `Alcance:`. Eso no es un detalle de estilo: la lista de
 * datos que `memoriaRelevante` rescata cuando el texto no cabe entero iba por
 * nombre, así que rescataba los de un camino y perdía los del otro.
 *
 * El orden NO es decorativo, es lo que sobrevive si hay que cortar:
 *
 *   1. el resumen, que es lo que se lee en la ficha de Memoria;
 *   2. la línea de datos —cliente, fechas, importe—, que es lo más preguntable;
 *   3. el CONTENIDO del documento, que es lo que hace que se pueda preguntar
 *      «¿qué campaña hicimos con Nutella?» y no solo «¿de qué va el documento?»;
 *   4. el enlace, que la IA no puede abrir y la pantalla sí tiene.
 */
export const CAMPOS_FICHA = ['Tipo', 'Cliente', 'Sector', 'Fechas', 'Importe', 'Presupuesto', 'Alcance', 'Estado'] as const

export function componerNotaDocumento(x: {
  resumen?: string | null
  datos?: Partial<Record<(typeof CAMPOS_FICHA)[number], string | null | undefined>>
  puntos?: string[] | null
  contenido?: string | null
  enlace?: string | null
}): string {
  const ficha = CAMPOS_FICHA
    .map(k => { const v = x.datos?.[k]; return v ? `${k}: ${String(v).trim()}` : '' })
    .filter(Boolean)
    .join(' · ')

  return [
    (x.resumen || '').trim(),
    ficha,
    // Rotulado para que se lea en la ficha de Memoria como lo que es —el
    // documento— y no como más resumen pegado detrás.
    (x.contenido || '').trim() ? `CONTENIDO DEL DOCUMENTO:\n${(x.contenido || '').trim()}` : '',
    (x.puntos || []).filter(Boolean).slice(0, 5).map(p => `· ${p}`).join('\n'),
    x.enlace ? `📎 Documento: ${x.enlace}` : '',
  ].filter(Boolean).join('\n\n')
}
