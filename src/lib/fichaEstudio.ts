import type { SupabaseClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

/**
 * LA FICHA DEL ESTUDIO — lo que la IA sabe SIEMPRE, sin que se lo pregunten.
 *
 * Javi quería asegurarse de que Memoria es «el cerebro» y de que las dos IAs lo
 * usan de contexto. Lo estaban usando, pero solo de una forma: `memoriaRelevante`
 * elige las notas que casan con las palabras de la pregunta. Eso va bien cuando
 * preguntas por algo escrito con esas palabras, y no aporta NADA cuando no.
 *
 * O sea que la IA no tenía una base estable: sabía mucho de lo que le preguntabas
 * literal, y nada del estudio en general. Preguntarle «¿cómo trabajamos con los
 * clientes?» no casaba con ninguna nota y se contestaba a ciegas.
 *
 * La ficha es esa base. Un texto corto —seiscientas palabras como mucho— escrito
 * por el modelo a partir de TODA la memoria, que va siempre en el prompt de las
 * dos IAs. No sustituye a `memoriaRelevante`: lo complementa.
 *
 *   ficha  → siempre, lo general, barato y estable
 *   notas  → cuando casan, el detalle exacto (una tarifa, un brief)
 *
 * Con solo la ficha se perderían los detalles, que es justo lo que se pregunta.
 * Con solo las notas no hay base. Hacen falta las dos.
 *
 * COSTE: se rehace como mucho una vez por hora, y solo si la memoria ha cambiado.
 * Con Haiku y ~15k caracteres de entrada son menos de dos céntimos por regeneración
 * — y en un día normal se regenera cero o una vez.
 */

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' })

/** Cuántas notas nuevas hacen falta para molestarse en rehacerla. */
const NOTAS_PARA_REHACER = 3

export type Ficha = { texto: string; notas: number; actualizada_at: string | null }

/**
 * La ficha guardada. Nunca lanza: si no se puede leer devuelve texto vacío, y
 * quien la use se queda sin ella en vez de quedarse sin respuesta.
 */
export async function leerFicha(admin: SupabaseClient): Promise<string> {
  const { data, error } = await admin
    .from('memoria_ficha')
    .select('texto')
    .eq('id', 1)
    .maybeSingle()
  if (error) {
    // Se dice, porque una ficha que deja de llegar no da error en ningún sitio:
    // las respuestas simplemente empeoran y nadie sabe por qué.
    console.error('[ficha] no se pudo leer —', error.message)
    return ''
  }
  return ((data?.texto as string | null) || '').trim()
}

/**
 * ¿Hace falta rehacerla? Compara lo que hay en memoria con lo que había cuando se
 * escribió: número de notas y fecha de la más reciente.
 *
 * Los dos criterios, no uno: solo con el recuento, editar una nota sin añadir
 * ninguna dejaría la ficha vieja para siempre; solo con la fecha, añadir una nota
 * trivial la rehace entera.
 */
export async function fichaDesfasada(admin: SupabaseClient): Promise<{ hace: boolean; notas: number; ultima: string | null }> {
  const [{ count, error: errC }, { data: reciente, error: errR }, { data: ficha, error: errF }] = await Promise.all([
    admin.from('memoria').select('id', { count: 'exact', head: true }),
    admin.from('memoria').select('updated_at, created_at').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('memoria_ficha').select('notas, ultima_nota, texto').eq('id', 1).maybeSingle(),
  ])
  if (errC || errR || errF) {
    console.error('[ficha] no se pudo comprobar si esta desfasada —', errC?.message || errR?.message || errF?.message)
    return { hace: false, notas: 0, ultima: null }
  }
  const notas = count ?? 0
  const ultima = (reciente?.created_at as string | null) || null
  if (!notas) return { hace: false, notas: 0, ultima: null }
  // Sin ficha escrita todavía, se hace en cuanto haya algo que resumir.
  if (!ficha || !((ficha.texto as string | null) || '').trim()) return { hace: true, notas, ultima }
  const crecio = notas - Number(ficha.notas || 0) >= NOTAS_PARA_REHACER
  const hayMasNueva = !!ultima && (!ficha.ultima_nota || ultima > String(ficha.ultima_nota))
  return { hace: crecio || hayMasNueva, notas, ultima }
}

/**
 * Rehace la ficha leyendo toda la memoria.
 *
 * Devuelve `{ ok: false }` sin escribir nada si el modelo falla: una ficha vieja
 * es infinitamente mejor que una ficha vacía, porque la vacía se lee como «el
 * estudio no tiene nada guardado».
 */
export async function regenerarFicha(admin: SupabaseClient): Promise<{ ok: boolean; notas?: number; motivo?: string }> {
  const { data: notas, error } = await admin
    .from('memoria')
    .select('title, category, content, created_at')
    .order('created_at', { ascending: false })
    .limit(400)
  if (error) {
    console.error('[ficha] no se pudo leer la memoria —', error.message)
    return { ok: false, motivo: 'lectura' }
  }
  if (!notas || !notas.length) return { ok: false, motivo: 'memoria vacia' }

  // Lo curado primero y con más sitio: son las decisiones que alguien escribió a
  // mano. Los documentos son PDFs volcados y ocupan mucho diciendo poco.
  const curadas = notas.filter(n => String(n.category || '').toLowerCase() !== 'documento')
  const docs = notas.filter(n => String(n.category || '').toLowerCase() === 'documento')
  const linea = (n: Record<string, unknown>, corte: number) =>
    `- [${String(n.category || 'General')}] ${String(n.title || '')}: ${String(n.content || '').replace(/\s+/g, ' ').slice(0, corte)}`
  const material = [
    ...curadas.slice(0, 120).map(n => linea(n, 700)),
    ...docs.slice(0, 40).map(n => linea(n, 300)),
  ].join('\n').slice(0, 24000)

  // EL ESTADO VIVO, ademas de la memoria.
  //
  // La ficha se escribia SOLO desde `memoria`, y memoria son documentos: un PDF de
  // hace meses dice «ClipBoom, dos proyectos en marcha» y la ficha lo repetia como
  // presente. Comprobado contra la base: `clients` esta VACIA y los cinco proyectos
  // estan `completado`. O sea que la ficha —que va en el prompt de las dos IAs y en
  // cada analisis de correo— afirmaba lo contrario que las tablas de la propia app.
  //
  // No es teoria: a «¿que clientes tenemos?» Brutal.IA contesto «ClipBoom» por la
  // ficha y tuvo que añadir un aviso de su cosecha diciendo que el contexto
  // operativo decia lo contrario. Una IA que avisa de que sus dos fuentes se
  // contradicen es una IA en la que se deja de confiar.
  const [{ data: clientesVivos }, { data: proyectosVivos }] = await Promise.all([
    admin.from('clients').select('name, status'),
    admin.from('projects').select('name, status'),
  ])
  const activos = (proyectosVivos || []).filter(p => p.status !== 'completado')
  const estado = [
    `CLIENTES DADOS DE ALTA AHORA MISMO (${(clientesVivos || []).length}): ${(clientesVivos || []).map(c => c.name).join(', ') || 'ninguno'}`,
    `PROYECTOS ACTIVOS AHORA MISMO (${activos.length}): ${activos.map(p => p.name).join(', ') || 'ninguno'}`,
    `PROYECTOS TERMINADOS: ${(proyectosVivos || []).filter(p => p.status === 'completado').map(p => p.name).join(', ') || 'ninguno'}`,
  ].join('\n')

  let msg: Awaited<ReturnType<typeof anthropic.messages.create>>
  try {
    msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1100,
      messages: [{
        role: 'user',
        content: `Esto es TODO lo que Brutal Studios —un estudio de vídeo y contenido de 7 personas— tiene guardado en su memoria interna: briefs, tarifas, decisiones, procesos y documentos.

"""
${material}
"""

Y esto es el ESTADO DE HOY, sacado de las tablas de la app. Manda sobre lo que
digan los documentos, que pueden ser de hace meses:

"""
${estado}
"""

Escribe la FICHA DEL ESTUDIO: lo que cualquiera del equipo debería tener siempre presente. Reglas:

- En español de España. Máximo 600 palabras.
- Organízala con encabezados cortos en MAYÚSCULAS (por ejemplo: CLIENTES, CÓMO TRABAJAMOS, TARIFAS, DECISIONES, HERRAMIENTAS). Solo los que tengan contenido real.
- Concreta: nombres de clientes, cifras, plazos, nombres de procesos. Lo genérico no sirve para nada.
- NO inventes nada que no esté arriba. Si de algo apenas hay información, no lo menciones.
- No expliques que estás resumiendo, no pongas introducción ni cierre.
- Si algo se contradice entre notas, quédate con lo más reciente y dilo en una frase.
- El ESTADO DE HOY manda. Si un documento habla de un cliente o un proyecto que hoy
  no está activo, no lo cuentes como si lo estuviera: di lo que fue («ClipBoom:
  trabajo terminado») o no lo menciones. Nunca presentes como vigente algo que las
  tablas dan por cerrado — esta ficha la leen las dos IAs y acaban afirmándolo.

Responde solo con la ficha.`,
      }],
    }, { timeout: 40_000, maxRetries: 1 })
  } catch (err) {
    console.error('[ficha] el modelo no pudo redactarla —', err)
    return { ok: false, motivo: 'modelo' }
  }

  const texto = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text).join('').trim()
  if (!texto) return { ok: false, motivo: 'vacia' }

  const { error: errUp } = await admin.from('memoria_ficha').upsert({
    id: 1,
    texto,
    notas: notas.length,
    ultima_nota: (notas[0]?.created_at as string | null) || null,
    actualizada_at: new Date().toISOString(),
  })
  if (errUp) {
    console.error('[ficha] no se pudo guardar —', errUp.message)
    return { ok: false, motivo: 'escritura' }
  }
  return { ok: true, notas: notas.length }
}
