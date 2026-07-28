import { createClient, createAdminClient } from '@/lib/supabase/server'
import { syncColabsInbox } from '@/lib/colabsSync'
import { NextResponse } from 'next/server'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  // Buzón compartido: usa el token de quien lo tenga conectado, no el del usuario actual
  const result = await syncColabsInbox(admin, { triggeredBy: user.id })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code, details: result.details },
      { status: result.error === 'Colaboraciones not connected' ? 400 : 500 }
    )
  }
  return NextResponse.json({ synced: result.synced, total: result.total, account: result.account })
}
