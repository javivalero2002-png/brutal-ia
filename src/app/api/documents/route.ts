import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
// Reutilizamos el bucket que ya existe (la creación automática de buckets no funciona en el plan actual)
const BUCKET = 'content-videos'
const MAX_BYTES = 20 * 1024 * 1024 // 20MB en storage

// Sube un PDF a la nube (bucket 'documentos') y devuelve un resumen denso hecho por la IA,
// listo para guardarse como entrada de Memoria y ser leído por Harvey.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No se recibió el archivo' }, { status: 400 })
  if (file.type !== 'application/pdf') return NextResponse.json({ error: 'Solo se admiten PDF' }, { status: 415 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `El PDF supera 20 MB (${(file.size/1024/1024).toFixed(0)} MB).` }, { status: 413 })

  // Asegurar bucket
  const { data: buckets } = await admin.storage.listBuckets()
  if (!buckets?.find(b => b.name === BUCKET)) {
    const { error: be } = await admin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES })
    if (be) return NextResponse.json({ error: 'No se pudo preparar el almacenamiento: ' + be.message }, { status: 500 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const safe = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `docs/${user.id}/${Date.now()}_${safe}`
  const { error: ue } = await admin.storage.from(BUCKET).upload(path, buffer, { contentType: 'application/pdf', upsert: true })
  if (ue) return NextResponse.json({ error: 'Error al subir: ' + ue.message }, { status: 500 })
  const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(path)

  // Resumen denso para Memoria (que Harvey podrá leer)
  let summary = ''
  try {
    // Solo enviamos el PDF a la IA si no es gigante (límite práctico de la API)
    if (buffer.length < 4_200_000) {
      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 900,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } } as any,
          { type: 'text', text: `Resume este documento para la base de conocimiento de Brutal Studios (agencia creativa). En español, denso pero legible (150-250 palabras): de qué trata, datos clave (cliente, presupuesto, fechas, entregables si aparecen) y puntos importantes. Empieza directo, sin "Este documento…".` }
        ] }],
      })
      summary = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
    } else {
      summary = 'Documento subido (demasiado grande para resumir automáticamente).'
    }
  } catch {
    summary = 'Documento subido. (No se pudo generar el resumen automático.)'
  }

  return NextResponse.json({ url: publicUrl, name: file.name, summary })
}
