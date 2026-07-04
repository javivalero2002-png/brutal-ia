import { createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Public endpoint — no auth required (token = agenda item ID)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = await createAdminClient()

  const { data, error } = await admin
    .from('agenda')
    .select('id, title, platform, status, video_url, notes, feedback, publish_date, client_id')
    .eq('id', token)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(data)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const { feedback } = await req.json()
  if (!feedback?.trim()) return NextResponse.json({ error: 'feedback required' }, { status: 400 })

  const admin = await createAdminClient()
  const { error } = await admin
    .from('agenda')
    .update({ feedback: feedback.trim() })
    .eq('id', token)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
