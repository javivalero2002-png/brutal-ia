import { createClient, createAdminClient } from '@/lib/supabase/server'
import { checkAiRateLimit } from '@/lib/rate-limit'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'crypto'
import { isOwnStorageUrl } from '@/lib/safeFetch'
import { textOf } from '@/lib/aiText'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const BUCKET = 'content-videos'

// Analiza un PDF con Claude. Dos modos:
//  - sin `question`: análisis completo JSON + guarda el PDF en Supabase Storage
//  - con `question`: responde una pregunta sobre el PDF (no almacena)
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rlAdmin = await createAdminClient()
  if (await checkAiRateLimit(rlAdmin, user.id, 'pdf')) {
    return NextResponse.json({ error: 'Demasiadas solicitudes. Espera un momento.' }, { status: 429 })
  }

  let body: { pdf?: string; pdfUrl?: string; question?: string; projectName?: string; history?: Array<{role:string;content:string}> }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  let b64: string
  let pdfUrlFromBody: string | null = body.pdfUrl || null

  if (body.pdfUrl) {
    // Opción A: el cliente subió el PDF directamente a Supabase; lo descargamos aquí
    if (!isOwnStorageUrl(body.pdfUrl)) return NextResponse.json({ error: 'URL de PDF no permitida' }, { status: 400 })
    try {
      const resp = await fetch(body.pdfUrl, { signal: AbortSignal.timeout(30_000) })
      if (!resp.ok) return NextResponse.json({ error: 'No se pudo descargar el PDF' }, { status: 502 })
      const buf = Buffer.from(await resp.arrayBuffer())
      if (buf.length > 50 * 1024 * 1024) return NextResponse.json({ error: 'PDF demasiado grande (máx. 50 MB)' }, { status: 413 })
      b64 = buf.toString('base64')
    } catch { return NextResponse.json({ error: 'Error descargando el PDF' }, { status: 502 }) }
  } else {
    // Opción B (legacy): base64 en el body
    const rawPdf = body.pdf || ''
    b64 = rawPdf.includes(',') ? rawPdf.slice(rawPdf.indexOf(',') + 1) : rawPdf
    if (!b64) return NextResponse.json({ error: 'Falta el PDF' }, { status: 400 })
    if (b64.length > 4_400_000) return NextResponse.json({ error: 'PDF demasiado grande (máx. ~3MB) — sube el archivo primero' }, { status: 413 })
  }

  // cache_control marca el PDF como prefijo cacheable: en el modo chat cada
  // pregunta reenvía el documento entero (un deck de 30 páginas son decenas de
  // miles de tokens de input). Con el caché, de la 2ª pregunta en adelante se
  // lee de caché en vez de re-facturarse como input nuevo.
  const isChat = !!body.question?.trim()
  // El caché solo se aplica en modo chat. Escribir en caché cuesta 1,25×, y en
  // modo análisis hay UNA sola llamada por PDF: se pagaría el recargo de
  // escritura sin que nadie llegue a leerla nunca (~25% más caro en la parte del
  // documento, que en un deck de 30 páginas son decenas de miles de tokens).
  const pdfBlock: any = {
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: b64 },
    ...(isChat ? { cache_control: { type: 'ephemeral' } } : {}),
  }

  // Si ya tenemos URL (subida directa), usarla; si no, subir el PDF a Supabase
  let pdfUrl: string | null = pdfUrlFromBody
  if (!isChat && !pdfUrl) {
    try {
      const admin = await createAdminClient()
      await admin.storage.createBucket(BUCKET, { public: true }).then(() => {}, () => {})
      const buffer = Buffer.from(b64, 'base64')
      const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16)
      const path = `pdfs/${hash}.pdf`
      const { data: existing } = await admin.storage.from(BUCKET).list('pdfs', { search: `${hash}.pdf` })
      if (existing && existing.length > 0) {
        pdfUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
      } else {
        const { error: ue } = await admin.storage.from(BUCKET).upload(path, buffer, { contentType: 'application/pdf', upsert: false })
        if (!ue) pdfUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
      }
    } catch { /* storage failure is non-fatal */ }
  }

  const analysisPrompt = `Eres el asistente de producción de Brutal Studios (agencia creativa). Analiza este PDF${body.projectName ? ` del proyecto "${body.projectName}"` : ''} y extrae la información clave.

IMPORTANTE: Devuelve ÚNICAMENTE el objeto JSON a continuación. Sin texto previo, sin texto posterior, sin bloques de código, sin comillas triples, sin markdown. Solo JSON puro.

El campo "summary" debe ser prosa fluida en español, 3-4 frases directas y concretas que expliquen QUÉ es el proyecto, PARA QUIÉN y QUÉ valor aporta. Sin asteriscos, sin bullet points, sin formato especial. Solo texto normal.

Los campos "keyPoints" y "actions" son strings cortos (máx 10 palabras cada uno), directos, sin guiones ni asteriscos al inicio.

{
  "summary": "Texto fluido en español. Sin markdown. Sin asteriscos. 3-4 frases que expliquen el proyecto de forma clara y práctica.",
  "keyPoints": ["punto breve 1", "punto breve 2", "punto breve 3", "punto breve 4", "punto breve 5"],
  "actions": ["acción ejecutable 1", "acción ejecutable 2", "acción ejecutable 3", "acción ejecutable 4"],
  "risks": ["riesgo 1", "riesgo 2"],
  "data": {
    "client": "nombre del cliente o null",
    "budget": "cifra y moneda o null",
    "dates": "fechas clave o null",
    "scope": "alcance en 1 frase breve o null",
    "deliverables": ["entregable 1", "entregable 2"]
  }
}

Si el documento está en otro idioma, responde en español. Si un campo no tiene información real en el documento, usa null (no inventes).`

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: isChat ? 400 : 1800,
      messages: [
        ...((body.history || []).map(h => ({ role: h.role as 'user' | 'assistant', content: h.content }))),
        { role: 'user', content: isChat
          ? [pdfBlock, { type: 'text', text: `Responde en español, directo y basándote solo en el documento. Pregunta: ${body.question!.trim()}` }]
          : [pdfBlock, { type: 'text', text: analysisPrompt }] }
      ],
    })
    const text = textOf(msg)

    if (isChat) return NextResponse.json({ answer: text || 'No pude leer el documento.' })

    const clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
    try {
      return NextResponse.json({ analysis: JSON.parse(clean), pdfUrl })
    } catch {
      return NextResponse.json({ analysis: { summary: text.slice(0, 600), keyPoints: [], actions: [], data: {} }, pdfUrl })
    }
  } catch (e: any) {
    const m = String(e?.message || '')
    if (/document|pdf|media_type/i.test(m)) return NextResponse.json({ error: 'No se pudo leer el PDF (¿está protegido o dañado?)' }, { status: 422 })
    return NextResponse.json({ error: 'Error analizando el documento' }, { status: 500 })
  }
}
