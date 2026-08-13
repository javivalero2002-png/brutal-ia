import { createClient, createAdminClient } from '@/lib/supabase/server'
import { firmarUrl, firmarCampos } from '@/lib/storageFirmado'
import { NextRequest, NextResponse } from 'next/server'

// Reutilizamos el bucket que ya existe (la creación automática de buckets no funciona en el plan actual)
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

  const MAX_BYTES = 10 * 1024 * 1024
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `La imagen supera el límite de 10 MB (${(file.size / 1024 / 1024).toFixed(0)} MB).` }, { status: 413 })
  }

  // Asegurar bucket (idempotente: si ya existe, ignoramos el error y seguimos)
  // public:false — si el bucket se borrara, recrearlo ABIERTO devolveria los
  // contratos y presupuestos a la intemperie. Ver src/lib/storageFirmado.ts.
  await admin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_BYTES }).then(()=>{}, ()=>{})

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = `covers/${id}/${Date.now()}.${ext}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, buffer, {
    contentType: file.type || 'image/jpeg',
    upsert: true,
  })
  if (uploadError) return NextResponse.json({ error: `No se pudo subir a la nube (${uploadError.message}). Crea el bucket "${BUCKET}" en Supabase → Storage.` }, { status: 500 })

  const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(path)

  // El archivo ya está en la nube. Si falla guardar la columna (migración pendiente), devolvemos la URL igual (se ve, aunque no persista al recargar).
  const { data, error } = await admin
    .from('content_agenda')
    .update({ cover_url: publicUrl })
    .eq('id', id)
    .select('*, client:clients(id,name,initials,color)')
    .single()

  // Se GUARDA la forma publica (es el identificador) pero se DEVUELVE firmada:
  // con el bucket cerrado, la publica ya no pinta nada.
  const urlParaVer = await firmarUrl(admin, publicUrl)
  if (error) return NextResponse.json({ url: urlParaVer, item: null, warning: /cover_url|column/i.test(error.message) ? 'Imagen subida a la nube, pero no persiste: falta la columna cover_url (ejecuta migration_content_cover.sql en Supabase).' : error.message })
  return NextResponse.json({ url: urlParaVer, item: await firmarCampos(admin, data, ['cover_url','video_url']) })
}
