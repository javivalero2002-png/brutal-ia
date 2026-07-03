import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `Eres el asistente de IA de Brutal Studios, una agencia creativa. Analiza este email y responde en JSON.

Clientes conocidos: ${knownClients.join(', ')}

Email de: ${fromName}
Asunto: ${subject}
Cuerpo: ${body.slice(0, 1200)}

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

Clientes conocidos: ${knownClients.join(', ')}

Mensaje: "${message}"

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

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages,
  })

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
    projects: string[]
    urgentTasks: string[]
    userName: string
  }
): Promise<string> {
  const systemPrompt = `Eres Brutal.IA, la inteligencia artificial de Brutal Studios, una agencia creativa española.
Ayudas al equipo con: gestión de proyectos, clientes, tareas y contenido.
Usuario actual: ${context.userName}
Clientes: ${context.clients.join(', ')}
Proyectos activos: ${context.projects.join(', ')}
Tareas urgentes: ${context.urgentTasks.join(', ')}
Responde siempre en español, de forma concisa y profesional. Máx 3 frases a no ser que pidan algo largo.`

  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-10).map(h => ({
      role: (h.role === 'ai' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: h.content
    })),
    { role: 'user', content: userMessage }
  ]

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    system: systemPrompt,
    messages,
  })

  return msg.content[0].type === 'text' ? msg.content[0].text : 'No pude procesar tu mensaje.'
}
