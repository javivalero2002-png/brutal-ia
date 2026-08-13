import Anthropic from '@anthropic-ai/sdk'
import { textOf } from '@/lib/aiText'
import { sanearHistorial } from './historialIA'
import { estadoDeadline } from '@/components/shared/helpers'
import { nivelTarea } from '@/components/shared/helpers'

// Sin topes, el SDK se queda con sus valores por defecto: 10 MINUTOS de timeout
// y 2 reintentos con backoff. Los presupuestos de tiempo de los bucles de sync
// (src/lib/colabsSync.ts y src/app/api/gmail/sync/route.ts) se comprueban ENTRE
// iteraciones, así que no pueden cortar una llamada ya en vuelo: una sola
// llamada colgada se comía entera la función de 60s del plan Hobby y la
// sincronización moría a mitad, sin dejar rastro de por qué. Con 15s y un
// reintento el peor caso por email queda acotado y el presupuesto del bucle
// vuelve a ser una cota real.
// Cuanto puede tardar UNA llamada a analyzeEmail en el peor caso.
//
// El `timeout` del SDK es POR INTENTO, no por llamada: con maxRetries: 1 son dos
// intentos completos, mas el backoff de en medio. Se exporta porque quien hace un
// bucle de analyzeEmail tiene que dejar sitio para que quepa la ULTIMA — comprobar
// el presupuesto ANTES de una llamada que puede durar medio minuto no sirve de nada
// si el presupuesto no lo contempla.
//
// Estaba escrito a mano y distinto en tres sitios: 45 s en /api/gmail/sync, 25 s en
// colabsSync (colabs) y 12 s (personal). Solo el 45 no cabia — 45 + 30,5 = 75,5 s
// contra un maxDuration de 60. Derivarlo de aqui es lo que impide que vuelvan a
// separarse.
const TIMEOUT_MS = 15_000
const MAX_REINTENTOS = 1
export const PEOR_CASO_ANALYZE_MS = TIMEOUT_MS * (MAX_REINTENTOS + 1) + 1_000

/** Presupuesto de bucle que cabe en una funcion de `maxDuration` segundos. */
export const presupuestoBucle = (maxDurationSeg: number, margenMs = 4_000): number =>
  Math.max(5_000, maxDurationSeg * 1_000 - PEOR_CASO_ANALYZE_MS - margenMs)

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: TIMEOUT_MS,
  maxRetries: MAX_REINTENTOS,
})

// El modelo a veces envuelve el JSON en fences markdown (```json ... ```) pese a
// pedirle "sin markdown". Limpiamos antes de JSON.parse para no caer al fallback básico.
function parseJsonLoose(text: string): any {
  const clean = text
    .replace(/^\s*```json\s*/i, '')
    .replace(/^\s*```\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
  return JSON.parse(clean)
}

export interface SearchResult {
  title: string
  content: string
  url: string
}

export async function webSearch(query: string): Promise<SearchResult[]> {
  const key = process.env.TAVILY_API_KEY
  // Sin log, una clave ausente o caducada es indistinguible de "no hubo
  // resultados": el chat sigue respondiendo con conocimiento de entrenamiento
  // como si nada, y nadie se entera de que la búsqueda web lleva días muerta.
  if (!key) { console.error('[ai] TAVILY_API_KEY ausente — búsqueda web desactivada'); return [] }
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: 'advanced',
        max_results: 8,
        include_answer: false,
      }),
    })
    if (!res.ok) { console.error('[ai] Tavily respondió', res.status); return [] }
    const data = await res.json()
    return (data.results || []).slice(0, 7).map((r: any) => ({
      title: r.title || '',
      content: (r.content || '').slice(0, 400),
      url: r.url || '',
    }))
  } catch (err: any) { console.error('[ai] búsqueda web falló:', err?.message ?? err); return [] }
}

// Formats search results as a clean context block for Claude (Chat IA — markdown OK)
export function formatSearchContext(results: SearchResult[]): string {
  if (!results.length) return ''
  return `\n\n<web_search_results>\n${results.map((r, i) =>
    `[${i + 1}] ${r.title}\n${r.content}`
  ).join('\n\n')}\n</web_search_results>`
}

// Formats search results for Harvey (voice — no citations, plain prose)
export function formatSearchContextVoice(results: SearchResult[]): string {
  if (!results.length) return ''
  return `\n\n<web_search_results>\n${results.slice(0, 5).map(r =>
    `${r.title}: ${r.content}`
  ).join('\n\n')}\n</web_search_results>`
}

