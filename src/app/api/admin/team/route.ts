import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Only the owner can call these endpoints
async function requireOwner() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const admin = await createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'owner') return null
  return { user, admin }
}

// GET: list all auth users + profiles
export async function GET() {
  const ctx = await requireOwner()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { admin } = ctx
  const { data: profiles } = await admin.from('profiles').select('*').order('role', { ascending: false })
  return NextResponse.json(profiles || [])
}

// POST: create a new team member account
export async function POST(request: NextRequest) {
  const ctx = await requireOwner()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { admin } = ctx
  const { email, name, role = 'member', avatar_color, initials, password } = await request.json()

  if (!email || !name) return NextResponse.json({ error: 'email and name required' }, { status: 400 })

  const rawInitials = initials || name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
  const colors = ['#1B5FFA','#9B5FFA','#E51D2A','#FA8B1B','#1BFA9B','#F97316','#06B6D4']
  const color = avatar_color || colors[Math.abs(email.charCodeAt(0)) % colors.length]
  const pwd = password || Math.random().toString(36).slice(-10) + 'Aa1!'

  // Check if user already exists
  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id, email')
    .eq('email', email)
    .single()

  if (existingProfile) {
    // Update existing profile name/role
    await admin.from('profiles').update({ name, role, initials: rawInitials, avatar_color: color }).eq('id', existingProfile.id)
    return NextResponse.json({ ok: true, action: 'updated', email })
  }

  // Create new auth user (no email confirmation needed — admin API)
  const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: pwd,
    email_confirm: true,
    user_metadata: { full_name: name },
  })

  if (createErr || !newUser.user) {
    return NextResponse.json({ error: createErr?.message || 'Failed to create user' }, { status: 500 })
  }

  // Create profile row
  const { error: profileErr } = await admin.from('profiles').insert({
    id: newUser.user.id,
    email,
    name,
    initials: rawInitials,
    avatar_color: color,
    role,
  })

  if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, action: 'created', email, tempPassword: pwd })
}

// PATCH: update an existing profile by email
export async function PATCH(request: NextRequest) {
  const ctx = await requireOwner()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { admin } = ctx
  const { email, ...updates } = await request.json()
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const { error } = await admin.from('profiles').update(updates).eq('email', email)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
