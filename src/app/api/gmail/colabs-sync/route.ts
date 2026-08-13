import { createClient, createAdminClient } from '@/lib/supabase/server'
import { syncColabsInbox } from '@/lib/colabsSync'
import { NextResponse } from 'next/server'

// Sincroniza el buzon compartido analizando con IA: el default de Vercel se queda corto.
export const maxDuration = 60

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  // Buzón compartido: usa el token de quien lo tenga conectado, no el del usuario actual
  const result = await syncColabsInbox(admin, { triggeredBy: user.id })

  if (!result.ok) {
    // `dedup_failed` es un fallo TRANSITORIO: no se pudo leer qué emails ya
    // estaban guardados, así que el bucle se corta antes de gastar una llamada a
    // Claude por cada email del buzón. 503 y no 500, igual que /api/gmail/sync:
    // le dice al cliente que reintente, que es justo lo que procede.
    const status = result.error === 'Colaboraciones not connected' ? 400
      : result.error === 'dedup_failed' ? 503
      : 500
    return NextResponse.json({ error: result.error, code: result.code, details: result.details }, { status })
  }
  // insertFailures viaja hasta el cliente: emails analizados y NO guardados. Sin
  // él, un buzón con la escritura rota se anuncia como "0 nuevos" y parece que
  // no había correo.
  return NextResponse.json({
    synced: result.synced,
    total: result.total,
    account: result.account,
    insertFailures: result.insertFailures ?? 0,
    // `saltado`: no se hizo nada porque otra instancia lo estaba haciendo. Sin
    // este campo la respuesta es `synced: 0, total: 0`, que desde el cliente es
    // exactamente igual que "no habia correo nuevo" — y no es lo mismo.
    saltado: result.saltado ?? false,
  })
}
