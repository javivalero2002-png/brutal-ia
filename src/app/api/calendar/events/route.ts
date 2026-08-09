import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCalendarEvents, createCalendarEvent } from '@/lib/gmail'

// Consulta a la API de Google por cada calendario conectado: el default de
// Vercel se queda corto cuando hay varios buzones.
export const maxDuration = 60

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('gmail_refresh_token, gmail_connected, gmail_colabs_refresh_token, gmail_colabs_connected')
    .eq('id', user.id)
    .single()

  if (!profile?.gmail_refresh_token || !profile?.gmail_connected) {
    return NextResponse.json([])
  }

  const coProfile = profile

  const isNoScope = (err: any) => {
    const code = Number(err?.status ?? err?.code ?? 0)
    const reason = err?.errors?.[0]?.reason ?? err?.response?.data?.error?.errors?.[0]?.reason ?? ''
    return code === 403 || code === 401 || reason === 'insufficientPermissions' || reason === 'forbidden' || reason === 'invalid_grant'
  }

  let personalEvents: any[] = []
  let personalNoScope = false
  try {
    personalEvents = await getCalendarEvents(profile.gmail_refresh_token, 3)
  } catch (err: any) {
    if (isNoScope(err)) { personalNoScope = true }
    else { console.error('Calendar GET personal error:', err?.message) }
  }

  let colabsEvents: any[] = []
  if (coProfile?.gmail_colabs_refresh_token && coProfile?.gmail_colabs_connected) {
    try {
      colabsEvents = await getCalendarEvents(coProfile.gmail_colabs_refresh_token, 3)
    } catch (err: any) {
      if (!isNoScope(err)) { console.error('Calendar GET colabs error:', err?.message) }
    }
  }

  if (personalNoScope && colabsEvents.length === 0 && !coProfile?.gmail_colabs_refresh_token) {
    return NextResponse.json({ __error: 'no_scope' })
  }

  // Merge and deduplicate by event id
  const seen = new Set<string>()
  const merged = [...personalEvents, ...colabsEvents].filter(e => {
    if (seen.has(e.id)) return false
    seen.add(e.id)
    return true
  }).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())

  return NextResponse.json(merged)
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
    const code = Number(err?.status ?? err?.code ?? 0)
    const reason = err?.errors?.[0]?.reason ?? err?.response?.data?.error?.errors?.[0]?.reason ?? ''
    if (code === 403 || reason === 'insufficientPermissions') {
      return NextResponse.json({ error: 'insufficient_scope' }, { status: 403 })
    }
    console.error('Calendar create error:', err?.message, code)
    return NextResponse.json({ error: 'Error creando evento' }, { status: 500 })
  }
}
