import { createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Uses service_role (bypasses RLS) to fetch/create the current user's profile.
// The profiles RLS has an infinite recursion bug so client-side queries fail.
export async function GET(request: NextRequest) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'No token' }, { status: 401 })

  const admin = await createAdminClient()

  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

  const { data: profile } = await admin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (profile) return NextResponse.json(profile)

  // Auto-create if missing
  const name = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Usuario'
  const rawInitials = name.split(' ').map((n: string) => n[0]).join('').toUpperCase()
  const initials = rawInitials.slice(0, 2) || 'US'
  const colors = ['#1B5FFA', '#9B5FFA', '#E51D2A', '#FA8B1B', '#1BFA9B']
  const avatar_color = colors[Math.abs((user.email?.charCodeAt(0) ?? 0)) % colors.length]

  const { data: newProfile, error: insertErr } = await admin
    .from('profiles')
    .insert({ id: user.id, email: user.email!, name, initials, avatar_color })
    .select()
    .single()

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })
  return NextResponse.json(newProfile)
}
