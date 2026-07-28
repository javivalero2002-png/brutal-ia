import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const { data: members, error } = await admin
    .from('profiles')
    .select('id, name, initials, avatar_color, role, email, gmail_connected, gmail_account, gmail_colabs_connected, gmail_colabs_account')
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const sorted = (members || []).sort((a: any, b: any) => {
    if (a.role === 'owner' && b.role !== 'owner') return -1
    if (a.role !== 'owner' && b.role === 'owner') return 1
    return (a.name || '').localeCompare(b.name || '')
  })

  return NextResponse.json({ members: sorted })
}
