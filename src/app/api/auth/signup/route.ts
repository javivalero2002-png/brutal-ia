import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  let email: string, password: string
  try {
    const body = await request.json()
    email = (body.email || '').trim()
    password = body.password || ''
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 })
  }
  if (!email || !password) return NextResponse.json({ error: 'Email y contraseña requeridos' }, { status: 400 })

  // Only allow emails pre-approved by the owner (profile row already exists)
  const admin = await createAdminClient()
  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (!existingProfile) {
    return NextResponse.json(
      { error: 'Email no autorizado. Solicita acceso al administrador.' },
      { status: 403 }
    )
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({ email, password })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  if (!data.session) {
    return NextResponse.json({ error: 'Confirma tu email antes de entrar.' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
