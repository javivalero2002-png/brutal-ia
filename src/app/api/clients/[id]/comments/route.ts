import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([], { status: 401 })

  const admin = await createAdminClient()
  const { data, error } = await admin
    .from('client_comments')
    .select('*, profile:profiles(name, initials, avatar_color)')
    .eq('client_id', id)
    .order('created_at', { ascending: true })

  if (error) {
    // Table may not exist yet — return empty gracefully
    if (error.code === '42P01') return NextResponse.json([])
    return NextResponse.json([])
  }
  return NextResponse.json(data || [])
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { body } = await req.json()
  if (!body?.trim()) return NextResponse.json({ error: 'Empty' }, { status: 400 })

  const admin = await createAdminClient()
  const { data, error } = await admin
    .from('client_comments')
    .insert({ client_id: id, profile_id: user.id, body: body.trim() })
    .select('*, profile:profiles(name, initials, avatar_color)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
