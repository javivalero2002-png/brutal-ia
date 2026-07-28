import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { PUSH_ROW } from '@/lib/push'

// Alta de suscripción push del usuario actual
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { subscription } = await request.json()
  if (!subscription?.endpoint) return NextResponse.json({ error: 'Suscripción inválida' }, { status: 400 })

  const admin = await createAdminClient()
  // Upsert por endpoint: elimina duplicados previos de este endpoint
  await admin.from('reglas').delete().eq('name', PUSH_ROW).eq('description', subscription.endpoint)
  const { error } = await admin.from('reglas').insert({
    name: PUSH_ROW,
    description: subscription.endpoint,
    condition_text: JSON.stringify(subscription),
    action_text: 'push',
    active: true,
    created_by: user.id,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// Baja de la suscripción de este dispositivo
export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let endpoint: string | undefined
  try {
    const body = await request.json()
    endpoint = body.endpoint
  } catch { /* endpoint remains undefined — deletes all subscriptions for this user */ }
  const admin = await createAdminClient()
  const q = admin.from('reglas').delete().eq('name', PUSH_ROW).eq('created_by', user.id)
  const { error } = endpoint ? await q.eq('description', endpoint) : await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
