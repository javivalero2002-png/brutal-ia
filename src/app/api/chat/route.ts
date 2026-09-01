import { createClient, createAdminClient } from '@/lib/supabase/server'
import { memoriaRelevante, lineasDeMemoria } from '@/lib/memoriaRelevante'
import { leerFicha } from '@/lib/fichaEstudio'
import { chat } from '@/lib/ai'
import { checkChatRateLimit } from '@/lib/rate-limit'
import { resumenDelEquipo, miJornadaHoy } from '@/lib/resumenEquipo'
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

  const body = await request.json()
  const { message } = body
  if (!message?.trim()) return NextResponse.json({ error: 'Empty message' }, { status: 400 })
  if (message.length > 4000) return NextResponse.json({ error: 'Message too long' }, { status: 400 })

  // LA AGENDA LLEGA DEL CLIENTE, que ya la tiene cargada — pedirla aquí serían
  // segundos de Google en cada mensaje. Pero llegar del cliente no la hace de
  // fiar: se valida la forma, se acota y el texto se limpia de caracteres de
  // control (que además rompen la API de Anthropic). Nada de esto se guarda.
  // `undefined` si el cliente NO manda el campo, `[]` si lo manda vacío. La
  // diferencia importa: sin ella el prompt no puede distinguir «no tienes nada» de
  // «no he podido leer la agenda», y el modelo llegaba a la peor conclusión de las
  // tres — decir que no tiene acceso al calendario.
  const eventos = !Array.isArray(body?.eventos) ? undefined : (body.eventos as unknown[])
    .slice(0, 60)
    .filter((e: any) => e && typeof e.title === 'string' && typeof e.start === 'string')
    .map((e: any) => ({
      title: e.title.replace(/[\x00-\x1F\x7F]/g, ' ').slice(0, 120).trim(),
      start: /^\d{4}-\d{2}-\d{2}/.test(e.start) ? e.start.slice(0, 25) : '',
      cuenta: typeof e.cuenta === 'string' ? e.cuenta.slice(0, 80) : undefined,
    }))
    .filter((e: any) => e.title && e.start)


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
    // CON EL ESTADO. Salían solo los nombres, así que un POTENCIAL —alguien con
    // quien no hay nada cerrado— llegaba a Brutal.IA en la misma lista que Panrico
    // y contestaba «tu cliente X». Lo mismo que ya se arregló en el contexto de
    // Harvey: son la misma IA para quien la usa.
    admin.from('clients').select('name,status'),
    admin.from('projects').select('name,status,deadline'),
    admin.from('tasks').select('text,level,assignee:profiles!assigned_to(name)').eq('done', false),
    // `id, name`: se pedía solo `id` para contar. El prompt decía «Equipo: 7
    // personas» y ya está, así que Brutal.IA no podía contestar quién puede
    // encargarse de algo ni reconocer un nombre que le dijeras — y Harvey, con los
    // mismos datos delante, sí.
    admin.from('profiles').select('id, name'),
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
          .select('from_name,subject,ai_summary,ai_urgency,ai_client,shared,received_at,is_read')
          .or(`user_id.eq.${user.id},shared.eq.true`)
          .order('received_at', { ascending: false }).limit(20)
      : admin.from('inbox_messages')
          .select('from_name,subject,ai_summary,ai_urgency,ai_client,shared,received_at,is_read')
          .eq('user_id', user.id)
          .order('received_at', { ascending: false }).limit(20)),
    // Fetch history BEFORE saving current message so it doesn't appear twice in the messages array
    admin.from('chat_messages').select('role, content').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20),
    // Tabla `content_agenda` (no `agenda`), y sin filtro de usuario: el pipeline
    // de contenido es del estudio entero, no de quien pregunta.
    // Con TÍTULO, no un `head: true`. El recuento exacto se conserva (`count`)
    // porque es lo que se dice en la primera línea; lo que faltaba era de qué van
    // las piezas: «3 piezas programadas» solo contesta cuántas hay.
    admin.from('content_agenda').select('id,title,platform,status,publish_date', { count: 'exact' })
      .neq('status', 'publicado').order('publish_date', { ascending: true, nullsFirst: false }).limit(10),
    // LA MEMORIA. Brutal.IA no la veía y Harvey sí, así que las dos IAs de la misma
    // app respondían con información distinta: si el brief de un cliente o las
    // tarifas estaban en Memoria, una lo sabía y la otra no. Desde fuera parecen la
    // misma cosa, así que eso no se lee como «dos herramientas» — se lee como que
    // la IA a veces se inventa que no sabe.
    //
    // Es para lo que existe la sección: que quede guardado lo que se va haciendo y
    // que la IA pueda tirar de ello.
    // DOS CONSULTAS, no un `.limit(120)` a secas.
    //
    // Ese limite reintroducia, un nivel mas abajo, el mismo bug que
    // `memoriaRelevante` existe para evitar: cada PDF subido entra como una nota,
    // asi que al pasar de 120 filas las decisiones CURADAS —las que alguien
    // escribio a mano— caian fuera ANTES de que la funcion pudiera salvarlas.
    // Recortar por fecha es exactamente lo que no hay que hacer aqui.
    //
    // Lo curado es poco y no caduca: se trae entero. Los documentos son muchos y
    // se acotan, que es donde el techo si tiene sentido.
    admin.from('memoria').select('title, category, content').not('category', 'ilike', 'documento').order('created_at', { ascending: false }).limit(200),
    admin.from('memoria').select('title, category, content').ilike('category', 'documento').order('created_at', { ascending: false }).limit(150),
  ])

  // Aquí murió el bug de la tabla `agenda` durante semanas: supabase-js no lanza,
  // devuelve { data:null, error }, y al desestructurar solo `data` el fallo era
  // indistinguible de "no hay filas". Un contexto parcial sigue siendo útil, así
  // que esto registra sin romper la respuesta.
  logQueryErrors('chat', q)

  const [{ data: profile }, { data: clients }, { data: projects }, { data: tasks }, { data: team }, { data: inbox }, { data: history }, { data: contenido, count: contentPipelineCount }, { data: curadas }, { data: documentos }] = q

  const emailsList = (inbox || []).map((e: any) => ({
    from: e.from_name || '',
    subject: e.subject || '(sin asunto)',
    summary: e.ai_summary || '',
    urgency: e.ai_urgency || 'normal',
    shared: !!e.shared,
    // El cliente y el «leído» viajan para poder ORDENAR por importancia: sin
    // ellos el tope de quince se gasta con boletines.
    client: e.ai_client || undefined,
    is_read: !!e.is_read,
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
        clients: (clients || []).filter((c: any) => c.status !== 'Archivado')
          .map((c: any) => (c.status === 'Potencial' ? `${c.name} (POTENCIAL: todavía no es cliente)` : c.name)),
        projects: (projects || []).map(p => ({ name: p.name, status: p.status, deadline: (p as any).deadline })),
        tasks: (tasks || []).map(t => ({ text: t.text, level: t.level, assignee: (t.assignee as any)?.name })),
        unreadInbox: (inbox || []).filter((e: any) => !e.is_read).length,
        emails: emailsList,
        teamSize: team?.length || 1,
        team: (team || []).map((m: any) => m.name).filter(Boolean),
        todayDate: madridDateLabel({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        contentPipeline: contentPipelineCount ?? 0,
        contenido: (contenido || []).map((c: any) => ({
          title: c.title, platform: c.platform, status: c.status, publish_date: c.publish_date,
        })).filter((c: any) => c.title),
        eventos,
        // El diario del equipo, con el MISMO módulo que Harvey. Se decide dentro
        // si la pregunta lo pide: la mayoría no, y son cientos de tokens.
        diarioEquipo: (await miJornadaHoy(admin, user.id))
          + (await resumenDelEquipo(admin, (team || []) as any, message) || ''),
        // Elegidas con la MISMA función que usa Harvey. Pasarlas todas reventaría el
        // contexto —hay notas largas— y elegirlas con otro criterio aquí sería
        // volver a tener dos IAs que saben cosas distintas.
        memoria: lineasDeMemoria(memoriaRelevante([...(curadas || []), ...(documentos || [])], message)) || undefined,
        // LA FICHA, siempre. `memoriaRelevante` elige lo que casa con la pregunta;
        // esto es lo que la IA debe saber aunque la pregunta no case con nada.
        // Va desde el SERVIDOR para que no dependa de que el cliente la mande.
        ficha: await leerFicha(admin) || undefined,
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
