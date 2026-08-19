import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sendPushToUser } from '@/lib/push'
import { borrarFicherosDeAdjuntos } from '@/lib/taskAttachments'
import { getAuthCtx, canAccessTask } from '@/lib/authz'
import { NextRequest, NextResponse } from 'next/server'

// El push de reasignación se ESPERA (ver abajo), así que la ruta declara su tope:
// sin él, un cuelgue de FCM/APNs no se distingue de un fallo y no hay mensaje.
export const maxDuration = 60

// Solo columnas conocidas: campos desconocidos no deben tumbar la petición
// ni permitir escribir columnas arbitrarias (p. ej. created_by).
const pick = (obj: any, keys: string[]) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => keys.includes(k)))

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  // Solo se puede editar una tarea visible para el usuario (misma regla que el GET)
  if (!(await canAccessTask(ctx, id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const admin = ctx.admin

  // Quién la tenía ANTES. Sin esto no se puede distinguir «te acaban de asignar
  // esto» de «alguien ha retocado las notas de una tarea que ya era tuya», y
  // avisar de lo segundo enseña a ignorar los avisos.
  const { data: antes } = await admin
    .from('tasks').select('assigned_to,co_assigned_to,text').eq('id', id).single()
  const fields = pick(body, ['text','level','done','due_date','project_id','client_id','assigned_to','co_assigned_to','notes'])
  // Sella el momento de completado (y lo limpia al reabrir) para que los
  // reportes de tendencia sean reales y no dependan de updated_at.
  if (typeof (fields as any).done === 'boolean') {
    (fields as any).completed_at = (fields as any).done ? new Date().toISOString() : null
  }
  const SELECT = '*, assignee:profiles!assigned_to(id,name,initials,avatar_color), co_assignee:profiles!co_assigned_to(id,name,initials,avatar_color), client:clients(id,name,initials,color)'
  const stamp = { updated_at: new Date().toISOString() }

  let { data, error } = await admin
    .from('tasks').update({ ...fields, ...stamp }).eq('id', id).select(SELECT).single()

  // Si la columna completed_at aún no existe (migración pendiente), reintenta sin ella.
  if (error && /completed_at/i.test(error.message || '')) {
    const { completed_at: _omit, ...rest } = fields as any
    ;({ data, error } = await admin
      .from('tasks').update({ ...rest, ...stamp }).eq('id', id).select(SELECT).single())
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Aviso a quien ACABA de entrar en la tarea.
  //
  // Antes solo avisaba el POST, o sea solo al crearla y solo al responsable. Pero
  // repartir trabajo en un estudio es crear la tarea suelta y asignarla después —y
  // el selector «ASIGNAR A» guarda por aquí—, así que el camino normal era el
  // mudo. El co-responsable no se enteraba nunca, ni al crear ni al reasignar.
  // `/api/notifications` ya contemplaba a los dos; este era el gemelo que faltaba.
  //
  // Con await y no suelto: en serverless la instancia se congela al devolver, y a
  // `sendPushToUser` le quedan por delante la consulta a `reglas`, el insert en
  // `notification_log` y las llamadas HTTP. La tarea ya está guardada, así que un
  // fallo del push se registra y no tumba la respuesta.
  const yaEstaban = [antes?.assigned_to, antes?.co_assigned_to]
  const reciennllegados = [data?.assigned_to, data?.co_assigned_to]
    .filter((p): p is string => !!p && p !== ctx.userId && !yaEstaban.includes(p))
  if (reciennllegados.length) {
    const { data: quien } = await admin.from('profiles').select('name').eq('id', ctx.userId).single()
    for (const destino of reciennllegados) {
      try {
        await sendPushToUser(admin, destino, {
          title: `${quien?.name || 'Alguien'} te ha asignado una tarea`,
          body: (data?.text || antes?.text || '').slice(0, 120),
          url: '/dashboard',
          tag: `task-${id}`,
        })
      } catch (err) {
        console.error('[tasks] el push de reasignación falló:', err)
      }
    }
  }
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const { id } = await params

  // Owners can delete any task; members only their own
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  const { data: task } = await admin.from('tasks').select('created_by').eq('id', id).single()

  if (profile?.role !== 'owner' && task?.created_by !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Los ficheros del Storage NO se van con la cascada de la base. `task_attachments`
  // es ON DELETE CASCADE (migrations/20260809_task_attachments.sql:8), así que al
  // borrar la tarea las filas desaparecen y con ellas la única referencia al objeto:
  // se queda en `content-videos` —bucket PÚBLICO, con contratos, presupuestos y
  // briefs— huérfano y ya imposible de encontrar desde la app. El borrado de un
  // adjunto suelto sí lo hace, y a propósito (attachments/route.ts).
  //
  // Se leen ANTES del delete porque después las filas ya no existen. Todo el bloque
  // es best-effort: si el Storage falla se registra, pero la tarea se borra igual —
  // lo contrario dejaría una tarea imposible de borrar por culpa de un adjunto.
  const { data: adjuntos, error: adjErr } = await admin
    .from('task_attachments').select('url').eq('task_id', id)
  if (adjErr) console.error('[tasks] no se pudieron leer los adjuntos antes de borrar la tarea', id, '—', adjErr.message)

  const { error } = await admin.from('tasks').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await borrarFicherosDeAdjuntos(admin, (adjuntos || []).map((a: any) => a.url))
  return NextResponse.json({ ok: true })
}
