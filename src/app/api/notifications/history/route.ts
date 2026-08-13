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

  // CONTRATO con NotificacionesTab: `unavailable` va SIEMPRE, true o false.
  // Antes solo aparecia en la rama de error y la pestana leia unicamente `items`,
  // asi que «la tabla no responde» y «no tienes avisos» se pintaban igual: la
  // bandeja vacia mentia. Con unavailable:true la UI debe decir que no se pudo
  // leer el historial, no que no hay nada.
  if (error) {
    // Sin este log el fallo era invisible: la ruta responde 200 igualmente.
    console.error('[notifications/history] no se pudo leer notification_log:', error.message)
    return NextResponse.json({ items: [], unavailable: true })
  }
  return NextResponse.json({ items: data || [], unavailable: false })
}

// Vaciar el historial del usuario
export async function DELETE() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  // supabase-js no lanza al fallar: sin mirar `error` esta ruta respondia {ok:true}
  // pasara lo que pasara, y el cliente se quedaba sin forma de saber que el
  // historial seguia entero en la base de datos.
  const { error } = await admin.from('notification_log').delete().eq('user_id', user.id)
  if (error) {
    console.error('[notifications/history] no se pudo vaciar el historial:', error.message)
    return NextResponse.json({ error: 'No se pudo vaciar el historial' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
