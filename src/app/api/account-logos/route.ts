import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

import { LOGO_ROW } from '@/lib/reglaRows'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({}, { status: 401 })

  const admin = await createAdminClient()
  const { data, error } = await admin.from('reglas')
    .select('description,condition_text')
    .eq('name', LOGO_ROW)
    .eq('created_by', user.id)
  // supabase-js NO lanza: descartando `error` esto devolvia {} con un 200, o sea
  // lo mismo que "esta persona no ha subido ningun logo". En Contenido los logos de
  // cuenta desaparecian de las piezas sin explicacion y sin nada que arreglar,
  // porque en la base seguian estando. Con un 500 el consumidor
  // (ContenidoSection, que mira `r.ok`) se queda con los que ya tiene en local en
  // vez de vaciarlos.
  if (error) {
    console.error('[account-logos] no se pudieron leer los logos de cuenta:', error.message)
    return NextResponse.json({ error: 'No se pudieron cargar los logos' }, { status: 500 })
  }

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
  // El borrado del logo anterior TAMBIEN se comprueba, y por lo mismo que el GET:
  // no hay indice unico sobre (name, created_by, description), asi que si el DELETE
  // falla el INSERT de abajo deja DOS filas para la misma cuenta. El GET las recorre
  // en el orden que le venga y se queda con la ultima, o sea que el logo vuelve al
  // viejo a ratos, sin patron. Mejor no insertar si no se ha podido limpiar.
  const { error: delErr } = await admin.from('reglas').delete().eq('name', LOGO_ROW).eq('created_by', user.id).eq('description', account)
  if (delErr) {
    console.error('[account-logos] no se pudo retirar el logo anterior de', account, '—', delErr.message)
    return NextResponse.json({ error: 'No se pudo guardar el logo' }, { status: 500 })
  }
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
