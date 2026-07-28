import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { sendPushToUser } from '@/lib/push'

// Envía una notificación de prueba a los dispositivos del usuario actual
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const sent = await sendPushToUser(admin, user.id, {
    title: 'BRUTAL.IA — Prueba',
    body: 'Las notificaciones funcionan en este dispositivo ✓',
    url: '/dashboard',
    tag: 'test',
  })
  return NextResponse.json({ ok: true, sent })
}
