import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCalendarEvents, createCalendarEvent } from '@/lib/gmail'

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
  } catch (err: any) {
    const code = err?.code ?? err?.status
    if (code === 403) {
      // Token has no calendar scope — user must reauth personal Gmail
      return NextResponse.json({ __error: 'no_scope' })
    }
    return NextResponse.json([])
  }
}

export async function POST(request: NextRequest) {
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
    return NextResponse.json({ error: 'Gmail no conectado' }, { status: 400 })
  }

  const { title, date, time, description, attendees } = await request.json()
  if (!title?.trim() || !date) {
    return NextResponse.json({ error: 'Faltan título o fecha' }, { status: 400 })
  }

  try {
    const event = await createCalendarEvent(profile.gmail_refresh_token, {
      title, date, time, description,
      attendees: Array.isArray(attendees) ? attendees.filter((a: any) => typeof a === 'string' && a.includes('@')) : undefined,
    })
    return NextResponse.json(event)
  } catch (err: any) {
    const status = err?.code ?? err?.status ?? 500
    if (status === 403) {
      return NextResponse.json({ error: 'insufficient_scope' }, { status: 403 })
    }
    console.error('Calendar create error:', err?.message)
    return NextResponse.json({ error: 'Error creando evento' }, { status: 500 })
  }
}
