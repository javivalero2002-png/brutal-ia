import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

const BUCKET = 'content-videos'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = await createAdminClient()

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  // El plan limita el tamaño de bucket/objeto: rechazar con mensaje claro antes de subir
  const MAX_BYTES = 50 * 1024 * 1024
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `El vídeo supera el límite de 50 MB (${(file.size / 1024 / 1024).toFixed(0)} MB). Súbelo a YouTube/Drive y pega el enlace.` }, { status: 413 })
  }

  // Asegurar bucket (idempotente: si ya existe, ignoramos el error y seguimos)
  await admin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES }).then(()=>{}, ()=>{})

  const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
  const path = `${id}/${Date.now()}.${ext}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, buffer, {
    contentType: file.type || 'video/mp4',
    upsert: true,
  })
  if (uploadError) return NextResponse.json({ error: `No se pudo subir a la nube (${uploadError.message}). Crea el bucket "${BUCKET}" en Supabase → Storage.` }, { status: 500 })

  const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(path)

  // El archivo ya está en la nube. Si falla guardar la columna (migración pendiente), devolvemos la URL igual.
  const { data, error } = await admin
    .from('content_agenda')
    .update({ video_url: publicUrl })
    .eq('id', id)
    .select('*, client:clients(id,name,initials,color)')
    .single()

  if (error) return NextResponse.json({ url: publicUrl, item: null, warning: /video_url|column/i.test(error.message) ? 'Vídeo subido a la nube, pero no persiste: falta la columna video_url (ejecuta migration_content_video.sql en Supabase).' : error.message })
  return NextResponse.json({ url: publicUrl, item: data })
}
