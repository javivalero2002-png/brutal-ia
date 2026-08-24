import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { cuentasDe } from '@/lib/gmailCuentas'
import { listarIdsDeMensajes } from '@/lib/gmail'

export const maxDuration = 60

/**
 * Atribuye a su buzón los correos que entraron ANTES de que se guardara la cuenta.
 *
 * Hasta el 2026-08-24 `inbox_messages` no tenía columna `cuenta`. La migración
 * rellenó lo que se podía saber sin adivinar: el buzón compartido (es uno solo) y
 * lo personal de quien tuviera UNA sola cuenta. Quien tiene dos —Javi— se quedó
 * con todo sin identificar, que en su caso son 754 de 809.
 *
 * Esto lo resuelve de la única forma exacta que hay: preguntándole a cada cuenta
 * qué identificadores tiene. Un `gmail_id` pertenece al buzón que lo devuelve.
 *
 * Es del MISMO tipo que `/api/admin/memoria-enlaces`: una reparación puntual de
 * filas viejas, que se puede repetir sin hacer daño porque solo toca las que
 * siguen a NULL.
 *
 * Solo sobre lo propio: las cuentas salen de la sesión, así que nadie puede pedir
 * que se recorra el buzón de otro.
 */
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const cuentas = (await cuentasDe(admin, user.id)).filter(c => !c.compartida)
  if (!cuentas.length) return NextResponse.json({ error: 'No tienes cuentas personales conectadas' }, { status: 400 })

  const { data: sinCuenta, error } = await admin
    .from('inbox_messages')
    .select('gmail_id')
    .eq('user_id', user.id)
    .eq('source', 'gmail')
    .eq('shared', false)
    .is('cuenta', null)
    .not('gmail_id', 'is', null)

  if (error) {
    console.error('[identificar] no se pudieron leer los pendientes:', error.message)
    return NextResponse.json({ error: 'No se pudo leer el buzón' }, { status: 500 })
  }

  const pendientes = new Set((sinCuenta || []).map(m => m.gmail_id as string))
  if (!pendientes.size) return NextResponse.json({ ok: true, identificados: 0, pendientes: 0 })

  let identificados = 0
  const porCuenta: Record<string, number> = {}
  for (const c of cuentas) {
    if (!pendientes.size) break
    let ids: Set<string>
    try {
      ids = await listarIdsDeMensajes(c.refresh_token, pendientes)
    } catch (err) {
      // Una cuenta que falla NO tumba las demás, y se dice cuál: sin esto, un
      // token caducado dejaría la mitad sin identificar y el resultado diría que
      // todo fue bien.
      console.error('[identificar] fallo listando', c.email, err)
      continue
    }
    if (!ids.size) continue

    // De 200 en 200: un `in` con 754 valores hace una URL que el servidor rechaza.
    const lote = [...ids]
    for (let i = 0; i < lote.length; i += 200) {
      const trozo = lote.slice(i, i + 200)
      const { error: errUp } = await admin
        .from('inbox_messages')
        .update({ cuenta: c.email })
        .eq('user_id', user.id)
        .is('cuenta', null)
        .in('gmail_id', trozo)
      if (errUp) {
        console.error('[identificar] fallo escribiendo', c.email, errUp.message)
        continue
      }
      identificados += trozo.length
      porCuenta[c.email] = (porCuenta[c.email] || 0) + trozo.length
      for (const id of trozo) pendientes.delete(id)
    }
  }

  return NextResponse.json({ ok: true, identificados, pendientes: pendientes.size, porCuenta })
}
