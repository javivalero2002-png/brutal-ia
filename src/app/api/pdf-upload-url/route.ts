import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'

const BUCKET = 'content-videos'
const MAX_MB = 50

// Devuelve una signed upload URL para que el cliente suba el PDF directamente
// a Supabase sin pasar por el límite de body de Next.js/Vercel.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { filename, size, prefix = 'pdfs' } = await request.json().catch(() => ({}))
  if (!filename) return NextResponse.json({ error: 'Falta el nombre del archivo' }, { status: 400 })
  // El tamaño es obligatorio: sin él no se puede validar el límite antes de subir.
  if (typeof size !== 'number' || size <= 0) {
    return NextResponse.json({ error: 'Falta el tamaño del archivo' }, { status: 400 })
  }
  if (size > MAX_MB * 1024 * 1024) {
    return NextResponse.json({ error: `El PDF supera ${MAX_MB} MB` }, { status: 413 })
  }

  const admin = await createAdminClient()
  await admin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_MB * 1024 * 1024 }).then(() => {}, () => {})

  // Path deterministico por nombre+tamaño para reutilizar si ya existe
  const slug = createHash('md5').update(`${filename}-${size || 0}-${user.id}`).digest('hex').slice(0, 16)
  const ext  = filename.endsWith('.pdf') ? '' : '.pdf'
  const path = `${prefix}/${slug}${ext}`

  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true })
  if (error || !data) return NextResponse.json({ error: 'No se pudo generar la URL de subida' }, { status: 500 })

  const publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl

  return NextResponse.json({ signedUrl: data.signedUrl, token: data.token, path, publicUrl })
}
