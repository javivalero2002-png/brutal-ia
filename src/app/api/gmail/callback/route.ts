import { createAdminClient } from '@/lib/supabase/server'
import { getOAuthClient } from '@/lib/gmail'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const userId = searchParams.get('state')

  if (!code || !userId) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard?gmail=error`)
  }

  const oauth2Client = getOAuthClient()
  const { tokens } = await oauth2Client.getToken(code)

  if (!tokens.refresh_token) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard?gmail=no_refresh_token`)
  }

  const supabase = await createAdminClient()
  await supabase
    .from('profiles')
    .update({ gmail_refresh_token: tokens.refresh_token, gmail_connected: true })
    .eq('id', userId)

  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard?gmail=connected`)
}
