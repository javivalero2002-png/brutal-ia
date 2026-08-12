import { getAuthCtx, canAccessTask } from '@/lib/authz'
import { NextRequest, NextResponse } from 'next/server'

// Dado el id de una subtarea, devuelve el task_id de su tarea padre (o null).
async function parentTaskId(admin: any, subtaskId: string): Promise<string | null> {
  const { data } = await admin.from('task_subtasks').select('task_id').eq('id', subtaskId).single()
  return data?.task_id ?? null
}

// GET /api/tasks/subtasks?taskId=xxx
export async function GET(request: NextRequest) {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const taskId = new URL(request.url).searchParams.get('taskId')
  if (!taskId) return NextResponse.json({ error: 'Missing taskId' }, { status: 400 })
  if (!(await canAccessTask(ctx, taskId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const { data, error } = await ctx.admin
      .from('task_subtasks')
      .select('id, text, done, sort_order')
      .eq('task_id', taskId)
      .order('sort_order', { ascending: true })

    // Antes: `return NextResponse.json([], { status: 200 })` sin registrar nada.
    // supabase-js NO lanza al fallar: devuelve { data: null, error }. Devolver []
    // con un 200 hace que "la consulta revento" y "no hay subtareas" sean
    // indistinguibles, y la UI se queda diciendo "aun no hay nada" para siempre.
    // Es la trampa que motiva src/lib/queryLog.ts, escrita otra vez.
    if (error) {
      console.error('[tasks/subtasks] la consulta fallo:', error.message)
      return NextResponse.json({ error: 'No se pudieron cargar los datos' }, { status: 500 })
    }
    return NextResponse.json(data || [])
  } catch {
    return NextResponse.json([], { status: 200 })
  }
}

// POST /api/tasks/subtasks  { taskId, text }
export async function POST(request: NextRequest) {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { taskId, text } = await request.json()
  if (!taskId || !text?.trim()) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  if (!(await canAccessTask(ctx, taskId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = ctx.admin
  const { data: existing } = await admin
    .from('task_subtasks')
    .select('sort_order')
    .eq('task_id', taskId)
    .order('sort_order', { ascending: false })
    .limit(1)

  const sortOrder = (existing?.[0]?.sort_order ?? -1) + 1

  const { data, error } = await admin
    .from('task_subtasks')
    .insert({ task_id: taskId, text: text.trim().slice(0, 500), done: false, sort_order: sortOrder })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/tasks/subtasks  { id, done?, text? }
export async function PATCH(request: NextRequest) {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, done, text } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const admin = ctx.admin
  const parent = await parentTaskId(admin, id)
  if (!parent || !(await canAccessTask(ctx, parent))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const update: any = {}
  if (typeof done === 'boolean') update.done = done
  if (text !== undefined) update.text = String(text).slice(0, 500)

  const { data, error } = await admin
    .from('task_subtasks')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/tasks/subtasks?id=xxx
export async function DELETE(request: NextRequest) {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const admin = ctx.admin
  const parent = await parentTaskId(admin, id)
  if (!parent || !(await canAccessTask(ctx, parent))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await admin.from('task_subtasks').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
