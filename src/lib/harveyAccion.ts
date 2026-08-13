import { nivelTarea, type NivelTarea } from '@/components/shared/helpers'

// El comando [ACCION:...] que Harvey pega al final de su respuesta.
//
// Por qué esto vive aquí y no dentro de las secciones: estaba escrito DOS veces,
// línea por línea, en HoySection y en HarveySection. Es el corazón de la fábrica
// de gemelos de este repo — la auditoría de agosto encontró tres bugs en esa
// pareja de funciones y hubo que arreglar cada uno dos veces, en dos ficheros de
// mil líneas. Aquí es lógica pura, así que además se puede testear, cosa que las
// dos copias no permitían.
//
// El contrato lo fija el prompt en src/app/api/harvey/chat/route.ts (~línea 150).
// Si cambias uno, cambia el otro.

export const TIPOS_ACCION = ['tarea', 'evento', 'proyecto', 'cliente', 'pieza'] as const
export type TipoAccion = (typeof TIPOS_ACCION)[number]

export interface AccionHarvey {
  type: TipoAccion
  text: string
  level?: NivelTarea
  date?: string
  time?: string
  industry?: string
  clientName?: string
  platform?: string
  contentType?: string
  assigneeName?: string
  invitees?: string
}

const ETIQUETA = /\[ACCION:([^\]]+)\]/
const TODAS = /\[ACCION:[^\]]*\]/g

/**
 * Separa la respuesta hablada del comando de acción.
 *
 * Devuelve SIEMPRE el texto ya limpio de etiquetas —aunque la acción sea
 * irreconocible—, porque lo que no se limpia acaba leyéndose en voz alta: el TTS
 * pronunciaría «corchete ACCION dos puntos tarea». `accion` es null cuando no hay
 * etiqueta o cuando el tipo no es de los cinco que la app sabe ejecutar.
 */
export function parsearAccionHarvey(respuesta: string): { texto: string; accion: AccionHarvey | null } {
  // Se limpia SIEMPRE y ANTES de mirar si la acción se entiende. El regex que
  // detecta exige al menos un carácter tras los dos puntos (`+`), así que un
  // `[ACCION:]` vacío no casaba y —en el código original, que salía aquí— se
  // quedaba dentro del texto. Eso el TTS lo lee: «corchete ACCION dos puntos».
  const texto = respuesta.replace(TODAS, '').trim()

  const m = respuesta.match(ETIQUETA)
  if (!m) return { texto, accion: null }

  const partes = m[1].split('|')
  const tipo = partes[0]?.trim()
  const campo = (i: number) => (partes[i] || '').trim()

  if (!(TIPOS_ACCION as readonly string[]).includes(tipo)) {
    // Tipo desconocido: el texto va limpio igual, pero no se propone nada. Antes
    // se casteaba `parts[0] as TipoAccion` sin comprobar y ninguna rama disparaba,
    // así que el resultado era el mismo — pero sin que el tipo dijera la verdad.
    return { texto, accion: null }
  }

  switch (tipo as TipoAccion) {
    case 'tarea':
      // El nivel se normaliza AQUÍ, no al crear la tarea: la tarjeta «HARVEY
      // PROPONE» pinta su color comparando con 'urgent', así que un «urgente» del
      // modelo salía además con el color equivocado.
      return { texto, accion: { type: 'tarea', text: campo(1), level: nivelTarea(campo(2)), assigneeName: campo(3) } }
    case 'evento':
      return { texto, accion: { type: 'evento', text: campo(1), date: campo(2), time: campo(3), invitees: campo(4) } }
    case 'proyecto':
      return { texto, accion: { type: 'proyecto', text: campo(1), clientName: campo(2), date: campo(3) } }
    case 'cliente':
      return { texto, accion: { type: 'cliente', text: campo(1), industry: campo(2) || '—' } }
    case 'pieza':
      return { texto, accion: { type: 'pieza', text: campo(1), platform: campo(2) || 'Instagram', contentType: campo(3) || 'Post' } }
  }
}
