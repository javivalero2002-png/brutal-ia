import { createClient, createAdminClient } from '@/lib/supabase/server'
import { borrarFicherosDeAdjuntos } from '@/lib/taskAttachments'
import { NextRequest, NextResponse } from 'next/server'
import { sendPushToUser } from '@/lib/push'

// El POST espera al push del asignado antes de responder (ver abajo), así que la
// respuesta se lleva por delante la consulta a `reglas` y las llamadas a FCM/APNs.
// Igual que inbox, harvey/chat y gmail/sync, que ya lo declaran por lo mismo.
export const maxDuration = 60

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

  const fields: any = { ...pick(body, ['text','level','done','due_date','project_id','client_id','assigned_to','co_assigned_to','source','notes','diario_dia','diario_objetivo']), created_by: user.id }
  // `diario_dia` lo escribe el CLIENTE, así que se valida la forma antes de que
  // llegue a una columna por la que luego se filtra. Cualquier cosa que no sea
  // una clave de día se descarta entera, con su objetivo: las dos van juntas o
  // ninguna, o quedaría un vínculo a medias que no empareja nada.
  if (fields.diario_dia !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(fields.diario_dia))) {
    delete fields.diario_dia
    delete fields.diario_objetivo
  }
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

  // Notificación push al asignado (si no es quien la crea).
  //
  // CON await, igual que en inbox, colabsSync y /api/gmail/sync y por lo mismo:
  // iba suelto con `.catch(()=>{})` y el `return` en la línea siguiente, o sea
  // cero awaits entre lanzar y responder. A sendPushToUser le quedaban por delante
  // la consulta a `reglas`, el insert en notification_log y las llamadas HTTP a
  // FCM/APNs, y en serverless la instancia se congela al devolver: la tarea salía
  // asignada y el aviso se perdía sin dejar rastro.
  //
  // La tarea ya está insertada, así que un fallo del push se registra pero no
  // tumba la respuesta. El fichero declara maxDuration = 60 (arriba).
  if (data?.assigned_to && data.assigned_to !== user.id) {
    const { data: creator } = await admin.from('profiles').select('name').eq('id', user.id).single()
    try {
      await sendPushToUser(admin, data.assigned_to, {
        title: `Nueva tarea de ${creator?.name || 'el equipo'}`,
        body: data.text?.slice(0, 120) || '',
        url: '/dashboard',
        tag: `task-${data.id}`,
      })
    } catch (err) {
      console.error('[tasks] el push de tarea asignada falló:', err)
    }
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

  // Las URLs de los adjuntos se leen AHORA: la cascada de la BD se lleva las filas
  // en el mismo DELETE y después ya no hay forma de saber qué ficheros quedaron
  // huérfanos en el bucket. Mismo caso que el borrado de una tarea suelta.
  const { data: adjuntos, error: adjErr } = await admin
    .from('task_attachments').select('task_id,url').in('task_id', limpios)
  if (adjErr) console.error('[tasks] no se pudieron leer los adjuntos del borrado en lote:', adjErr.message)

  let q = admin.from('tasks').delete({ count: 'exact' }).in('id', limpios)
  // Owner borra cualquiera; el resto solo las suyas.
  if (profile?.role !== 'owner') q = q.eq('created_by', user.id)

  // `.select('id')` para saber cuáles cayeron DE VERDAD: la autorización va como
  // filtro del propio DELETE, así que de `limpios` pueden sobrevivir unas cuantas
  // y borrar sus ficheros dejaría filas de adjunto apuntando a un objeto que ya no
  // existe — el estropicio simétrico al que arregla este bloque.
  const { data: filasBorradas, error, count } = await q.select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const idsBorrados = new Set((filasBorradas || []).map((t: any) => t.id))
  await borrarFicherosDeAdjuntos(admin, (adjuntos || []).filter((a: any) => idsBorrados.has(a.task_id)).map((a: any) => a.url))

  return NextResponse.json({ ok: true, borradas: count ?? idsBorrados.size })
}
