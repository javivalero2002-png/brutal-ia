import { createClient } from '@/lib/supabase/server'
import { todayKey } from '@/components/shared/helpers'
import { webSearch, needsWebSearch, formatSearchContextVoice } from '@/lib/ai'
import { checkHarveyRateLimit } from '@/lib/rate-limit'
import { NextRequest, NextResponse } from 'next/server'
import { sanearHistorial } from '@/lib/historialIA'

// Chat + búsqueda web + reintentos de modelo pueden superar los 10s por defecto
export const maxDuration = 60

// Smart local fallback — parses the context string and returns a relevant response
// Used when Anthropic API has no credits or is unavailable
function localFallback(message: string, context: string): string {
  const msg = message.toLowerCase()

  // Parse context into a usable object
  const get = (label: string) => {
    const m = context.match(new RegExp(label + '[^\\n]*'))
    return m ? m[0] : ''
  }

  const tareas     = get('TAREAS:')
  const urgentes   = get('URGENTES')
  const alta       = get('ALTA PRIORIDAD')
  const proyectos  = get('PROYECTOS ACTIVOS')
  const atrasados  = get('ATRASADOS')
  const clientes   = get('CLIENTES ACTIVOS')
  const pipeline   = get('PIPELINE')
  const inbox      = get('INBOX')

  const numUrgentes = parseInt((context.match(/URGENTES \((\d+)\)/)||[])[1]||'0')
  const numAtrasados = parseInt((context.match(/ATRASADOS \((\d+)\)/)||[])[1]||'0')
  const numProys   = parseInt((context.match(/PROYECTOS ACTIVOS \((\d+)\)/)||[])[1]||'0')
  const numClients = parseInt((context.match(/CLIENTES ACTIVOS \((\d+)\)/)||[])[1]||'0')
  const completadas = parseInt((context.match(/(\d+) completadas hoy/)||[])[1]||'0')

  const urgentNames = (context.match(/URGENTES \(\d+\): ([^\n]+)/)||[])[1] || ''
  const projNames   = (context.match(/PROYECTOS ACTIVOS \(\d+\): ([^\n]+)/)||[])[1] || ''
  const clientNames = (context.match(/CLIENTES ACTIVOS \(\d+\): ([^\n]+)/)||[])[1] || ''
  const atrasNames  = (context.match(/ATRASADOS \(\d+\): ([^\n]+)/)||[])[1] || ''

  // Question matching
  if (msg.match(/situaci[oó]n|empresa|general|estado|resumen|c[oó]mo est[aá]/)) {
    if (numUrgentes > 0 || numAtrasados > 0) {
      let r = `Hay ${numUrgentes} tarea${numUrgentes!==1?'s':''} urgente${numUrgentes!==1?'s':''} pendiente${numUrgentes!==1?'s':''}.`
      if (numAtrasados > 0) r += ` ${numAtrasados} proyecto${numAtrasados!==1?'s':''} lleva${numAtrasados===1?'':'n'} retraso.`
      r += ` En total gestionas ${numProys} proyecto${numProys!==1?'s':''} activo${numProys!==1?'s':''} con ${numClients} cliente${numClients!==1?'s':''}.`
      return r
    }
    let r = `Todo controlado. ${numProys} proyecto${numProys!==1?'s':''} activo${numProys!==1?'s':''}, ${numClients} cliente${numClients!==1?'s':''} activo${numClients!==1?'s':''}.`
    if (completadas > 0) r += ` Has completado ${completadas} tarea${completadas!==1?'s':''} hoy.`
    return r
  }

  if (msg.match(/tarea|urgente|pendiente|qu[eé] tengo|qu[eé] hago/)) {
    if (numUrgentes === 0) return 'No tienes tareas urgentes ahora mismo. Puedes avanzar con calma.'
    const names = urgentNames.replace(/"/g,'').split(',').slice(0,3).map(s=>s.trim()).filter(Boolean)
    return `${numUrgentes} tarea${numUrgentes!==1?'s urgentes':' urgente'}: ${names.join(', ')}.`
  }

  if (msg.match(/proyecto|proyectos/)) {
    if (numProys === 0) return 'No hay proyectos activos en este momento.'
    let r = `${numProys} proyecto${numProys!==1?'s':''} activo${numProys!==1?'s':''}: ${projNames.split('|').slice(0,4).map(s=>s.trim()).join(', ')}.`
    if (numAtrasados > 0) r += ` Atención: ${atrasNames} lleva${numAtrasados===1?'':'n'} retraso.`
    return r
  }

  if (msg.match(/cliente|clientes/)) {
    if (numClients === 0) return 'No hay clientes activos registrados actualmente.'
    return `${numClients} cliente${numClients!==1?'s activos':' activo'}: ${clientNames}.`
  }

  if (msg.match(/inbox|mensaje|correo|email/)) {
    const numInbox = parseInt((context.match(/INBOX[^\d]*(\d+)/)||[])[1]||'0')
    if (numInbox === 0) return 'El inbox está limpio. Sin mensajes sin leer.'
    return `Tienes ${numInbox} mensaje${numInbox!==1?'s':''} sin leer en el inbox.`
  }

  if (msg.match(/pipeline|contenido|publicar/)) {
    const numPip = parseInt((context.match(/PIPELINE CONTENIDO: (\d+)/)||[])[1]||'0')
    if (numPip === 0) return 'El pipeline de contenido está vacío.'
    return `${numPip} pieza${numPip!==1?'s':''} de contenido pendiente${numPip!==1?'s':''} de publicar.`
  }

  // Generic fallback
  return `Aquí tu resumen: ${numProys} proyecto${numProys!==1?'s':''} activo${numProys!==1?'s':''}, ${numUrgentes} urgente${numUrgentes!==1?'s':''}, ${numClients} cliente${numClients!==1?'s':''}.`
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { createAdminClient } = await import('@/lib/supabase/server')
  const admin = await createAdminClient()
  if (await checkHarveyRateLimit(admin, user.id)) {
    return NextResponse.json({ error: 'Demasiadas solicitudes. Espera un momento.' }, { status: 429 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  const { message, context, history, stream } = await request.json()
  if (!message?.trim()) return NextResponse.json({ error: 'Empty message' }, { status: 400 })
  if (message.length > 4000) return NextResponse.json({ error: 'Message too long' }, { status: 400 })

  // Web search — run in parallel before calling Anthropic
  const needsSearch = needsWebSearch(String(message))
  const searchResults = needsSearch ? await webSearch(String(message)) : []

  // Try Anthropic first if key available
  if (apiKey) {
    const userContent = String(message) + formatSearchContextVoice(searchResults)

    // El historial se SANEA antes de mandarlo. La API de Anthropic exige que el
    // primer mensaje sea `user`, y aquí no lo era casi nunca: la conversación
    // arranca con el saludo de Harvey, así que un `slice(-10)` del cliente empieza
    // en un mensaje suyo mientras la conversación sea corta.
    //
    // Lo que pasaba entonces no era un error visible, que sería lo de menos: la
    // llamada devolvía 400, se caía al `localFallback` y el cliente pintaba —y
    // LEÍA EN VOZ ALTA— una frase enlatada como si la hubiera pensado Harvey. Las
    // primeras preguntas de cada día, todos los días, en la sección estrella.
    //
    // Esta misma corrección ya existía en /api/chat, con su comentario explicando
    // el 502. Va aquí en el SERVIDOR, y no solo en el cliente, para que valga
    // también para cualquier futuro llamante que se despiste.
    const previos = sanearHistorial((history || []).map((h: {role: string; text: string}) => ({
      role: (h.role === 'harvey' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: String(h.text ?? ''),
    })))

    const messages = [...previos, { role: 'user', content: userContent }]

    const systemPrompt = `Eres Harvey, la inteligencia artificial ejecutiva de Brutal Studios. Tu voz es serena, precisa y con autoridad. Como JARVIS para una agencia creativa.

REGLAS DE COMUNICACIÓN:
- Siempre en español.
- Texto limpio, cero markdown. Tu respuesta se reproduce en voz alta — nada de asteriscos, guiones, corchetes ni URLs.
- Voz natural y directa. Los números los integras fluidamente. Las listas de más de 3 elementos las conviertes en prosa fluida.
- Si hay urgencias del sistema, las nombras primero.
- Respuestas MUY concisas: 2-3 frases cortas como máximo, salvo que el usuario pida expresamente un listado o un briefing completo. Ve al grano: primero el dato, sin preámbulos.
- Tienes acceso a: tareas, proyectos, clientes, pipeline de contenido, inbox y calendario.

BÚSQUEDA WEB:
- Tienes acceso a búsqueda web en tiempo real. Cuando hay un bloque <web_search_results> en el mensaje, son datos actuales de internet recopilados justo antes de tu respuesta.
- Eres el cerebro que sintetiza esa información. Dila de forma natural, con autoridad, como si la supieras. No cites fuentes ni números. Di algo como "He buscado y..." o "Según lo que tengo ahora..."
- Si piden un listado largo, nombra los 3 o 4 más relevantes en voz alta y ofrece crear el resto como tarea o nota.
- Si no hay resultados web, usa tu conocimiento de entrenamiento y di brevemente si algo puede haber cambiado.

ACCIONES — cuando el usuario pida crear, añadir o apuntar algo de estos tipos, SIEMPRE (sin excepción) incluye AL FINAL de tu respuesta en una nueva línea el comando exacto:
- Tarea: [ACCION:tarea|texto de la tarea|nivel|persona]  (niveles: urgent, high, normal; persona = nombre de un miembro del EQUIPO al que se asigna, o vacío si es para quien habla. Si el usuario dice "crea una tarea para Pablo", persona es Pablo.)
- Proyecto: [ACCION:proyecto|nombre del proyecto|cliente o vacío|fecha YYYY-MM-DD o vacío]
- Cliente nuevo: [ACCION:cliente|nombre del cliente|sector o industria]
- Pieza de contenido: [ACCION:pieza|título de la pieza|plataforma|tipo]  (plataformas: Instagram, TikTok, YouTube, LinkedIn, Twitter, Podcast; tipos: Post, Reel, Story, Video, Carrusel, Newsletter, Thread). "Añade una pieza / un reel / un post al pipeline" SIEMPRE emite esta acción EN ESA MISMA RESPUESTA. NO preguntes por el cliente, la fecha ni más detalles: con el tema y la plataforma basta (el resto se edita luego en el pipeline). Ejemplo: "añade un reel de Instagram sobre el festival" → [ACCION:pieza|Reel sobre el festival|Instagram|Reel]
- Evento o reunión: [ACCION:evento|título|YYYY-MM-DD|HH:MM o vacío|invitados]  — la fecha es OBLIGATORIA; si el usuario no la dice, pregúntala antes de emitir la acción. invitados = nombres de miembros del EQUIPO separados por comas, o vacío. Si el usuario dice "todo el equipo" o "todos", escribe literalmente la palabra todos (no listes los nombres). Una reunión con invitados les llega como invitación de Google Calendar. La fecha de hoy es ${todayKey()}.

Solo UNA acción por respuesta. No expliques la sintaxis. Confirma en una frase qué vas a crear, incluyendo a quién se asigna o a quién invitas.

SUGERENCIAS PROACTIVAS DESDE EL INBOX:
- El contexto incluye los emails sin leer con su urgencia y resumen. Cuando el usuario pida el briefing, pregunte por sus correos o por qué hacer, revisa esos emails y detecta si alguno implica algo accionable.
- Si un email propone una reunión o cita con fecha clara → sugiere crearla y emite [ACCION:evento|...].
- Si un email pide contenido (vídeo, post, reel, campaña) → sugiere la pieza y emite [ACCION:pieza|...].
- Si un email pide algo que hay que hacer (enviar presupuesto, responder, entregar) → sugiere la tarea y emite [ACCION:tarea|...].
- Si un email es de un posible cliente nuevo → sugiere darlo de alta y emite [ACCION:cliente|...].
- Menciona de qué email sale la sugerencia ("El correo de X pide..."). El usuario siempre confirma antes de crear, así que sé decidido al sugerir. Sigue siendo UNA acción por respuesta: elige la más importante y ofrece las demás de palabra.

${context ? `CONTEXTO ACTUAL DEL SISTEMA:\n${context}` : ''}`

    // Un único modelo vigente. Los antiguos (claude-3-haiku) están fuera de
    // soporte y solo servían de fallback histórico; ya no se usan.
    const models = ['claude-haiku-4-5-20251001']

    for (const model of models) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            max_tokens: needsSearch ? 500 : 300,
            system: systemPrompt,
            messages,
            ...(stream ? { stream: true } : {}),
          }),
        })

        // ── Modo STREAMING: el cliente recibe el texto según se genera y puede
        //    pedir la voz de la primera frase mientras el resto aún llega ──
        if (stream && res.ok && res.body) {
          const encoder = new TextEncoder()
          const upstream = res.body.getReader()
          const readable = new ReadableStream({
            async start(controller) {
              const dec = new TextDecoder()
              let buf = ''
              try {
                while (true) {
                  const { done, value } = await upstream.read()
                  if (done) break
                  buf += dec.decode(value, { stream: true })
                  const lines = buf.split('\n')
                  buf = lines.pop() || ''
                  for (const line of lines) {
                    if (!line.startsWith('data:')) continue
                    const payload = line.slice(5).trim()
                    if (!payload || payload === '[DONE]') continue
                    try {
                      const ev = JSON.parse(payload)
                      if (ev.type === 'content_block_delta' && ev.delta?.text) {
                        controller.enqueue(encoder.encode(ev.delta.text))
                      }
                    } catch {}
                  }
                }
              } catch {}
              controller.close()
            },
          })
          return new Response(readable, {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-store',
              'x-searched': needsSearch && searchResults.length > 0 ? '1' : '0',
            },
          })
        }

        const data = await res.json()

        if (res.ok) {
          const reply = data?.content?.[0]?.text || ''
          if (reply.trim()) return NextResponse.json({ reply, model, searched: needsSearch && searchResults.length > 0 })
        }

        console.error(`Anthropic [${model}] error:`, res.status, JSON.stringify(data?.error))

        // Only retry on model-not-found (404), not on auth/billing errors
        if (res.status !== 404) break
      } catch (err: any) {
        console.error(`Anthropic [${model}] fetch error:`, err?.message)
        break
      }
    }
  }

  // Fallback: smart local response using context
  const reply = localFallback(message, context || '')
  return NextResponse.json({ reply, fallback: true })
}
