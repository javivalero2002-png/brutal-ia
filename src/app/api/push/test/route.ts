import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { sendPushToUser } from '@/lib/push'

// Espera al envío antes de responder (es el sentido de la ruta: decirte si ha
// salido), así que la respuesta se lleva por delante la consulta a `reglas`, el
// insert en notification_log y las llamadas a FCM/APNs. Igual que inbox, tasks y
// gmail/sync, que ya lo declaran por lo mismo.
export const maxDuration = 60

// Envía una notificación de prueba a los dispositivos del usuario actual
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  // sendPushToUser lanza si no puede leer las suscripciones. Sin capturarlo, esta
  // ruta —cuya única razón de ser es decirte si las notificaciones funcionan—
  // devolvía un 500 pelado sin explicación. Y `sent: 0` con ok:true tampoco vale:
  // era el bug del hallazgo, anunciar éxito sin haber enviado nada.
  try {
    const sent = await sendPushToUser(admin, user.id, {
      title: 'BRUTAL.IA — Prueba',
      body: 'Las notificaciones funcionan en este dispositivo ✓',
      url: '/dashboard',
      tag: 'test',
    })
    if (sent === 0) {
      return NextResponse.json(
        { ok: false, sent: 0, error: 'No hay ningún dispositivo suscrito en esta cuenta — activa los avisos primero.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ ok: true, sent })
  } catch (err) {
    console.error('[push/test] no se pudo enviar la prueba:', err)
    return NextResponse.json(
      { ok: false, error: 'No se pudieron leer tus suscripciones. Vuelve a intentarlo.' },
      { status: 503 },
    )
  }
}
