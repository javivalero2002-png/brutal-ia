import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

const LOGO_ROW = '__account_logo__'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({}, { status: 401 })

  const admin = await createAdminClient()
  const { data } = await admin.from('reglas')
    .select('description,condition_text')
    .eq('name', LOGO_ROW)
    .eq('created_by', user.id)

  const logos: Record<string, string> = {}
  for (const row of data || []) {
    if (row.description && row.condition_text) {
      logos[row.description] = row.condition_text
    }
  }
  return NextResponse.json(logos)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { account, logo } = await request.json()
  if (!account || !logo) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const admin = await createAdminClient()
  await admin.from('reglas').delete().eq('name', LOGO_ROW).eq('created_by', user.id).eq('description', account)
  const { error } = await admin.from('reglas').insert({
    name: LOGO_ROW,
    description: account,
    condition_text: logo,
    action_text: 'logo',
    active: true,
    created_by: user.id,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
