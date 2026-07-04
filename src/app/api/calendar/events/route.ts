import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCalendarEvents } from '@/lib/gmail'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('gmail_refresh_token, gmail_connected')
    .eq('id', user.id)
    .single()

  if (!profile?.gmail_refresh_token || !profile?.gmail_connected) {
    return NextResponse.json([])
  }

  try {
    const events = await getCalendarEvents(profile.gmail_refresh_token, 3)
    return NextResponse.json(events)
  } catch {
    return NextResponse.json([])
  }
}
