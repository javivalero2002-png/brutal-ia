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

  const { data: myProfile } = await admin.from('profiles').select('name').eq('id', user.id).single()
  const myName = myProfile?.name || ''

  const withFirst = withName.split(' ')[0]
  const myFirst = myName.split(' ')[0]

  let receivedQuery = admin
    .from('inbox_messages')
    .select('*')
    .eq('user_id', user.id)
    .eq('source', 'internal')
    .order('received_at', { ascending: true })
  if (withFirst) receivedQuery = receivedQuery.ilike('from_name', `%${withFirst}%`)

  let sentQuery = admin
    .from('inbox_messages')
    .select('*')
    .eq('user_id', withUserId)
    .eq('source', 'internal')
    .order('received_at', { ascending: true })
  if (myFirst) sentQuery = sentQuery.ilike('from_name', `%${myFirst}%`)

  const [{ data: received }, { data: sent }] = await Promise.all([receivedQuery, sentQuery])

  // Merge + sort by time, mark direction
  const thread = [
    ...(received || []).map(m => ({ ...m, _dir: 'received' })),
    ...(sent || []).map(m => ({ ...m, _dir: 'sent' })),
  ].sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime())

  return NextResponse.json(thread)
}
