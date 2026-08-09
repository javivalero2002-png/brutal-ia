import { createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'No token' }, { status: 401 })

  const admin = await createAdminClient()

  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

  // 1. Try to find profile by user ID (normal case)
  const { data: profile } = await admin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (profile) return NextResponse.json(profile)

  // 2. If not found by ID, check if email already exists (Google sign-in for existing account).
  //    NOTA: el vínculo se hace por email verificado por el proveedor (Google/Supabase)
  //    y el alta de cuentas está restringida al owner, así que no hay auto-registro.
  //    No se filtra por dominio a propósito: el equipo usa también cuentas Gmail.
  if (user.email) {
    const { data: existingByEmail } = await admin
      .from('profiles')
      .select('*')
      .eq('email', user.email)
      .single()

    if (existingByEmail) {
      // Update the profile ID to match the new auth user so future lookups work
      await admin
        .from('profiles')
        .update({ id: user.id })
        .eq('email', user.email)
      return NextResponse.json({ ...existingByEmail, id: user.id })
    }
  }

  // 3. Unknown user — self-registration is disabled
  // All accounts must be pre-created by the owner via /api/admin/team
  return NextResponse.json(
    { error: 'Acceso no autorizado. Contacta con el administrador de Brutal Studios.' },
    { status: 403 }
  )
}