// Returns true when the query likely benefits from real-time web data.
// Se excluyen primero las consultas sobre datos INTERNOS (tareas, proyectos,
// clientes, inbox…): esas ya las responde el contexto del sistema y buscar en
// internet solo añadiría latencia y ruido.
export function needsWebSearch(query: string): boolean {
  const q = query.toLowerCase()

  // 1) Datos internos o acciones → nunca buscar
  const internal = /\b(mis?|mi)\b|tarea|proyecto|cliente|inbox|correo|email|equipo|briefing|agenda|calendario|reunión|pipeline|crea|añade|apunta|recuérdame|asigna|marca|termina|completa/i
  if (internal.test(q)) return false

  // 1b) Preguntas por la gente del estudio. La lista de arriba lleva «equipo»,
  //     pero nadie pregunta así: se pregunta «¿quién lleva lo de Zara?» o
  //     «¿quién está libre el jueves?». Eso no casa arriba, empieza por un
  //     interrogativo y por tanto caía en el bloque 3 (conocimiento general):
  //     la pregunta entera —con el nombre del compañero y el del cliente
  //     dentro— se le mandaba tal cual a Tavily. Ni la responde internet ni
  //     tiene por qué verla.
  const equipoInterno = /compañer|\b(nuestr[oa]s?|nosotros)\b|se encarga|est[áa] (libre|liado|ocupad)|qui[ée]n (lleva|est[áa]|se ocupa|hace|va a hacer|puede hacer)/i
  if (equipoInterno.test(q)) return false

  // 2) Señales explícitas de búsqueda o de dato externo
  const explicit = /busca|encuentra|consigue|invest[ií]ga|influencer|instagram|tiktok|youtube|linkedin|precio|tarifa|presupuesto de mercado|tendencia|trend|noticias|actualidad|últim|novedad|estad[ií]stica|hashtag|seguidores|competencia|referente|ejemplo de|casos de|benchmark|qué plataforma|cu[áa]nto cuesta|cu[áa]nto cobra|cu[áa]nto vale|cu[áa]nto gana/i
  if (explicit.test(q)) return true

  // 3) Preguntas de conocimiento general sobre entidades externas
  //    ("¿quién es el CEO de Nike?", "¿qué es el SEO técnico?")
  const knowledge = /^(¿\s*)?(qui[ée]n|qu[ée]|cu[áa]l|d[óo]nde|cu[áa]ndo|c[óo]mo)\s/i
  if (knowledge.test(q.trim())) return true

  return false
}

// Remove null bytes and control chars that break the Anthropic API
function sanitize(s: string) {
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ').trim()
}

export interface EmailAnalysis {
  summary: string
  action: string
  client: string
  urgency: 'urgent' | 'high' | 'normal'
  suggestedTask?: string
  /** true si el análisis con IA falló y esto es el fallback básico. analyzeEmail
   *  NO lanza (captura por dentro), así que sin esta señal los llamantes no
   *  pueden distinguir un resumen real de uno degradado: si la clave de
   *  Anthropic caduca, los buzones se llenan de fallbacks y nadie se entera. */
  degraded?: boolean
}

export interface WhatsAppAnalysis {
  extractedInfo: string
  client?: string
  project?: string
  taskText?: string
  deadline?: string
  urgency: 'urgent' | 'high' | 'normal'
  shouldCreateTask: boolean
  confirmationQuestion: string
}

