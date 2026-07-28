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

  // Ensure bucket exists (si falla la creación, lo reportamos en vez de dar "Bucket not found")
  const { data: buckets } = await admin.storage.listBuckets()
  if (!buckets?.find(b => b.name === BUCKET)) {
    const { error: bucketError } = await admin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES })
    if (bucketError) return NextResponse.json({ error: 'No se pudo preparar el almacenamiento de vídeos: ' + bucketError.message }, { status: 500 })
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
  const path = `${id}/${Date.now()}.${ext}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, buffer, {
    contentType: file.type || 'video/mp4',
    upsert: true,
  })
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

  const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(path)

  const { data, error } = await admin
    .from('content_agenda')
    .update({ video_url: publicUrl })
    .eq('id', id)
    .select('*, client:clients(id,name,initials,color)')
    .single()

  if (error && /video_url/.test(error.message)) {
    return NextResponse.json({ error: 'Falta ejecutar la migración de vídeo (supabase/migration_content_video.sql) en el SQL Editor de Supabase.' }, { status: 500 })
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ url: publicUrl, item: data })
}
