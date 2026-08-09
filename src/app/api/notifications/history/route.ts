import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Historial de notificaciones del usuario (feed en Operativa → Notificaciones).
// Resiliente: si la tabla notification_log no existe todavía, devuelve lista vacía.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const { data, error } = await admin
    .from('notification_log')
    .select('id,title,body,url,tag,read,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(40)

  if (error) return NextResponse.json({ items: [], unavailable: true })
  return NextResponse.json({ items: data || [] })
}

// Vaciar el historial del usuario
export async function DELETE() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  await admin.from('notification_log').delete().eq('user_id', user.id)
  return NextResponse.json({ ok: true })
}
