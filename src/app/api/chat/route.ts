import { createClient, createAdminClient } from '@/lib/supabase/server'
import { chat } from '@/lib/ai'
import { checkChatRateLimit } from '@/lib/rate-limit'
import { NextRequest, NextResponse } from 'next/server'

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

  const [{ data: profile }, { data: clients }, { data: projects }, { data: tasks }, { data: team }, { data: inbox }, { data: history }, { count: contentPipelineCount }] = await Promise.all([
    admin.from('profiles').select('name').eq('id', user.id).single(),
    admin.from('clients').select('name'),
    admin.from('projects').select('name,status,deadline'),
    admin.from('tasks').select('text,level,assignee:profiles!assigned_to(name)').eq('done', false),
    admin.from('profiles').select('id'),
    // Fetch emails with content so Brutal IA and Harvey know what they're about
    admin.from('inbox_messages')
      .select('from_name,subject,ai_summary,ai_urgency,shared,received_at,is_read')
      .or(`user_id.eq.${user.id},shared.eq.true`)
      .order('received_at', { ascending: false })
      .limit(20),
    // Fetch history BEFORE saving current message so it doesn't appear twice in the messages array
    admin.from('chat_messages').select('role, content').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20),
    // Tabla `content_agenda` (no `agenda`), y sin filtro de usuario: el pipeline
    // de contenido es del estudio entero, no de quien pregunta.
    admin.from('content_agenda').select('id', { count: 'exact', head: true }).neq('status', 'publicado'),
  ])

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
        todayDate: new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        contentPipeline: contentPipelineCount ?? 0,
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
  await admin.from('chat_messages').insert({ user_id: user.id, role: 'user', content: message })
  await admin.from('chat_messages').insert({ user_id: user.id, role: 'ai', content: reply })

  return NextResponse.json({ reply, searched })
}