export async function analyzeEmail(
  subject: string,
  body: string,
  fromName: string,
  knownClients: string[]
): Promise<EmailAnalysis> {
  let msg: Awaited<ReturnType<typeof anthropic.messages.create>>
  try {
    msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Eres el asistente de IA de Brutal Studios, una agencia creativa. Analiza este email y responde en JSON.

Clientes conocidos: ${knownClients.map(c => sanitize(c)).join(', ')}

Email de: ${sanitize(fromName)}
Asunto: ${sanitize(subject)}
Cuerpo: ${sanitize(body.slice(0, 800))}

Responde SOLO con JSON válido (sin markdown):
{
  "summary": "resumen en 1-2 frases en español",
  "action": "acción requerida en 1 frase o 'Ninguna acción requerida'",
  "client": "nombre del cliente si se identifica o 'Desconocido'",
  "urgency": "urgent|high|normal",
  "suggestedTask": "texto de tarea a crear o null"
}`
      }]
    })
  } catch (err: any) {
    // Distinguir el motivo importa: un 401 se arregla rotando la clave, un 429
    // se pasa solo. Sin este log, ambos eran silencio idéntico.
    console.error('[ai] analyzeEmail falló:', err?.status ?? '', err?.message ?? err)
    return { summary: subject, action: 'Revisar email', client: 'Desconocido', urgency: 'normal', degraded: true }
  }

  try {
    const text = textOf(msg) || '{}'
    const bruto = parseJsonLoose(text)
    // La urgencia va a `inbox_messages.ai_urgency`, que es una union cerrada, y
    // sale LITERALMENTE de lo que haya escrito el modelo. El prompt esta entero
    // en espanol y pide «urgent|high|normal» en ingles: es la misma trampa que ya
    // mordio con tasks.level, y este es su gemelo exacto —lo mismo, en otro
    // campo—. Se normaliza AQUI, en la frontera, y no en los tres inserts que
    // consumen esto: normalizar tres veces es como se arregla uno y sobreviven dos.
    return { ...bruto, urgency: nivelTarea(bruto?.urgency, 'normal') }
  } catch {
    return { summary: subject, action: 'Revisar email', client: 'Desconocido', urgency: 'normal', degraded: true }
  }
}

export async function analyzeWhatsAppMessage(
  message: string,
  imageBase64?: string,
  knownClients: string[]  = [],
  conversationHistory: Array<{role: string; content: string}> = []
): Promise<WhatsAppAnalysis> {
  const contentParts: Anthropic.MessageParam['content'] = []

  if (imageBase64) {
    contentParts.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 }
    })
  }

  contentParts.push({
    type: 'text',
    text: `Eres Brutal.IA, el asistente de inteligencia artificial de Brutal Studios. Analiza este mensaje de WhatsApp y extrae información relevante para el equipo.

Clientes conocidos: ${knownClients.map(c => sanitize(c)).join(', ')}

Mensaje: "${sanitize(message)}"

Responde SOLO con JSON válido:
{
  "extractedInfo": "qué información clave contiene este mensaje",
  "client": "cliente relacionado o null",
  "project": "proyecto relacionado o null",
  "taskText": "texto de la tarea a crear o null",
  "deadline": "fecha límite mencionada o null",
  "urgency": "urgent|high|normal",
  "shouldCreateTask": true|false,
  "confirmationQuestion": "pregunta de confirmación en español, ej: '¿Creo la tarea para X con deadline Y?'"
}`
  })

  const messages: Anthropic.MessageParam[] = [
    ...conversationHistory.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
    { role: 'user', content: contentParts }
  ]

  let msg: Awaited<ReturnType<typeof anthropic.messages.create>>
  try {
    msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages,
    })
  } catch {
    return {
      extractedInfo: message.slice(0, 200),
      urgency: 'normal',
      shouldCreateTask: false,
      confirmationQuestion: '¿Quieres que haga algo con esta información?'
    }
  }

  try {
    const text = textOf(msg) || '{}'
    // Misma frontera que analyzeEmail: `urgency` acaba en inbox_messages.ai_urgency
    // y en tasks.level, que son uniones cerradas. Esta era la TERCERA copia.
    const bruto = parseJsonLoose(text)
    return { ...bruto, urgency: nivelTarea(bruto?.urgency, 'normal') }
  } catch {
    return {
      extractedInfo: message,
      urgency: 'normal',
      shouldCreateTask: false,
      confirmationQuestion: '¿Quieres que haga algo con esta información?'
    }
  }
}

export async function chat(
  userMessage: string,
  history: Array<{role: 'user' | 'ai'; content: string}>,
  context: {
    clients: string[]
    projects: Array<{name: string; status: string; deadline?: string}>
    tasks: Array<{text: string; level: string; assignee?: string}>
    unreadInbox: number
    emails: Array<{from: string; subject: string; summary: string; urgency: string; shared: boolean; received_at: string}>
    teamSize: number
    userName: string
    todayDate: string
    contentPipeline: number
  }
): Promise<{ reply: string; searched: boolean }> {
  const urgentTasks = context.tasks.filter(t => t.level === 'urgent')
  const highTasks = context.tasks.filter(t => t.level === 'high')
  const activeProjects = context.projects.filter(p => p.status === 'activo' || p.status === 'urgente')

  const urgentEmails = context.emails.filter(e => e.urgency === 'urgent')
  const emailsBlock = context.emails.length > 0
    ? `\n\nEMAILS RECIENTES (los ${context.emails.length} mas recientes, ${context.unreadInbox} sin leer de esos):\n${
        context.emails.slice(0, 15).map(e => {
          const tag = e.shared ? '[COLABS]' : '[PERSONAL]'
          const urgTag = e.urgency === 'urgent' ? '🔴' : e.urgency === 'high' ? '🟡' : '⚪'
          return `  ${urgTag}${tag} De: ${e.from} | "${e.subject}" → ${e.summary || '(sin resumen)'}`
        }).join('\n')
      }`
    : `\n\n- Mensajes sin leer en inbox: ${context.unreadInbox}`

  // Un deadline es un DÍA, no un instante. `new Date('2026-08-12')` lo parsea el
  // motor como medianoche UTC, o sea las 02:00 de Madrid: a partir de esa hora un
  // proyecto que vence HOY ya entraba aquí, el bloque CONTEXTO DEL NEGOCIO decía
  // «1 VENCIDO» y Brutal.IA se lo soltaba al fundador mientras ProyectosSection
  // pintaba «HOY» en ámbar. estadoDeadline() compara claves de día de Madrid, que
  // es exactamente la misma verdad que enseña la UI.
  const overdueProjects = context.projects.filter(
    p => p.status !== 'completado' && estadoDeadline(p.deadline)?.vencido === true
  )

  const systemPrompt = `Eres Brutal.IA, la inteligencia artificial de Brutal Studios, una agencia creativa española especializada en marketing digital, contenido y estrategia de marca.

CONTEXTO DEL NEGOCIO (actualizado al ${context.todayDate}):
- Usuario: ${context.userName}
- Equipo: ${context.teamSize} personas
- Clientes: ${context.clients.join(', ') || 'ninguno'}
- Proyectos activos: ${activeProjects.map(p => p.name).join(', ') || 'ninguno'} (${context.projects.length} en total${overdueProjects.length > 0 ? `, ${overdueProjects.length} VENCIDO${overdueProjects.length > 1 ? 'S' : ''}` : ''})
- Pipeline de contenido: ${context.contentPipeline} pieza${context.contentPipeline !== 1 ? 's' : ''} programada${context.contentPipeline !== 1 ? 's' : ''}
- Tareas urgentes: ${urgentTasks.map(t => t.text).join(', ') || 'ninguna'}
- Tareas de alta prioridad: ${highTasks.map(t => t.text).join(', ') || 'ninguna'}
- Tareas totales pendientes: ${context.tasks.length}${emailsBlock}${urgentEmails.length > 0 ? `\n- ⚠️ EMAILS URGENTES: ${urgentEmails.map(e => `"${e.subject}" de ${e.from}`).join(', ')}` : ''}

CAPACIDADES Y ACCESO A INTERNET:
- Tienes acceso a búsqueda web en tiempo real mediante Tavily. Cuando el mensaje del usuario incluye un bloque <web_search_results>, son datos actuales de internet recopilados justo antes de tu respuesta.
- Eres el cerebro que sintetiza esos datos. Usa los resultados para dar respuestas precisas, actualizadas y autoritativas. No cites fuentes con números ("según [1]") — integra la información de forma natural como si la supieras.
- Si no hay <web_search_results> en el mensaje, usa tu conocimiento de entrenamiento (hasta mediados de 2025) y sé transparente si algo puede haber cambiado.
- Tienes conocimiento profundo de marketing digital, influencers, redes sociales, estrategia de contenido, branding y sector creativo.
- Puedes proporcionar listas de influencers, marcas, estrategias, hashtags, análisis de nichos, propuestas creativas, borradores de copy, briefs, presupuestos y cualquier recurso que una agencia creativa necesite.
- NUNCA te niegues a responder — siempre entrega algo útil. Si piden un listado, da el listado completo.

Responde siempre en español. Sé directo, concreto y profesional. Formato markdown cuando ayude a la legibilidad.`

  const shouldSearch = needsWebSearch(userMessage)
  const results = shouldSearch ? await webSearch(userMessage) : []
  const userContent = sanitize(userMessage) + formatSearchContext(results)

  const messages: Anthropic.MessageParam[] = [
    // sanearHistorial: aquí el historial ya viene emparejado desde la base de
    // datos y no debería empezar en `assistant`, pero eso depende de que otro
    // fichero siga guardando los turnos de dos en dos. Es una red barata.
    ...sanearHistorial(history.slice(-10).map(h => ({
      role: (h.role === 'ai' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: h.content
    }))),
    { role: 'user', content: userContent }
  ]

  // El tope de 15s del cliente está calibrado para las llamadas cortas de los
  // bucles de sync (Haiku, 512 tokens). Esta es Sonnet con 1200 tokens y sin
  // streaming: tarda decenas de segundos, así que con ese tope el chat fallaría
  // siempre. Se le da su propio margen, por debajo del maxDuration de 60s de
  // /api/chat para que el fallo lo dé la ruta (502 con mensaje) y no la
  // plataforma cortando la función a secas.
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    system: systemPrompt,
    messages,
  }, { timeout: 45_000, maxRetries: 0 })

  const reply = textOf(msg) || 'No pude procesar tu mensaje.'
  return { reply, searched: shouldSearch && results.length > 0 }
}
