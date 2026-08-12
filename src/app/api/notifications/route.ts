import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()

  const [{ data: msgs }, { data: tasks }] = await Promise.all([
    // Unread internal (DM) messages
    admin.from('inbox_messages')
      .select('id, from_name, subject, received_at')
      .eq('user_id', user.id)
      .eq('source', 'internal')
      .eq('is_read', false)
      .order('received_at', { ascending: false })
      .limit(10),
    // Urgent tasks assigned to me or created by me
    admin.from('tasks')
      .select('id, text, level, due_date')
      .eq('done', false)
      .eq('level', 'urgent')
      // co_assigned_to entra tambien. La UI ya considera tuya una tarea en la que
      // eres co-responsable —Tareas y Hoy la cuentan— pero el campanario no la
      // veia: te asignaban algo urgente como co-responsable y no te enteraba
      // nadie. Las dos vistas del mismo dato decian cosas distintas.
      .or(`assigned_to.eq.${user.id},co_assigned_to.eq.${user.id},created_by.eq.${user.id}`)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  return NextResponse.json({
    dmCount: msgs?.length || 0,
    urgentCount: tasks?.length || 0,
    total: (msgs?.length || 0) + (tasks?.length || 0),
    dms: msgs || [],
    urgent: tasks || [],
  })
}
