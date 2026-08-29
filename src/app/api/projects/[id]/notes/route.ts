import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sinControl } from '@/components/shared/helpers'
import { codigoHttpDeError } from '@/lib/respuestaDb'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = await createAdminClient()

  try {
    const { data, error } = await admin
      .from('project_notes')
      .select('id, content, user_name, created_at')
      .eq('project_id', id)
      .order('created_at', { ascending: false })

    // Antes: `return NextResponse.json([], { status: 200 })` sin registrar nada.
    // supabase-js NO lanza al fallar: devuelve { data: null, error }. Devolver []
    // con un 200 hace que "la consulta revento" y "no hay notas" sean
    // indistinguibles, y la UI se queda diciendo "aun no hay nada" para siempre.
    // Es la trampa que motiva src/lib/queryLog.ts, escrita otra vez.
    if (error) {
      console.error('[projects/notes] la consulta fallo:', error.message)
      return NextResponse.json({ error: 'No se pudieron cargar los datos' }, { status: 500 })
    }
    return NextResponse.json(data || [])
  } catch {
    return NextResponse.json([], { status: 200 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { content } = await request.json()
  if (!content?.trim()) return NextResponse.json({ error: 'Empty content' }, { status: 400 })

  const admin = await createAdminClient()
  const { data: profile } = await admin.from('profiles').select('name').eq('id', user.id).single()

  const { data, error } = await admin
    .from('project_notes')
    // sinControl: content?.trim() no quita el byte nulo (no es whitespace) y
    // tumbaba el insert con un 500 al pegar de un PDF.
    .insert({ project_id: id, user_id: user.id, user_name: profile?.name || 'Usuario', content: sinControl(content.trim()) })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: codigoHttpDeError(error) })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const { searchParams } = new URL(request.url)
  const noteId = searchParams.get('noteId')
  if (!noteId) return NextResponse.json({ error: 'Missing noteId' }, { status: 400 })

  const admin = await createAdminClient()
  const { error } = await admin
    .from('project_notes')
    .delete()
    .eq('id', noteId)
    .eq('project_id', projectId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
