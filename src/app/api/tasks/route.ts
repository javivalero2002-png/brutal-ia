import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { sendPushToUser } from '@/lib/push'

// Solo columnas conocidas: campos desconocidos no deben tumbar la petición
// ni permitir escribir columnas arbitrarias (p. ej. created_by).
const pick = (obj: any, keys: string[]) => Object.fromEntries(Object.entries(obj || {}).filter(([k, v]) => keys.includes(k) && v !== undefined))


export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()

  // Todos los miembros del equipo ven todas las tareas — la agencia es pequeña
  // y la visibilidad compartida es esencial para la coordinación diaria.
  const { data, error } = await admin
    .from('tasks')
    .select('*, assignee:profiles!assigned_to(id,name,initials,avatar_color), co_assignee:profiles!co_assigned_to(id,name,initials,avatar_color), client:clients(id,name,initials,color)')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const body = await request.json()

  const { data, error } = await admin
    .from('tasks')
    .insert({ ...pick(body, ['text','level','done','due_date','project_id','client_id','assigned_to','co_assigned_to','source','notes']), created_by: user.id })
    .select('*, assignee:profiles!assigned_to(id,name,initials,avatar_color), co_assignee:profiles!co_assigned_to(id,name,initials,avatar_color), client:clients(id,name,initials,color)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notificación push al asignado (si no es quien la crea)
  if (data?.assigned_to && data.assigned_to !== user.id) {
    const { data: creator } = await admin.from('profiles').select('name').eq('id', user.id).single()
    sendPushToUser(admin, data.assigned_to, {
      title: `Nueva tarea de ${creator?.name || 'el equipo'}`,
      body: data.text?.slice(0, 120) || '',
      url: '/dashboard',
      tag: `task-${data.id}`,
    }).catch(() => {})
  }
  return NextResponse.json(data)
}
