import { createClient, createAdminClient } from '@/lib/supabase/server'
import { checkAiRateLimit } from '@/lib/rate-limit'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'crypto'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const BUCKET = 'content-videos'
const MAX_BYTES = 20 * 1024 * 1024

// Sube un PDF a Supabase Storage y genera un resumen con Haiku (barato).
// Deduplica por hash SHA-256: el mismo archivo nunca se sube dos veces.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  if (await checkAiRateLimit(admin, user.id, 'doc')) {
    return NextResponse.json({ error: 'Demasiadas solicitudes. Espera un momento.' }, { status: 429 })
  }

  const contentType = request.headers.get('content-type') || ''
  let buffer: Buffer
  let filename: string
  let publicUrl: string

  if (contentType.includes('application/json')) {
    // Opción A: cliente ya subió a Supabase, nos manda la URL pública
    const { url, name } = await request.json().catch(() => ({}))
    if (!url) return NextResponse.json({ error: 'Falta la URL del documento' }, { status: 400 })
    filename = name || 'documento.pdf'
    publicUrl = url
    // Descargar para generar el resumen con Claude
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!resp.ok) return NextResponse.json({ error: 'No se pudo leer el archivo subido' }, { status: 502 })
      buffer = Buffer.from(await resp.arrayBuffer())
    } catch { return NextResponse.json({ error: 'Error descargando el documento' }, { status: 502 }) }
  } else {
    // Opción B (legacy): FormData con el archivo
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No se recibió el archivo' }, { status: 400 })
    if (file.type !== 'application/pdf') return NextResponse.json({ error: 'Solo se admiten PDF' }, { status: 415 })
    if (file.size > MAX_BYTES) return NextResponse.json({ error: `El PDF supera 20 MB (${(file.size/1024/1024).toFixed(0)} MB).` }, { status: 413 })
    filename = file.name
    buffer = Buffer.from(await file.arrayBuffer())

    await admin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES }).then(() => {}, () => {})
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16)
    const path = `docs/${hash}.pdf`
    const { data: existing } = await admin.storage.from(BUCKET).list('docs', { search: `${hash}.pdf` })
    if (existing && existing.length > 0) {
      publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
    } else {
      const { error: ue } = await admin.storage.from(BUCKET).upload(path, buffer, { contentType: 'application/pdf', upsert: false })
      if (ue) return NextResponse.json({ error: 'Error al subir: ' + ue.message }, { status: 500 })
      publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
    }
  }

  // Resumen con Haiku
  let summary = ''
  try {
    if (buffer.length < 20 * 1024 * 1024) {
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } } as any,
          { type: 'text', text: 'Resume este documento para la base de conocimiento de Brutal Studios. En español, 80-150 palabras: de qué trata, datos clave (cliente, presupuesto, fechas, entregables) y puntos importantes. Sin preámbulos.' }
        ] }],
      })
      summary = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
    } else {
      summary = 'Documento subido (demasiado grande para resumir automáticamente).'
    }
  } catch {
    summary = 'Documento subido. (No se pudo generar el resumen automático.)'
  }

  return NextResponse.json({ url: publicUrl, name: filename, summary })
}
