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

  // Todos los miembros del equipo ven todas las tareas — la agencia es pequeña
  // y la visibilidad compartida es esencial para la coordinación diaria.
  // (El rol ya no se consulta aquí: se leía y no se usaba desde que se quitó el
  // filtrado por rol, así que era un viaje a la BD en cada carga de tareas.)
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

  const fields: any = { ...pick(body, ['text','level','done','due_date','project_id','client_id','assigned_to','co_assigned_to','source','notes']), created_by: user.id }
  // Crear una tarea ya marcada como hecha debe sellar completed_at igual que lo
  // hace el PATCH; si no, la tarea nunca aparece en los reportes de tendencia.
  if (fields.done === true) fields.completed_at = new Date().toISOString()

  const SELECT = '*, assignee:profiles!assigned_to(id,name,initials,avatar_color), co_assignee:profiles!co_assigned_to(id,name,initials,avatar_color), client:clients(id,name,initials,color)'

  let { data, error } = await admin.from('tasks').insert(fields).select(SELECT).single()

  // Mismo fallback que el PATCH: si la columna completed_at aún no existe, reintenta sin ella.
  if (error && /completed_at/i.test(error.message || '')) {
    const { completed_at: _omit, ...rest } = fields
    ;({ data, error } = await admin.from('tasks').insert(rest).select(SELECT).single())
  }

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

// Borrado en LOTE. Antes "LIMPIAR COMPLETADAS" hacia
// Promise.all(filtered.map(t => deleteTask(t.id))): una invocacion de Vercel por
// tarea, y cada una repitiendo la comprobacion de sesion, la lectura del rol y la
// del propietario. Con veinte tareas completadas eran veinte funciones y ~80
// viajes a la base de datos para un solo clic.
//
// El criterio de autorizacion es EL MISMO que el del borrado individual, y va
// escrito como filtro de la propia sentencia en vez de comprobarse antes: asi no
// hay ventana entre mirar y borrar, y las que no te tocan simplemente no entran
// en el DELETE en lugar de tumbar la operacion entera.
export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const ids: unknown = body?.ids
  if (!Array.isArray(ids)) return NextResponse.json({ error: 'Falta la lista de ids' }, { status: 400 })
  const limpios = ids.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(0, 500)
  if (limpios.length === 0) return NextResponse.json({ ok: true, borradas: 0 })

  const admin = await createAdminClient()
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()

  let q = admin.from('tasks').delete({ count: 'exact' }).in('id', limpios)
  // Owner borra cualquiera; el resto solo las suyas.
  if (profile?.role !== 'owner') q = q.eq('created_by', user.id)

  const { error, count } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, borradas: count ?? 0 })
}
