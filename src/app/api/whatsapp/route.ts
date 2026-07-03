import { createAdminClient } from '@/lib/supabase/server'
import { analyzeWhatsAppMessage } from '@/lib/ai'
import { sendWhatsAppMessage, parseWebhookMessage, downloadWhatsAppMedia } from '@/lib/whatsapp'
import { NextRequest, NextResponse } from 'next/server'

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN

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
  const body = await request.json()
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

  const analysis = await analyzeWhatsAppMessage(text, imageBase64, knownClients)

  // Add to inbox_messages for the linked user
  if (session?.user_id) {
    await supabase.from('inbox_messages').insert({
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
  }

  // Update session context
  await supabase.from('whatsapp_sessions').upsert({
    phone: from,
    last_message_at: new Date().toISOString(),
    context: {
      lastAnalysis: analysis,
      awaitingConfirmation: analysis.shouldCreateTask,
    },
  }, { onConflict: 'phone' })

  // Build reply
  let reply = ''

  if (analysis.shouldCreateTask) {
    reply = `✅ *Nexus IA* entendió:\n\n${analysis.extractedInfo}\n\n${analysis.confirmationQuestion}\n\nResponde *sí* para crear la tarea o *no* para cancelar.`
  } else {
    reply = `✅ *Nexus IA* registró:\n\n${analysis.extractedInfo}\n\nInformación guardada en tu tablón.`
  }

  // Check if this is a confirmation response
  const lowerText = text.toLowerCase().trim()
  if ((lowerText === 'sí' || lowerText === 'si' || lowerText === 'yes') &&
      session?.context?.awaitingConfirmation &&
      session?.context?.lastAnalysis?.taskText) {
    const prev = session.context.lastAnalysis
    if (session?.user_id) {
      await supabase.from('tasks').insert({
        created_by: session.user_id,
        text: prev.taskText,
        level: prev.urgency === 'urgent' ? 'urgent' : 'high',
        source: 'whatsapp',
      })
    }
    reply = `✅ Tarea creada en Nexus:\n\n"${prev.taskText}"\n\nPuedes verla en tu tablón.`
    await supabase.from('whatsapp_sessions').update({ context: { awaitingConfirmation: false } }).eq('phone', from)
  }

  await sendWhatsAppMessage(from, reply)
  return NextResponse.json({ ok: true })
}
