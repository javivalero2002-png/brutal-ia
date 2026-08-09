import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sendPushToUser } from '@/lib/push'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()

  // Own messages + shared company (colabs) messages
  const { data, error } = await admin
    .from('inbox_messages')
    .select('*')
    .or(`user_id.eq.${user.id},shared.eq.true`)
    .order('received_at', { ascending: false })
    .limit(100)

  if (error) {
    // shared column may not exist yet — fall back to own messages only
    const { data: fallback, error: fbErr } = await admin
      .from('inbox_messages')
      .select('*')
      .eq('user_id', user.id)
      .order('received_at', { ascending: false })
      .limit(100)
    if (fbErr) return NextResponse.json({ error: fbErr.message }, { status: 500 })
    return NextResponse.json(fallback)
  }

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

  // Notificación push al destinatario del mensaje interno
  sendPushToUser(admin, to_user_id, {
    title: `Mensaje de ${from_name || 'Equipo'}`,
    body: (subject && subject !== '(sin asunto)' ? subject + ' — ' : '') + body.slice(0, 100),
    url: '/dashboard',
    tag: `dm-${data?.id || ''}`,
  }).catch(() => {})
  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, ids, is_read } = await request.json()
  const admin = await createAdminClient()

  // Modo bulk: marcar varios de una vez ("todo leído") en una sola consulta,
  // en lugar de un PATCH por mensaje desde el cliente.
  if (Array.isArray(ids)) {
    if (ids.length === 0) return NextResponse.json({ ok: true, updated: 0 })
    const { error: bulkErr } = await admin
      .from('inbox_messages')
      .update({ is_read, is_unread: !is_read })
      .in('id', ids.slice(0, 500))
      .or(`user_id.eq.${user.id},shared.eq.true`)
    if (bulkErr) return NextResponse.json({ error: bulkErr.message }, { status: 500 })
    return NextResponse.json({ ok: true, updated: ids.length })
  }

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  // Allow marking own messages OR shared (colabs) messages as read
  const { error } = await admin
    .from('inbox_messages')
    .update({ is_read, is_unread: !is_read })
    .eq('id', id)
    .or(`user_id.eq.${user.id},shared.eq.true`)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
