import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { PUSH_ROW } from '@/lib/push'

// Alta de suscripción push del usuario actual
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { subscription, userAgent } = await request.json()
  if (!subscription?.endpoint) return NextResponse.json({ error: 'Suscripción inválida' }, { status: 400 })

  const admin = await createAdminClient()

  // Dedup POR DISPOSITIVO (no por usuario): un usuario puede tener varios dispositivos
  // (móvil + portátil) y cada uno debe recibir notificaciones. Pero el MISMO dispositivo
  // no debe acumular varias suscripciones (re-suscripción tras actualizar el SW genera
  // un endpoint nuevo y deja el viejo → notificación duplicada).
  // Eliminamos las filas previas de este usuario cuyo endpoint coincida O cuyo userAgent
  // coincida (mismo dispositivo). Distinto userAgent = distinto dispositivo → se conserva.
  const { data: existing } = await admin
    .from('reglas').select('id,description,condition_text')
    .eq('name', PUSH_ROW).eq('created_by', user.id)

  const toDelete = (existing || []).filter(row => {
    if (row.description === subscription.endpoint) return true
    if (userAgent) {
      try { return JSON.parse(row.condition_text || '{}').ua === userAgent } catch { return false }
    }
    return false
  }).map(r => r.id)

  if (toDelete.length > 0) {
    await admin.from('reglas').delete().in('id', toDelete)
  }

  const { error } = await admin.from('reglas').insert({
    name: PUSH_ROW,
    description: subscription.endpoint,
    // Guardamos el userAgent junto a la suscripción para deduplicar por dispositivo
    condition_text: JSON.stringify({ ...subscription, ua: userAgent || null }),
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
