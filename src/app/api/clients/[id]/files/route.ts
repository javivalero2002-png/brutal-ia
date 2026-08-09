import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

export const maxDuration = 60
const BUCKET = 'content-videos'
const MAX_BYTES = 10 * 1024 * 1024 // 10MB

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = await createAdminClient()
  const { data: files, error } = await admin.storage.from(BUCKET).list(`client-files/${id}`, {
    limit: 200,
    sortBy: { column: 'created_at', order: 'desc' },
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const result = (files || []).map(f => {
    const displayName = f.name.replace(/^\d{13}-/, '')
    const path = `client-files/${id}/${f.name}`
    return {
      name: displayName,
      path,
      size: f.metadata?.size || 0,
      type: f.metadata?.mimetype || '',
      created_at: f.created_at,
      url: admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
    }
  })
  return NextResponse.json(result)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  let formData: FormData
  try { formData = await request.formData() } catch { return NextResponse.json({ error: 'Formulario inválido' }, { status: 400 }) }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Archivo demasiado grande (máx. 10MB)' }, { status: 413 })

  const admin = await createAdminClient()
  await admin.storage.createBucket(BUCKET, { public: true }).then(() => {}, () => {})

  const safeName = file.name.replace(/[^a-zA-Z0-9._\-\s]/g, '_').replace(/\s+/g, '_').slice(0, 120)
  // Sufijo aleatorio: evita colisiones si 6 usuarios suben el mismo archivo al mismo cliente a la vez
  const path = `client-files/${id}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: ue } = await admin.storage.from(BUCKET).upload(path, buffer, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })
  if (ue) return NextResponse.json({ error: ue.message }, { status: 500 })

  const url = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  return NextResponse.json({ name: file.name, path, size: file.size, type: file.type, url })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  const path: string = body.path || ''
  if (!path.startsWith(`client-files/${id}/`)) return NextResponse.json({ error: 'Ruta inválida' }, { status: 400 })

  const admin = await createAdminClient()
  const { error } = await admin.storage.from(BUCKET).remove([path])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
