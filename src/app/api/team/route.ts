import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const { data, error } = await admin
    .from('profiles')
    // `onboarding_at` viaja para poder ver QUIÉN ha pasado la puesta en marcha.
    // Sin él no había forma de saberlo desde dentro de la app: hoy 5 de 6 cuentas
    // no la han hecho y no se veía en ningún sitio, así que parecía que el equipo
    // estaba dentro cuando en realidad no había entrado nadie.
    .select('id, name, email, role, initials, avatar_color, gmail_connected, onboarding_at')
    .order('role', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
