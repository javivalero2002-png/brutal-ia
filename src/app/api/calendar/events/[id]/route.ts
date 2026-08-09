import { createClient, createAdminClient } from '@/lib/supabase/server'
import { deleteCalendarEvent, updateCalendarEvent } from '@/lib/gmail'
import { NextRequest, NextResponse } from 'next/server'

async function getProfileWithGmail(userId: string) {
  const admin = await createAdminClient()
  const { data } = await admin
    .from('profiles')
    .select('gmail_refresh_token, gmail_connected')
    .eq('id', userId)
    .single()
  return data
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: eventId } = await params
  const profile = await getProfileWithGmail(user.id)
  if (!profile?.gmail_refresh_token || !profile?.gmail_connected) {
    return NextResponse.json({ error: 'Gmail no conectado' }, { status: 400 })
  }

  try {
    await deleteCalendarEvent(profile.gmail_refresh_token, eventId)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('Calendar delete error:', err?.message)
    return NextResponse.json({ error: 'Error eliminando evento' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: eventId } = await params
  const profile = await getProfileWithGmail(user.id)
  if (!profile?.gmail_refresh_token || !profile?.gmail_connected) {
    return NextResponse.json({ error: 'Gmail no conectado' }, { status: 400 })
  }

  const { title, date, time } = await request.json()
  try {
    const result = await updateCalendarEvent(profile.gmail_refresh_token, eventId, { title, date, time })
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('Calendar update error:', err?.message)
    return NextResponse.json({ error: 'Error actualizando evento' }, { status: 500 })
  }
}
