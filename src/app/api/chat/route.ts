import { createClient, createAdminClient } from '@/lib/supabase/server'
import { memoriaRelevante, lineasDeMemoria } from '@/lib/memoriaRelevante'
import { chat } from '@/lib/ai'
import { checkChatRateLimit } from '@/lib/rate-limit'
import { logQueryErrors } from '@/lib/queryLog'
import { NextRequest, NextResponse } from 'next/server'
import { madridDateLabel } from '@/components/shared/helpers'

// Chat con contexto completo del estudio + busqueda web: el default de Vercel se queda corto.
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (await checkChatRateLimit(user.id)) {
    return NextResponse.json({ error: 'Demasiadas solicitudes. Espera un momento.' }, { status: 429 })
  }

  const { message } = await request.json()
  if (!message?.trim()) return NextResponse.json({ error: 'Empty message' }, { status: 400 })
  if (message.length > 4000) return NextResponse.json({ error: 'Message too long' }, { status: 400 })

  const admin = await createAdminClient()

  // ANTES del lote, y no dentro, aunque cueste un viaje: el filtro de la consulta
  // de correos depende de esto, y dentro del `Promise.all` no estaría resuelto
  // todavía. Se intentó y salió una consulta SIN filtro de usuario — o sea el
  // correo personal de los siete entrando en el Harvey de cualquiera. Un viaje de
  // más es un precio ridículo por no tener que acordarse de eso nunca.
  const { data: quien, error: errQuien } = await admin
    .from('profiles').select('ver_colabs').eq('id', user.id).maybeSingle()
  if (errQuien) console.error('[chat] no se pudo leer ver_colabs:', errQuien.message)
  // Ante la duda, se enseña: es lo que ya veía ayer.
  const veColabs = quien?.ver_colabs !== false

  const q = await Promise.all([
    admin.from('profiles').select('name').eq('id', user.id).single(),
    admin.from('clients').select('name'),
    admin.from('projects').select('name,status,deadline'),
    admin.from('tasks').select('text,level,assignee:profiles!assigned_to(name)').eq('done', false),
    admin.from('profiles').select('id'),
    // Fetch emails with content so Brutal IA and Harvey know what they're about
    //
    // El buzón compartido entra aquí SOLO si esta persona lo ve en la Bandeja.
    // Es el gemelo del filtro de /api/inbox y hay que arreglar los dos a la vez:
    // ocultarle a alguien el correo del equipo en la pantalla y seguir metiéndoselo
    // a su Harvey no es medio arreglo, es ninguno — Harvey se lo cuenta al
    // preguntarle «¿qué tengo hoy?». Se lee del perfil en la consulta de arriba
    // porque este Promise.all ya lo trae; una consulta más aquí sería gratis de
    // escribir y no de ejecutar.
    (veColabs
      ? admin.from('inbox_messages')
          .select('from_name,subject,ai_summary,ai_urgency,shared,received_at,is_read')
          .or(`user_id.eq.${user.id},shared.eq.true`)
          .order('received_at', { ascending: false }).limit(20)
      : admin.from('inbox_messages')
          .select('from_name,subject,ai_summary,ai_urgency,shared,received_at,is_read')
          .eq('user_id', user.id)
          .order('received_at', { ascending: false }).limit(20)),
    // Fetch history BEFORE saving current message so it doesn't appear twice in the messages array
    admin.from('chat_messages').select('role, content').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20),
    // Tabla `content_agenda` (no `agenda`), y sin filtro de usuario: el pipeline
    // de contenido es del estudio entero, no de quien pregunta.
    admin.from('content_agenda').select('id', { count: 'exact', head: true }).neq('status', 'publicado'),
    // LA MEMORIA. Brutal.IA no la veía y Harvey sí, así que las dos IAs de la misma
    // app respondían con información distinta: si el brief de un cliente o las
    // tarifas estaban en Memoria, una lo sabía y la otra no. Desde fuera parecen la
    // misma cosa, así que eso no se lee como «dos herramientas» — se lee como que
    // la IA a veces se inventa que no sabe.
    //
    // Es para lo que existe la sección: que quede guardado lo que se va haciendo y
    // que la IA pueda tirar de ello.
    admin.from('memoria').select('title, category, content').order('created_at', { ascending: false }).limit(120),
  ])

  // Aquí murió el bug de la tabla `agenda` durante semanas: supabase-js no lanza,
  // devuelve { data:null, error }, y al desestructurar solo `data` el fallo era
  // indistinguible de "no hay filas". Un contexto parcial sigue siendo útil, así
  // que esto registra sin romper la respuesta.
  logQueryErrors('chat', q)

  const [{ data: profile }, { data: clients }, { data: projects }, { data: tasks }, { data: team }, { data: inbox }, { data: history }, { count: contentPipelineCount }, { data: memoria }] = q

  const emailsList = (inbox || []).map((e: any) => ({
    from: e.from_name || '',
    subject: e.subject || '(sin asunto)',
    summary: e.ai_summary || '',
    urgency: e.ai_urgency || 'normal',
    shared: !!e.shared,
    received_at: e.received_at || '',
  }))

  let reply: string
  let searched: boolean | undefined
  try {
    const result = await chat(
      message,
      (history || []).reverse().map(h => ({ role: h.role as 'user' | 'ai', content: h.content })),
      {
        userName: profile?.name || 'Usuario',
        clients: (clients || []).map(c => c.name),
        projects: (projects || []).map(p => ({ name: p.name, status: p.status, deadline: (p as any).deadline })),
        tasks: (tasks || []).map(t => ({ text: t.text, level: t.level, assignee: (t.assignee as any)?.name })),
        unreadInbox: (inbox || []).filter((e: any) => !e.is_read).length,
        emails: emailsList,
        teamSize: team?.length || 1,
        todayDate: madridDateLabel({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        contentPipeline: contentPipelineCount ?? 0,
        // Elegidas con la MISMA función que usa Harvey. Pasarlas todas reventaría el
        // contexto —hay notas largas— y elegirlas con otro criterio aquí sería
        // volver a tener dos IAs que saben cosas distintas.
        memoria: lineasDeMemoria(memoriaRelevante(memoria, message)) || undefined,
      }
    )
    reply = result.reply
    searched = result.searched
  } catch {
    return NextResponse.json({ error: 'Error al procesar el mensaje' }, { status: 502 })
  }

  // Ambos turnos se persisten SOLO si Claude respondió. Antes el turno del usuario
  // se insertaba antes de la llamada: si fallaba, quedaba una fila `user` huérfana,
  // el cliente borraba su copia optimista y el mensaje reaparecía sin respuesta al
  // recargar. Peor: history.slice(-10) podía empezar en un `ai`, y la API de
  // Anthropic exige que el primer mensaje sea `user` → 502 → otra huérfana.
  // Dos inserts secuenciales (no uno con dos filas) para que created_at difiera y
  // el orden de la conversación quede determinado.
  // El error se mira. supabase-js NO lanza: sin recogerlo, un fallo de escritura
  // devolvia la respuesta al usuario igualmente y el historial se quedaba sin ese
  // turno — al recargar, la conversacion aparece con un hueco y nadie sabe por que.
  //
  // SECUENCIALES, no en paralelo. Lo puse con Promise.all al anadir la comprobacion
  // de error y eso rompia justo lo que dice el comentario de aqui arriba: si los dos
  // INSERT salen a la vez, `created_at` puede coincidir al milisegundo y el orden de
  // la conversacion deja de estar determinado — la respuesta puede leerse antes que
  // la pregunta. Anadir una comprobacion no puede cambiar la semantica de al lado.
  const { error: errUser } = await admin
    .from('chat_messages').insert({ user_id: user.id, role: 'user', content: message })
  const { error: errIa } = await admin
    .from('chat_messages').insert({ user_id: user.id, role: 'ai', content: reply })
  if (errUser || errIa) console.error('[chat] no se pudo guardar el turno:', (errUser || errIa)?.message)

  return NextResponse.json({ reply, searched })
}
