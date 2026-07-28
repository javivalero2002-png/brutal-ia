import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { currentPassword, newPassword } = await request.json()

  if (!currentPassword) {
    return NextResponse.json({ error: 'Debes introducir tu contraseña actual' }, { status: 400 })
  }
  if (!newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: 'La contraseña debe tener al menos 8 caracteres' }, { status: 400 })
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email!,
    password: currentPassword,
  })
  if (signInError) {
    return NextResponse.json({ error: 'La contraseña actual no es correcta' }, { status: 403 })
  }

  const admin = await createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(user.id, { password: newPassword })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
