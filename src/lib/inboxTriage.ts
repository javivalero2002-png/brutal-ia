import type { SupabaseClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────────────────
// A qué correo se le paga un análisis con el modelo.
//
// LO QUE ESTO NO DECIDE: si un correo se guarda. TODOS se guardan, siempre. Esa
// distinción es el corazón del asunto y hay que releerla cada vez que se toque
// este fichero, porque la primera versión de este plan la borraba sin darse
// cuenta: filtrar en la consulta a Gmail parecía «no pagar el análisis» y en
// realidad era que el correo no entraba en la base — ni en la Bandeja, ni en la
// búsqueda, ni en lo que ve Harvey. Y sin vuelta atrás, porque `messages.list` no
// pagina: relajar el filtro dos semanas después no trae de vuelta nada.
//
// EL MOTIVO DE VERDAD, que tampoco era el que parecía. No es el dinero: el
// análisis cuesta ~0,001 $ por correo y ahorrarlo son unos euros al mes. Es que
// la ventana de correos por pasada es fija y NO pagina, así que en un buzón con
// veinte mil promociones el correo de un cliente se cae de esa ventana y no entra
// nunca. La basura no está costando dinero: está EXPULSANDO el correo bueno.
//
// LA ASIMETRÍA QUE MANDA: equivocarse analizando un boletín cuesta un milésimo de
// euro. Equivocarse saltándose una factura cuesta una factura. Por eso todas las
// exenciones de abajo GANAN a la etiqueta, y por eso ante la duda se analiza.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Las etiquetas de Gmail cuyo correo no se analiza.
 *
 * Solo estas dos, y las ausencias son tan deliberadas como las presencias:
 *
 * · `CATEGORY_UPDATES` NO está. Ahí viven las facturas, los avisos del banco, los
 *   pedidos y los envíos de firma electrónica. Es la categoría con más correo que
 *   de verdad importa.
 * · `CATEGORY_FORUMS` NO está. Ahí cae todo lo que lleva cabecera de lista, y eso
 *   incluye los grupos de Google — que es como muchos clientes con Workspace
 *   enrutan su `marketing@` o su `hola@`. Excluirla se llevaría por delante hilos
 *   enteros de proyecto, y aporta poco volumen.
 */
const CATEGORIAS_SIN_ANALISIS = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL']

/**
 * Palabras que obligan a analizar aunque Gmail lo haya llamado promoción.
 *
 * Corta a propósito: cada palabra de más es un boletín analizado (un milésimo de
 * euro) y cada palabra de menos puede ser una factura invisible.
 */
const ASUNTO_QUE_OBLIGA =
  /factura|invoice|contrato|firmad|presupuesto|pedido|purchase\s*order|\bPO\b|recibo|devuelt|transferencia|n[oó]mina|brief|propuesta/i

export type CorreoParaTriaje = {
  labelIds?: string[]
  from_email?: string
  subject?: string
  attachments?: unknown[] | null
}

export type MotivoTriaje = 'adjunto' | 'dominio-propio' | 'remitente-conocido' | 'asunto' | 'categoria' | 'sin-etiquetas' | 'preferencia'

/**
 * ¿Se le paga un análisis a este correo? Y por qué — el motivo se registra, para
 * que la criba se pueda auditar en vez de tener que creérsela.
 *
 * @param dominiosPropios Dominios del estudio. Se pasan en vez de deducirlos de
 *   `profiles.email` a propósito: media plantilla puede tener un `@gmail.com`, y
 *   eso convertiría la exención en un «analiza todo» silencioso.
 * @param remitentesConocidos Direcciones y dominios con los que ya ha habido
 *   correspondencia reconocida como de cliente.
 */
export function triar(
  correo: CorreoParaTriaje,
  dominiosPropios: string[],
  remitentesConocidos: Set<string>,
  /**
   * ¿Esta persona quiere que su correo pase por el modelo?
   *
   * Solo se le pasa `false` en los buzones PERSONALES. El buzón compartido del
   * estudio no consulta esto nunca: es correo de trabajo de los siete, y que la
   * preferencia de uno lo apagara para todos sería un fallo, no una opción.
   *
   * Por defecto `true` para que ningún sitio que aún no lo pase cambie de
   * comportamiento por accidente al añadir este parámetro.
   */
  analizarPermitido = true,
): { analizar: boolean; motivo: MotivoTriaje } {
  // Lo primero de todo, y por encima de las exenciones de abajo: si alguien ha
  // dicho que no quiere que se lea su correo personal, no hay adjunto ni palabra
  // en el asunto que valga. Es su decisión, no una heurística que se pueda ganar.
  if (!analizarPermitido) return { analizar: false, motivo: 'preferencia' }

  // ── Exenciones. Ganan a la etiqueta, siempre ────────────────────────────────

  // Un adjunto es la señal más fuerte y más barata que existe: ya está calculada
  // antes de llegar aquí. Nadie manda un PDF en un boletín que no importe.
  if (correo.attachments?.length) return { analizar: true, motivo: 'adjunto' }

  const remitente = (correo.from_email || '').toLowerCase().trim()
  const dominio = remitente.split('@')[1] || ''
  if (dominio && dominiosPropios.includes(dominio)) return { analizar: true, motivo: 'dominio-propio' }
  if (remitente && (remitentesConocidos.has(remitente) || remitentesConocidos.has(dominio))) {
    return { analizar: true, motivo: 'remitente-conocido' }
  }
  if (ASUNTO_QUE_OBLIGA.test(correo.subject || '')) return { analizar: true, motivo: 'asunto' }

  // AQUÍ NO HAY CRIBA POR no-reply, Y ES LA SEGUNDA VEZ QUE SE DECIDE. La
  // primera versión de este fichero los saltaba por regex y se revirtió: es
  // exactamente el remitente de DocuSign, WeTransfer, Drive, Ariba y el banco
  // (el test «un no-reply cualquiera se analiza» lo fija). La segunda vez fue
  // el 2026-08-29: `esNoReply()` ya existía para la UI (no ofrecer RESPONDER a
  // una máquina) y parecía natural traerla aquí — son dos preguntas distintas.
  // Que un remitente no LEA respuestas no dice nada de si su correo IMPORTA.
  // ── La decisión ─────────────────────────────────────────────────────────────
  // Sin etiquetas de categoría —cuentas con las pestañas desactivadas, o si Gmail
  // cambia de idea— no casa nada y se analiza. Ese sí es fallar hacia el lado
  // seguro: lo peor que pasa es pagar de más.
  const etiquetas = correo.labelIds || []
  if (!etiquetas.length) return { analizar: true, motivo: 'sin-etiquetas' }
  const esBasura = etiquetas.some(l => CATEGORIAS_SIN_ANALISIS.includes(l))
  return { analizar: !esBasura, motivo: esBasura ? 'categoria' : 'sin-etiquetas' }
}

/**
 * Direcciones y dominios con los que ya se ha tenido correspondencia de cliente.
 *
 * Sale de `inbox_messages`, que es donde SÍ hay ese dato — `clients` solo guarda
 * el nombre comercial, así que casar «Estrella Galicia» con
 * `maria@estrellagalicia.es` es justo el trabajo que se le paga al modelo. Un
 * predicado que casi siempre falla no ordena nada.
 *
 * Nunca lanza: si no se puede leer, se devuelve vacío y la criba se vuelve un poco
 * más cara, no más peligrosa.
 */
export async function remitentesConocidos(admin: SupabaseClient): Promise<Set<string>> {
  const conocidos = new Set<string>()
  try {
    const { data, error } = await admin
      .from('inbox_messages')
      .select('from_email')
      .not('ai_client', 'is', null)
      .neq('ai_client', 'Desconocido')
      .limit(1000)
    if (error) {
      console.error('[triaje] no se pudieron leer los remitentes conocidos:', error.message)
      return conocidos
    }
    for (const f of data || []) {
      const e = ((f as { from_email?: string }).from_email || '').toLowerCase().trim()
      if (!e) continue
      conocidos.add(e)
      const d = e.split('@')[1]
      if (d) conocidos.add(d)
    }
  } catch { /* vacío: más caro, no más peligroso */ }
  return conocidos
}

/**
 * El dominio del estudio.
 *
 * Con variable de entorno y con valor por defecto: hoy el buzón compartido está
 * cableado en `api/gmail/sync/route.ts` como constante, así que el defecto
 * mantiene el comportamiento actual sin depender de que nadie configure nada. Y
 * la variable existe para que una instancia de otra empresa no herede este
 * dominio — que es la clase de cosa que se descubre el día del despliegue.
 */
export function dominiosPropios(): string[] {
  const bruto = (process.env.COMPANY_EMAIL || 'colaboraciones@brutalstudios.es').toLowerCase()
  const d = bruto.includes('@') ? bruto.split('@')[1] : bruto
  return d ? [d.trim()] : []
}
