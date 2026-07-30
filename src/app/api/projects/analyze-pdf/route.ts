import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Analiza un PDF con Claude (soporte nativo de documentos). Dos modos:
//  - sin `question`: análisis completo (resumen, puntos clave, acciones, datos del proyecto)
//  - con `question`: responde una pregunta sobre el PDF
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { pdf?: string; question?: string; projectName?: string; history?: Array<{role:string;content:string}> }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const rawPdf = body.pdf || ''
  // Acepta data URL (data:application/pdf;base64,....) o base64 puro
  const b64 = rawPdf.includes(',') ? rawPdf.slice(rawPdf.indexOf(',') + 1) : rawPdf
  if (!b64) return NextResponse.json({ error: 'Falta el PDF' }, { status: 400 })
  // Límite de tamaño (Vercel ~4.5MB body). base64 ≈ 1.33x → ~3.3MB de PDF
  if (b64.length > 4_400_000) return NextResponse.json({ error: 'PDF demasiado grande (máx. ~3MB)' }, { status: 413 })

  const pdfBlock: any = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
  const isChat = !!body.question?.trim()

  const analysisPrompt = `Eres el analista de Brutal Studios, una agencia creativa. Analiza este documento PDF${body.projectName ? ` del proyecto "${body.projectName}"` : ''} y responde SOLO con JSON válido (sin markdown), con esta forma exacta:
{
  "summary": "resumen ejecutivo claro en 3-5 frases, en español",
  "keyPoints": ["punto clave 1", "punto clave 2", "..."],
  "actions": ["acción o siguiente paso recomendado 1", "..."],
  "data": {
    "client": "cliente si aparece o null",
    "budget": "presupuesto/importe si aparece o null",
    "dates": "fechas o plazos relevantes si aparecen o null",
    "deliverables": ["entregable 1", "..."]
  }
}
Sé conciso y concreto. Si un dato no aparece en el documento, pon null (o [] en listas).`

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [
        ...((body.history || []).map(h => ({ role: h.role as 'user' | 'assistant', content: h.content }))),
        { role: 'user', content: isChat
          ? [pdfBlock, { type: 'text', text: `Responde en español, de forma directa y basándote solo en el documento. Pregunta: ${body.question!.trim()}` }]
          : [pdfBlock, { type: 'text', text: analysisPrompt }] }
      ],
    })
    const text = msg.content[0]?.type === 'text' ? msg.content[0].text : ''

    if (isChat) return NextResponse.json({ answer: text || 'No pude leer el documento.' })

    // Parsear JSON del análisis (tolerante a fences)
    const clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
    try {
      return NextResponse.json({ analysis: JSON.parse(clean) })
    } catch {
      return NextResponse.json({ analysis: { summary: text.slice(0, 800), keyPoints: [], actions: [], data: {} } })
    }
  } catch (e: any) {
    const m = String(e?.message || '')
    if (/document|pdf|media_type/i.test(m)) return NextResponse.json({ error: 'No se pudo leer el PDF (¿está protegido o dañado?)' }, { status: 422 })
    return NextResponse.json({ error: 'Error analizando el documento' }, { status: 500 })
  }
}
