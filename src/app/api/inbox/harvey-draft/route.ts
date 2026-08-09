import { createClient, createAdminClient } from '@/lib/supabase/server'
import { checkAiRateLimit } from '@/lib/rate-limit'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Redaccion de borrador con Claude: el default de Vercel se queda corto.
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  if (await checkAiRateLimit(admin, user.id, 'draft')) {
    return NextResponse.json({ error: 'Demasiadas solicitudes. Espera un momento.' }, { status: 429 })
  }

  const { fromName, fromEmail, subject, summary, aiAction, senderLanguage } = await request.json()

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Eres el asistente de Brutal Studios, una agencia creativa española. Redacta un borrador de respuesta profesional a este email.

Remitente: ${fromName || 'Desconocido'} <${fromEmail || ''}>
Asunto: ${subject || 'Sin asunto'}
Resumen del email: ${summary || 'Sin resumen disponible'}
Acción requerida: ${aiAction || 'Ninguna específica'}
Idioma detectado del remitente: ${senderLanguage || 'español'}

Instrucciones:
- Responde en el mismo idioma del remitente
- Tono: profesional pero cercano, como lo haría una agencia creativa
- NO incluyas asunto, fecha, ni "De:", "Para:" — solo el cuerpo del email
- NO incluyas [tu nombre], [nombre], ni placeholders en corchetes — deja la firma en blanco para que el usuario la añada
- Sé conciso pero resuelve el punto principal
- Máximo 120 palabras

Responde SOLO con el cuerpo del email, nada más.`
      }]
    })

    const draft = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
    return NextResponse.json({ draft })
  } catch {
    return NextResponse.json({ error: 'Error generando borrador' }, { status: 502 })
  }
}
