import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/inbox/thread?withUserId=X&withName=Name
// Returns all internal messages between current user and the other user
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const withUserId = searchParams.get('withUserId')
  const withName = searchParams.get('withName') || ''

  if (!withUserId) return NextResponse.json({ error: 'withUserId required' }, { status: 400 })

  const admin = await createAdminClient()

  // Get MY profile name so we can match it in the other person's inbox
  const { data: myProfile } = await admin.from('profiles').select('name').eq('id', user.id).single()
  const myName = myProfile?.name || ''

  // Messages they sent to me (in my inbox, from_name matches their name)
  const { data: received } = await admin
    .from('inbox_messages')
    .select('*')
    .eq('user_id', user.id)
    .eq('source', 'internal')
    .ilike('from_name', `%${withName.split(' ')[0]}%`)
    .order('received_at', { ascending: true })

  // Messages I sent to them (in their inbox, from_name matches my name)
  const { data: sent } = await admin
    .from('inbox_messages')
    .select('*')
    .eq('user_id', withUserId)
    .eq('source', 'internal')
    .ilike('from_name', `%${myName.split(' ')[0]}%`)
    .order('received_at', { ascending: true })

  // Merge + sort by time, mark direction
  const thread = [
    ...(received || []).map(m => ({ ...m, _dir: 'received' })),
    ...(sent || []).map(m => ({ ...m, _dir: 'sent' })),
  ].sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime())

  return NextResponse.json(thread)
}
