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
  return NextResponse.json({
    cuentas: cuentas.map(c => ({ email: c.email, compartida: c.compartida })),
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
