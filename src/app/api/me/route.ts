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

  // 2. If not found by ID, check if email already exists (Google sign-in for existing account)
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

  // 3. First time user — create profile
  const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Usuario'
  const rawInitials = name.split(' ').map((n: string) => n[0]).join('').toUpperCase()
  const initials = rawInitials.slice(0, 2) || 'US'
  const colors = ['#1B5FFA', '#9B5FFA', '#E51D2A', '#FA8B1B', '#1BFA9B']
  const avatar_color = colors[Math.abs((user.email?.charCodeAt(0) ?? 0)) % colors.length]

  const { data: newProfile, error: insertErr } = await admin
    .from('profiles')
    .insert({ id: user.id, email: user.email!, name, initials, avatar_color, role: 'member' })
    .select()
    .single()

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })
  return NextResponse.json(newProfile)
}
