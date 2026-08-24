import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { cuentasDe, quitarCuenta } from '@/lib/gmailCuentas'

// Las cuentas de Gmail de QUIEN PREGUNTA. Nunca las de otro: el id sale de la
// sesión y no del cuerpo ni de la query, que es lo que impide leer —o desconectar—
// el buzón de un compañero.
//
// Y NUNCA sale el `refresh_token`. Es la credencial que da acceso al correo entero
// de esa persona; el cliente solo necesita saber qué direcciones hay conectadas.

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const cuentas = await cuentasDe(admin, user.id)

  // CUÁNTO HA ENTRADO POR CADA BUZÓN, que es la pregunta de verdad.
  //
  // Javi: «no sé si están entrando los Gmail de ambos correos». Con la lista de
  // direcciones a secas no se puede saber: una cuenta conectada y muerta se ve
  // exactamente igual que una conectada y viva. Lo que lo distingue es la fecha
  // del último mensaje que entró por ella.
  //
  // Se cuenta contra `inbox_messages.cuenta`, que es la columna que guarda por qué
  // buzón entró cada correo (migración 20260824_inbox_cuenta.sql). Los mensajes
  // anteriores a esa migración que no se pudieron atribuir sin adivinar llevan
  // NULL y no se cuentan en ninguna: es un hueco honesto, no un cero falso.
  const conteo = new Map<string, { total: number; sinLeer: number; ultimo: string | null }>()
  const { data: filas, error } = await admin
    .from('inbox_messages')
    .select('cuenta, is_read, received_at')
    .eq('source', 'gmail')
    .in('cuenta', cuentas.map(c => c.email))

  // El error NO se disfraza de «no hay correos»: sin esto, una consulta caída
  // pintaría las dos cuentas a cero y parecería justo el fallo que se busca.
  if (error) console.error('[cuentas] no se pudo contar por buzón —', error.message)

  for (const f of filas || []) {
    const k = f.cuenta as string
    const c = conteo.get(k) || { total: 0, sinLeer: 0, ultimo: null }
    c.total++
    if (!f.is_read) c.sinLeer++
    const t = f.received_at as string
    if (!c.ultimo || t > c.ultimo) c.ultimo = t
    conteo.set(k, c)
  }

  return NextResponse.json({
    // `medido: false` es la diferencia entre «esta cuenta no recibe nada» y «no he
    // podido mirarlo». La pantalla las pinta distinto a propósito.
    medido: !error,
    cuentas: cuentas.map(c => ({
      email: c.email,
      compartida: c.compartida,
      ...(conteo.get(c.email) || { total: 0, sinLeer: 0, ultimo: null }),
    })),
  })
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { email } = await request.json().catch(() => ({}))
  if (typeof email !== 'string' || !email.trim()) {
    return NextResponse.json({ error: 'email required' }, { status: 400 })
  }

  const admin = await createAdminClient()
  // Solo entre las SUYAS: el `.eq('profile_id', user.id)` de `quitarCuenta` es lo
  // que impide desconectarle el correo a otro mandando su dirección.
  const r = await quitarCuenta(admin, user.id, email)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
  if (r.quitadas === 0) {
    // Nada que borrar no es lo mismo que «desconectada»: sin distinguirlo, un
    // email mal escrito responde 200 y la persona se cree fuera sin estarlo.
    return NextResponse.json({ error: 'Esa cuenta no estaba conectada' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
