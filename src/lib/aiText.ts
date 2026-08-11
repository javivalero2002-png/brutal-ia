import type Anthropic from '@anthropic-ai/sdk'

/**
 * Extrae el texto de una respuesta de Anthropic sin asumir que va en content[0].
 *
 * Por qué existe: había 8 sitios haciendo `msg.content[0].type === 'text' ? ... : fallback`.
 * Eso solo funciona si el primer bloque es texto — y deja de serlo en cuanto el
 * modelo emite un bloque previo (p. ej. `thinking`, que Sonnet 5 activa por
 * defecto). El síntoma es especialmente malo: no hay error ni excepción, la
 * llamada se factura entera y el usuario recibe el texto de fallback como si
 * fuese la respuesta del modelo. En el chat llegaba incluso a persistirse en
 * `chat_messages`, así que seguía ahí al recargar.
 *
 * Buscar el bloque de texto en vez de indexar es correcto con cualquier modelo
 * y cualquier combinación de bloques, presente o futura.
 */
export function textOf(msg: Anthropic.Message): string {
  const block = msg.content.find(b => b.type === 'text')
  return block && block.type === 'text' ? block.text : ''
}
