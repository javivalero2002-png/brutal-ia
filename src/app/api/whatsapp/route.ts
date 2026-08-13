import { createAdminClient } from '@/lib/supabase/server'
import { analyzeWhatsAppMessage } from '@/lib/ai'
import { sendWhatsAppMessage, parseWebhookMessage, downloadWhatsAppMedia } from '@/lib/whatsapp'
import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { nivelTarea } from '@/components/shared/helpers'

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN
const APP_SECRET = process.env.WHATSAPP_APP_SECRET

// Analiza el mensaje entrante con IA antes de responder: el default de Vercel se queda corto.
export const maxDuration = 60

// Webhook verification
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// Receive messages
export async function POST(request: NextRequest) {
  const rawBody = await request.text()

  // Fail-closed: sin APP_SECRET no hay forma de distinguir un webhook real de
  // Meta de uno falso. Antes esto era `if (APP_SECRET) {...}`, así que al faltar
  // la variable el control se saltaba entero y el endpoint aceptaba cualquier
  // payload sin firma — verificado en producción (HTTP 400 en vez de 401).
  // Cada mensaje aceptado dispara una llamada a Claude y escribe en inbox_messages,
  // y esta ruta no tiene rate limit.
  if (!APP_SECRET) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }
  const sig = request.headers.get('x-hub-signature-256')
  if (!sig) return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
  const expected = 'sha256=' + createHmac('sha256', APP_SECRET).update(rawBody).digest('hex')
  if (sig !== expected) return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })

  let body: any
  try { body = JSON.parse(rawBody) } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const message = parseWebhookMessage(body)

  if (!message) return NextResponse.json({ ok: true })

  const { from, fromName, text, type, mediaId } = message

  const supabase = await createAdminClient()

  // Get or create WhatsApp session
  const { data: session } = await supabase
    .from('whatsapp_sessions')
    .select('*, profiles(*)')
    .eq('phone', from)
    .single()

  const { data: clientsData } = await supabase.from('clients').select('name')
  const knownClients = (clientsData || []).map(c => c.name)

  // Download image if present
  let imageBase64: string | undefined
  if (mediaId && type === 'image') {
    try { imageBase64 = await downloadWhatsAppMedia(mediaId) } catch { }
  }

  let analysis: Awaited<ReturnType<typeof analyzeWhatsAppMessage>>
  try {
    analysis = await analyzeWhatsAppMessage(text, imageBase64, knownClients)
  } catch {
    analysis = { extractedInfo: text.slice(0, 200), shouldCreateTask: false, urgency: 'normal', confirmationQuestion: '' }
  }

  // Add to inbox_messages for the linked user
  if (session?.user_id) {
    const { error: inboxErr } = await supabase.from('inbox_messages').insert({
      user_id: session.user_id,
      source: 'whatsapp',
      from_name: fromName,
      from_phone: from,
      subject: `WhatsApp: ${fromName}`,
      body_preview: text.slice(0, 500),
      ai_summary: analysis.extractedInfo,
      ai_action: analysis.shouldCreateTask ? analysis.taskText : 'Sin acción requerida',
      ai_client: analysis.client || 'Desconocido',
      ai_urgency: analysis.urgency,
      is_unread: true,
      is_read: false,
    })
    if (inboxErr) console.error('[whatsapp] no se pudo guardar el mensaje:', inboxErr.message)
  }

  // Check confirmation BEFORE overwriting context
  let reply = ''
  const lowerText = text.toLowerCase().trim()
  const isConfirmation = (lowerText === 'sí' || lowerText === 'si' || lowerText === 'yes') &&
    session?.context?.awaitingConfirmation &&
    session?.context?.lastAnalysis?.taskText

  if (isConfirmation) {
    const prev = session.context.lastAnalysis
    // El «✅ Tarea creada» estaba FUERA de este if, asi que un numero sin perfil
    // enlazado —whatsapp_sessions.user_id es nullable y no lo rellena nadie hoy—
    // recibia la confirmacion sin que se hubiera escrito una sola fila. Y el error
    // del insert se tiraba, asi que con perfil enlazado pasaba lo mismo en cuanto
    // Postgres dijera que no.
    let creada = false
    if (session?.user_id) {
      const { error: tareaErr } = await supabase.from('tasks').insert({
        created_by: session.user_id,
        text: prev.taskText,
        level: nivelTarea(prev.urgency),
        source: 'whatsapp',
      })
      if (tareaErr) console.error('[whatsapp] no se pudo crear la tarea:', tareaErr.message)
      else creada = true
    }
    reply = creada
      ? `✅ Tarea creada en Brutal.IA:\n\n"${prev.taskText}"\n\nPuedes verla en tu tablón.`
      : `No he podido crear la tarea. Escribe a quien lleva Brutal.IA para que enlace este número.`
    await supabase.from('whatsapp_sessions').upsert({
      phone: from,
      last_message_at: new Date().toISOString(),
      context: { awaitingConfirmation: false },
    }, { onConflict: 'phone' })
  } else {
    await supabase.from('whatsapp_sessions').upsert({
      phone: from,
      last_message_at: new Date().toISOString(),
      context: {
        lastAnalysis: analysis,
        awaitingConfirmation: analysis.shouldCreateTask,
      },
    }, { onConflict: 'phone' })

    if (analysis.shouldCreateTask) {
      reply = `✅ *Brutal.IA* entendió:\n\n${analysis.extractedInfo}\n\n${analysis.confirmationQuestion}\n\nResponde *sí* para crear la tarea o *no* para cancelar.`
    } else {
      reply = `✅ *Brutal.IA* registró:\n\n${analysis.extractedInfo}\n\nInformación guardada en tu tablón.`
    }
  }

  await sendWhatsAppMessage(from, reply)
  return NextResponse.json({ ok: true })
}
