import { createClient } from '@/lib/supabase/server'
import { leerFicha } from '@/lib/fichaEstudio'
import { todayKey } from '@/components/shared/helpers'
import { webSearch, needsWebSearch, formatSearchContextVoice } from '@/lib/ai'
import { checkHarveyRateLimit } from '@/lib/rate-limit'
import { NextRequest, NextResponse } from 'next/server'
import { sanearHistorial } from '@/lib/historialIA'
import { resumenDelEquipo, miJornadaHoy, COMO_LEER_EL_DIARIO } from '@/lib/resumenEquipo'

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
  // LA FICHA DEL ESTUDIO, desde el servidor.
  //
  // El resto del contexto de Harvey lo arma el CLIENTE y llega en el body, asi
  // que si un dia deja de mandarlo Harvey se queda sin memoria y nadie se
  // entera: no da error, solo contesta peor. La ficha se lee aqui para que haya
  // al menos una base que no dependa de eso.
  const ficha = await leerFicha(admin)
  if (await checkHarveyRateLimit(admin, user.id)) {
    return NextResponse.json({ error: 'Demasiadas solicitudes. Espera un momento.' }, { status: 429 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  const { message, context, history, stream } = await request.json()
  if (!message?.trim()) return NextResponse.json({ error: 'Empty message' }, { status: 400 })
  if (message.length > 4000) return NextResponse.json({ error: 'Message too long' }, { status: 400 })

  // ── LATENCIA: lo que se puede pedir a la vez, se pide a la vez ──────────────
  //
  // Javi: «tarda mucho en responder». Antes de que Anthropic recibiera el primer
  // byte había una cadena de esperas EN SERIE: la búsqueda web (externa, segundos),
  // luego una consulta de perfil, luego otra de la plantilla, y solo entonces la
  // llamada al modelo. Cada eslabón esperaba a que terminara el anterior sin
  // necesitarlo para nada.
  //
  // El comentario que había aquí decía «run in parallel» y el código hacía `await`
  // justo debajo. No corría en paralelo con nada.
  //
  // Ahora la búsqueda se LANZA aquí y se espera abajo, cuando de verdad hace falta
  // su resultado — con las consultas de la base corriendo mientras tanto.
  const needsSearch = needsWebSearch(String(message))
  const busqueda: Promise<Awaited<ReturnType<typeof webSearch>>> =
    needsSearch ? webSearch(String(message)) : Promise.resolve([])

  // Try Anthropic first if key available
  if (apiKey) {
    // El equipo ENTERO en UNA consulta, no dos.
    //
    // Antes eran dos viajes seguidos a la misma tabla: `quienHabla` (el que
    // pregunta) y `plantilla` (todos). Con `id, name, role` de todos se sacan las
    // dos cosas, y quien pregunta se busca en memoria — que cuesta cero.
    //
    // Y aquí se espera la búsqueda web, que lleva corriendo desde arriba: si tardó
    // menos que las consultas, ya está lista y no se espera nada.
    // El error SE NOMBRA. supabase-js no lanza: sin esto, un fallo al leer la
    // plantilla deja a Harvey sin saber quien es nadie —ni con quien habla, ni a
    // quien puede asignar una tarea— y se comporta como si el equipo estuviera
    // vacio. Contesta igual, solo que peor, y nadie se entera.
    const [{ data: plantilla, error: errPlantilla }, searchResults] = await Promise.all([
      admin.from('profiles').select('id, name, role'),
      busqueda,
    ])
    if (errPlantilla) console.error('[harvey] no se pudo leer la plantilla:', errPlantilla.message)
    const quienHabla = (plantilla ?? []).find(p => p.id === user.id) ?? null

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

    // Harvey no sabia CON QUIEN hablaba. Nada en su prompt decia quien era el
    // usuario, asi que «creame una tarea» o «asignamela a mi» no tenian a quien
    // referirse: emitia la accion con la persona vacia y la tarea nacia huerfana.
    //
    // Se resuelve en el SERVIDOR desde la sesion, no desde el cliente: el nombre
    // de quien habla no es algo que deba poder mandarse en el body.
    const nombreUsuario = (quienHabla?.name || '').trim()

    // ── Quién hizo qué, y solo cuando lo preguntan ─────────────────────────
    //
    // Vive en `resumenEquipo.ts` desde que Brutal.IA necesitó lo mismo: era esto
    // exactamente lo que hacía que la misma pregunta tuviera dos respuestas según
    // a cuál de las dos IAs se la hicieras. El disparador (para no pagar el bloque
    // en las preguntas que no van de esto) y el formato están allí.
    const resumenEquipo = await resumenDelEquipo(admin, plantilla ?? [], String(userContent || ''))
    // La jornada de QUIEN PREGUNTA va siempre, no solo cuando la pregunta casa con
    // la lista de palabras del bloque grande. Es lo que más se pregunta y cabe en
    // una línea.
    const miJornada = await miJornadaHoy(admin, user.id)

    const systemPrompt = `Eres Harvey, la inteligencia artificial ejecutiva de Brutal Studios.

CON QUIEN ESTAS HABLANDO AHORA: ${nombreUsuario || 'un miembro del equipo'}.${miJornada}${resumenEquipo}

${COMO_LEER_EL_DIARIO.trim()}
Cuando diga "para mi", "asignamela", "me lo apunto" o hable en primera persona sin
nombrar a nadie, se refiere a esta persona. Tu voz es serena, precisa y con autoridad. Como JARVIS para una agencia creativa.

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
- Tarea: [ACCION:tarea|texto de la tarea|nivel|persona|proyecto o vacío]  (niveles: urgent, high, normal; persona = nombre EXACTO de un miembro del EQUIPO listado abajo. Si el usuario dice "crea una tarea para Pablo", persona es Pablo. Si la tarea es para quien habla —"créame una tarea", "me lo apunto", o no menciona a nadie— deja persona VACÍA: se asignará sola a ${nombreUsuario || 'quien habla'}. NUNCA te inventes un nombre que no esté en el EQUIPO: si no reconoces a la persona que te han dicho, déjalo vacío y dilo en tu respuesta.) El PROYECTO es el nombre de uno de los PROYECTOS listados abajo, y solo si el usuario lo dice («la tarea del spot de Mango», «apúntalo en el proyecto X»). Si no lo dice o no lo reconoces, déjalo VACÍO: no adivines a qué proyecto pertenece.
- Proyecto: [ACCION:proyecto|nombre del proyecto|cliente o vacío|fecha YYYY-MM-DD o vacío]
- Cliente nuevo: [ACCION:cliente|nombre del cliente|sector o industria]
- Pieza de contenido: [ACCION:pieza|título de la pieza|plataforma|tipo]  (plataformas: Instagram, TikTok, YouTube, LinkedIn, Twitter, Pinterest; tipos: Post, Reel, Story, Video, Carrusel, Newsletter, Thread). "Añade una pieza / un reel / un post al pipeline" SIEMPRE emite esta acción EN ESA MISMA RESPUESTA. NO preguntes por el cliente, la fecha ni más detalles: con el tema y la plataforma basta (el resto se edita luego en el pipeline). Ejemplo: "añade un reel de Instagram sobre el festival" → [ACCION:pieza|Reel sobre el festival|Instagram|Reel]
- Completar una tarea: [ACCION:completar|título de la tarea tal como aparece en la lista de arriba]  — cuando el usuario diga que ya ha hecho algo («ya está el montaje», «marca como hecha la del guion», «he terminado X»). Copia el título TAL CUAL sale en el contexto; no lo reescribas ni lo resumas. Si no ves esa tarea en la lista, dilo y NO emitas la acción.
- Cerrar tu jornada: [ACCION:diario|lo que has hecho hoy, en una o dos frases]  — cuando el usuario cuente cómo le ha ido el día o pida cerrarlo («cierra mi día», «apunta que hoy he montado el teaser»). Escríbelo en primera persona y tal como lo diría él. Esto ANOTA el balance y, si la jornada seguía abierta, la CIERRA: no hay dos cierres distintos. NO pisa lo que ya tuviera escrito: se añade debajo.
- OJO: si arriba pone «TU JORNADA DE HOY: CERRADA», el día YA está cerrado. No digas que no lo está ni ofrezcas cerrarlo.
- Nota en Memoria: [ACCION:nota|el texto de la nota|categoría]  (categorías: General, Clientes, Procesos, Decisiones, Aprendizajes). «Apunta esto», «guárdalo en memoria», «que no se me olvide que…» → esta.
- Evento o reunión: [ACCION:evento|título|YYYY-MM-DD|HH:MM o vacío|invitados]  — la fecha es OBLIGATORIA; si el usuario no la dice, pregúntala antes de emitir la acción. invitados = nombres de miembros del EQUIPO separados por comas, o vacío. Si el usuario dice "todo el equipo" o "todos", escribe literalmente la palabra todos (no listes los nombres). Una reunión con invitados les llega como invitación de Google Calendar. La fecha de hoy es ${todayKey()}.

Solo UNA acción por respuesta. No expliques la sintaxis. Confirma en una frase qué vas a crear, incluyendo a quién se asigna o a quién invitas.

SUGERENCIAS PROACTIVAS DESDE EL INBOX:
- El contexto incluye los emails sin leer con su urgencia y resumen. Cuando el usuario pida el briefing, pregunte por sus correos o por qué hacer, revisa esos emails y detecta si alguno implica algo accionable.
- Si un email propone una reunión o cita con fecha clara → sugiere crearla y emite [ACCION:evento|...].
- Si un email pide contenido (vídeo, post, reel, campaña) → sugiere la pieza y emite [ACCION:pieza|...].
- Si un email pide algo que hay que hacer (enviar presupuesto, responder, entregar) → sugiere la tarea y emite [ACCION:tarea|...].
- Si un email es de un posible cliente nuevo → sugiere darlo de alta y emite [ACCION:cliente|...].
- Menciona de qué email sale la sugerencia ("El correo de X pide..."). El usuario siempre confirma antes de crear, así que sé decidido al sugerir. Sigue siendo UNA acción por respuesta: elige la más importante y ofrece las demás de palabra.

${ficha ? `FICHA DEL ESTUDIO (lo permanente: clientes, forma de trabajar, decisiones). Es tu punto de partida:
${ficha}

` : ''}${context ? `CONTEXTO ACTUAL DEL SISTEMA:\n${context}` : ''}`

    // Un único modelo vigente. Los antiguos (claude-3-haiku) están fuera de
    // soporte y solo servían de fallback histórico; ya no se usan.
    const models = ['claude-haiku-4-5-20251001']

    for (const model of models) {
      try {
        // Esta ruta usa fetch crudo en vez del SDK, asi que se quedo fuera de la
        // decision de acotar que ya estaba tomada en ai.ts. Si Anthropic acepta la
        // conexion y se queda parado ANTES de mandar cabeceras, la funcion agota
        // los 60 s y Vercel la mata sin respuesta: el localFallback de mas abajo
        // no llega a ejecutarse.
        //
        // Va junto con el signal del fetch de Tavily (ai.ts): ese corre ANTES,
        // dentro de los mismos 60 s, y un cuelgue suyo da el sintoma identico.
        // Acotar solo uno de los dos deja el agujero abierto.
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          signal: AbortSignal.timeout(45_000),
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            // El comando [ACCION:...] va en la ÚLTIMA línea de la respuesta, así
            // que es lo primero que se pierde cuando el modelo agota los tokens.
            // 300 daban para las 2-3 frases de siempre, pero no para lo que el
            // propio prompt autoriza —un briefing, un listado, el repaso de los
            // emails sin leer—: ahí la respuesta se cortaba a media frase y la
            // tarjeta «HARVEY PROPONE» no llegaba a aparecer, aunque Harvey
            // acabara de decir en voz alta que creaba la tarea. Este límite es
            // una red de seguridad; de la longitud ya se encargan las reglas de
            // comunicación del system prompt.
            max_tokens: needsSearch ? 800 : 600,
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
              // La pone `message_delta`; se lee justo antes de cerrar el stream.
              let truncada = false
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
                    let ev: any
                    // Un `data:` que no sea JSON no es un fallo: se ignora.
                    try { ev = JSON.parse(payload) } catch { continue }
                    // Anthropic manda sus errores DENTRO del propio SSE (overloaded,
                    // rate limit, corte del modelo). Tragárselos era lo mismo que
                    // tragarse un corte de red: el bucle terminaba tan tranquilo y
                    // la respuesta a medias se servía como si estuviera completa.
                    if (ev.type === 'error') throw new Error(ev.error?.message || 'error de la API a mitad del stream')
                    if (ev.type === 'message_delta' && ev.delta?.stop_reason === 'max_tokens') {
                      // El aviso iba SOLO a la consola del servidor, o sea a nadie.
                      // El `[ACCION:...]` va al FINAL de la respuesta, así que es lo
                      // primero que se pierde al truncar — y entonces pasa justo lo
                      // que este repo no tolera: Harvey dice en voz alta «te creo la
                      // tarea», la etiqueta se quedó cortada, no se crea nada, y el
                      // usuario se entera dentro de tres días.
                      console.warn('[harvey] respuesta truncada por max_tokens — el [ACCION:...] del final puede haberse perdido')
                      truncada = true
                    }
                    if (ev.type === 'content_block_delta' && ev.delta?.text) {
                      controller.enqueue(encoder.encode(ev.delta.text))
                    }
                  }
                }
              } catch (err: any) {
                // Este catch estaba vacío y le seguía un controller.close(): un
                // corte a mitad de la generación (reset de red, el techo de 60s de
                // Hobby, un error de la API) cerraba el stream LIMPIAMENTE, así que
                // el cliente daba por completas las dos primeras frases y —esto es
                // lo grave— se las LEÍA EN VOZ ALTA como si fueran la respuesta
                // entera. Con controller.error() el reader del cliente rechaza y cae
                // en su catch, que ya pinta «No he podido conectar» y no manda nada
                // al TTS. Mejor quedarse sin respuesta que con media que suena a una.
                console.error('[harvey] el stream se cortó a mitad:', err?.message ?? err)
                controller.error(err)
                return
              }
              if (truncada) {
                // Se dice al final y en su voz, que es como llega: el stream es
                // texto plano que se lee en voz alta, así que no hace falta ningún
                // canal nuevo ni tocar el cliente. Se afirma solo lo que se sabe
                // —que la respuesta se cortó— y se da la salida, en vez de dejar
                // que el silencio parezca un trabajo hecho.
                controller.enqueue(encoder.encode(
                  ' Me he quedado sin espacio y he cortado la respuesta. Si te he dicho que iba a crear algo, no ha llegado a crearse: pídemelo otra vez.'))
              }
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
