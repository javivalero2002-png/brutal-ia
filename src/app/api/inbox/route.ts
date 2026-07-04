import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()

  // Return own messages + shared company messages (colaboraciones@)
  const { data, error } = await admin
    .from('inbox_messages')
    .select('*')
    .or(`user_id.eq.${user.id},shared.eq.true`)
    .order('received_at', { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { to_user_id, subject, body, from_name } = await request.json()
  if (!to_user_id || !body?.trim()) return NextResponse.json({ error: 'Faltan campos' }, { status: 400 })

  const admin = await createAdminClient()
  const { data, error } = await admin.from('inbox_messages').insert({
    user_id: to_user_id,
    source: 'internal',
    from_name: from_name || 'Equipo',
    subject: subject || '(sin asunto)',
    body_preview: body.slice(0, 500),
    ai_urgency: 'normal',
    is_read: false,
    is_unread: true,
    received_at: new Date().toISOString(),
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, is_read } = await request.json()
  const admin = await createAdminClient()
  const { error } = await admin
    .from('inbox_messages')
    .update({ is_read, is_unread: !is_read })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
