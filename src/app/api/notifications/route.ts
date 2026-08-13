import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logQueryErrors } from '@/lib/queryLog'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()

  const consultas = await Promise.all([
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
  const [{ data: msgs }, { data: tasks }] = consultas

  // El Promise.all desestructuraba SOLO `data`. supabase-js no lanza al fallar, asi
  // que un error dejaba data en null y la ruta respondia 200 con total:0 — «no
  // tienes nada» y «no he podido mirar» eran la misma respuesta. El dashboard
  // sondea esto cada 30 segundos, asi que la campana podia estar apagada durante
  // dias sin que nadie lo supiera.
  // logQueryErrors registra LAS DOS consultas: el `errMsgs?.message || errTasks?.message`
  // anterior se comia el mensaje de la segunda cuando fallaban ambas.
  const fallos = logQueryErrors('notifications', consultas)

  return NextResponse.json({
    dmCount: msgs?.length || 0,
    urgentCount: tasks?.length || 0,
    total: (msgs?.length || 0) + (tasks?.length || 0),
    dms: msgs || [],
    urgent: tasks || [],
    // CONTRATO con la UI (el campanario de NexusDashboard): `parcial` va SIEMPRE,
    // true o false. Antes entraba por spread condicional y desaparecia del JSON
    // cuando todo iba bien, asi que un consumidor que lo tipara como boolean
    // recibia `undefined` en el caso normal. Significa «alguna de las dos
    // consultas fallo, los contadores se quedan cortos»: con parcial:true la UI
    // debe avisar de que no se pudo consultar, NO pintar «Sin notificaciones».
    // Va como campo y no como 500 a proposito: media respuesta buena sigue siendo
    // util, y tumbar la campana entera porque falle una de las dos es peor.
    parcial: fallos > 0,
  })
}
