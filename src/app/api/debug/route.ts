import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function GET() {
  const cookieStore = await cookies()
  const allCookies = cookieStore.getAll()
  const supabase = await createClient()
  const { data: { session }, error } = await supabase.auth.getSession()
  return NextResponse.json({
    cookieCount: allCookies.length,
    cookieNames: allCookies.map(c => c.name),
    hasSession: !!session,
    userId: session?.user?.id,
    error: error?.message,
  })
}
