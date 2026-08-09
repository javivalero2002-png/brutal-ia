import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { account } = await request.json()
  const admin = await createAdminClient()

  if (account === 'colabs') {
    // The colabs token may belong to a different profile than the current user
    // (whoever last connected it). Clear it from all profiles that have it.
    const { error } = await admin
      .from('profiles')
      .update({ gmail_colabs_connected: false, gmail_colabs_refresh_token: null, gmail_colabs_account: null })
      .not('gmail_colabs_refresh_token', 'is', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await admin
      .from('profiles')
      .update({ gmail_connected: false, gmail_refresh_token: null, gmail_account: null })
      .eq('id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
