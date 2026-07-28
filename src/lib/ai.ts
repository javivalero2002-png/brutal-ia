import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface SearchResult {
  title: string
  content: string
  url: string
}

export async function webSearch(query: string): Promise<SearchResult[]> {
  const key = process.env.TAVILY_API_KEY
  if (!key) return []
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
    if (!res.ok) return []
    const data = await res.json()
    return (data.results || []).slice(0, 7).map((r: any) => ({
      title: r.title || '',
      content: (r.content || '').slice(0, 400),
      url: r.url || '',
    }))
  } catch { return [] }
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

// Returns true when the query likely benefits from real-time web data
export function needsWebSearch(query: string): boolean {
  return /busca|encuentra|consigue|influencer|instagram|tiktok|youtube|precio|tendencia|trend|noticias|actualidad|últim|listado|lista de|quién es|qué es|estadística|hashtag|seguidores|marca|agencia|competencia|referente|ejemplo de|casos de|cómo se hace|qué plataforma|cuánto cuesta|cuánto cobra/i.test(query)
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
  } catch {
    return { summary: subject, action: 'Revisar email', client: 'Desconocido', urgency: 'normal' }
  }

  try {
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '{}'
    return JSON.parse(text)
  } catch {
    return { summary: subject, action: 'Revisar email', client: 'Desconocido', urgency: 'normal' }
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
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '{}'
    return JSON.parse(text)
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
    projects: Array<{name: string; status: string}>
    tasks: Array<{text: string; level: string; assignee?: string}>
    unreadInbox: number
    emails: Array<{from: string; subject: string; summary: string; urgency: string; shared: boolean; received_at: string}>
    teamSize: number
    userName: string
  }
): Promise<{ reply: string; searched: boolean }> {
  const urgentTasks = context.tasks.filter(t => t.level === 'urgent')
  const highTasks = context.tasks.filter(t => t.level === 'high')
  const activeProjects = context.projects.filter(p => p.status === 'activo' || p.status === 'urgente')

  const urgentEmails = context.emails.filter(e => e.urgency === 'urgent')
  const emailsBlock = context.emails.length > 0
    ? `\n\nEMAILS RECIENTES (${context.emails.length} totales, ${context.unreadInbox} sin leer):\n${
        context.emails.slice(0, 15).map(e => {
          const tag = e.shared ? '[COLABS]' : '[PERSONAL]'
          const urgTag = e.urgency === 'urgent' ? '🔴' : e.urgency === 'high' ? '🟡' : '⚪'
          return `  ${urgTag}${tag} De: ${e.from} | "${e.subject}" → ${e.summary || '(sin resumen)'}`
        }).join('\n')
      }`
    : `\n\n- Mensajes sin leer en inbox: ${context.unreadInbox}`

  const systemPrompt = `Eres Brutal.IA, la inteligencia artificial de Brutal Studios, una agencia creativa española especializada en marketing digital, contenido y estrategia de marca.

CONTEXTO DEL NEGOCIO:
- Usuario: ${context.userName}
- Equipo: ${context.teamSize} personas
- Clientes: ${context.clients.join(', ') || 'ninguno'}
- Proyectos activos: ${activeProjects.map(p => p.name).join(', ') || 'ninguno'} (${context.projects.length} en total)
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
    ...history.slice(-10).map(h => ({
      role: (h.role === 'ai' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: h.content
    })),
    { role: 'user', content: userContent }
  ]

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    system: systemPrompt,
    messages,
  })

  const reply = msg.content[0].type === 'text' ? msg.content[0].text : 'No pude procesar tu mensaje.'
  return { reply, searched: shouldSearch && results.length > 0 }
}
