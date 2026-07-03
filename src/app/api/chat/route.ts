import { createClient, createAdminClient } from '@/lib/supabase/server'
import { chat } from '@/lib/ai'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { message } = await request.json()
  if (!message?.trim()) return NextResponse.json({ error: 'Empty message' }, { status: 400 })

  const admin = await createAdminClient()

  const [{ data: profile }, { data: clients }, { data: projects }, { data: tasks }] = await Promise.all([
    admin.from('profiles').select('name').eq('id', user.id).single(),
    admin.from('clients').select('name'),
    admin.from('projects').select('name,status').eq('status', 'activo'),
    admin.from('tasks').select('text').eq('done', false).eq('level', 'urgent'),
  ])

  // Save user message
  await admin.from('chat_messages').insert({ user_id: user.id, role: 'user', content: message })

  // Get recent history
  const { data: history } = await admin
    .from('chat_messages')
    .select('role, content')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  const reply = await chat(
    message,
    (history || []).reverse().map(h => ({ role: h.role as 'user' | 'ai', content: h.content })),
    {
      userName: profile?.name || 'Usuario',
      clients: (clients || []).map(c => c.name),
      projects: (projects || []).map(p => p.name),
      urgentTasks: (tasks || []).map(t => t.text),
    }
  )

  // Save AI reply
  await admin.from('chat_messages').insert({ user_id: user.id, role: 'ai', content: reply })

  return NextResponse.json({ reply })
}
