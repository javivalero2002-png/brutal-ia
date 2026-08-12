import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = await createAdminClient()

  try {
    const { data, error } = await admin
      .from('project_milestones')
      .select('id, name, due_date, done, sort_order')
      .eq('project_id', id)
      .order('sort_order', { ascending: true })

    // Antes: `return NextResponse.json([], { status: 200 })` sin registrar nada.
    // supabase-js NO lanza al fallar: devuelve { data: null, error }. Devolver []
    // con un 200 hace que "la consulta revento" y "no hay hitos" sean
    // indistinguibles, y la UI se queda diciendo "aun no hay nada" para siempre.
    // Es la trampa que motiva src/lib/queryLog.ts, escrita otra vez.
    if (error) {
      console.error('[projects/milestones] la consulta fallo:', error.message)
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
  const { name, due_date } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Empty name' }, { status: 400 })

  const admin = await createAdminClient()

  // Get max sort_order
  const { data: existing } = await admin
    .from('project_milestones')
    .select('sort_order')
    .eq('project_id', id)
    .order('sort_order', { ascending: false })
    .limit(1)

  const sortOrder = (existing?.[0]?.sort_order ?? -1) + 1

  const { data, error } = await admin
    .from('project_milestones')
    .insert({ project_id: id, name: name.trim(), due_date: due_date || null, done: false, sort_order: sortOrder })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const { milestoneId, done, name, due_date } = await request.json()
  if (!milestoneId) return NextResponse.json({ error: 'Missing milestoneId' }, { status: 400 })

  const admin = await createAdminClient()
  const update: any = {}
  if (typeof done === 'boolean') update.done = done
  if (name !== undefined) update.name = name
  if (due_date !== undefined) update.due_date = due_date || null

  const { data, error } = await admin
    .from('project_milestones')
    .update(update)
    .eq('id', milestoneId)
    .eq('project_id', projectId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const { searchParams } = new URL(request.url)
  const milestoneId = searchParams.get('milestoneId')
  if (!milestoneId) return NextResponse.json({ error: 'Missing milestoneId' }, { status: 400 })

  const admin = await createAdminClient()
  const { error } = await admin
    .from('project_milestones')
    .delete()
    .eq('id', milestoneId)
    .eq('project_id', projectId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
