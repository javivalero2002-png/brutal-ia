import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { account } = await request.json()
  const admin = await createAdminClient()

  const updates: Record<string, any> = account === 'colabs'
    ? { gmail_colabs_connected: false, gmail_colabs_refresh_token: null, gmail_colabs_account: null }
    : { gmail_connected: false, gmail_refresh_token: null, gmail_account: null }

  const { error } = await admin.from('profiles').update(updates).eq('id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
