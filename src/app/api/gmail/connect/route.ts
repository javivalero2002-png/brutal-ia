import { createClient } from '@/lib/supabase/server'
import { getAuthUrl } from '@/lib/gmail'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = request.nextUrl.searchParams.get('account') === 'colabs' ? 'colabs' : 'personal'
  const url = getAuthUrl(user.id, account)
  return NextResponse.redirect(url)
}
