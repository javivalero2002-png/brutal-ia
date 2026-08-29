import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sinControl } from '@/components/shared/helpers'
import { codigoHttpDeError } from '@/lib/respuestaDb'
import { NextResponse } from 'next/server'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([], { status: 401 })

  const admin = await createAdminClient()
  const { data, error } = await admin
    .from('client_comments')
    .select('*, profile:profiles(name, initials, avatar_color)')
    .eq('client_id', id)
    .order('created_at', { ascending: true })

  if (error) {
    // 42P01 = la tabla aun no existe. Ese caso SI es "no hay comentarios": la
    // seccion funciona igual y no tiene sentido romperla por una tabla opcional.
    if (error.code === '42P01') return NextResponse.json([])
    // Cualquier otro error si es un fallo. Antes las dos ramas devolvian [] —el
    // comentario decia distinguir el 42P01 y luego no distinguia nada— asi que un
    // fallo real se veia igual que "todavia no hay comentarios", para siempre y
    // sin dejar rastro.
    console.error('[clients/comments] la consulta fallo:', error.message)
    return NextResponse.json({ error: 'No se pudieron cargar los comentarios' }, { status: 500 })
  }
  return NextResponse.json(data || [])
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: string
  try {
    const parsed = await req.json()
    body = parsed.body || ''
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (!body.trim()) return NextResponse.json({ error: 'Empty' }, { status: 400 })
  if (body.length > 2000) return NextResponse.json({ error: 'Comment too long' }, { status: 400 })

  const admin = await createAdminClient()
  const { data, error } = await admin
    .from('client_comments')
    .insert({ client_id: id, profile_id: user.id, body: sinControl(body.trim()) })
    .select('*, profile:profiles(name, initials, avatar_color)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: codigoHttpDeError(error) })
  return NextResponse.json(data)
}
