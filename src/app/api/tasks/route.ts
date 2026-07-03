import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()

  let query = admin
    .from('tasks')
    .select('*, assignee:profiles!assigned_to(id,name,initials,avatar_color), client:clients(id,name,initials,color)')
    .order('created_at', { ascending: false })

  if (profile?.role !== 'owner') {
    // Members see: tasks assigned to them, tasks they created, or unassigned tasks
    query = query.or(`assigned_to.eq.${user.id},created_by.eq.${user.id},assigned_to.is.null`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const body = await request.json()

  const { data, error } = await admin
    .from('tasks')
    .insert({ ...body, created_by: user.id })
    .select('*, assignee:profiles!assigned_to(id,name,initials,avatar_color)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
