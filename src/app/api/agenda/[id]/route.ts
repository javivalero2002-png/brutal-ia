import { createClient, createAdminClient } from '@/lib/supabase/server'
import { firmarCampos } from '@/lib/storageFirmado'
import { NextRequest, NextResponse } from 'next/server'

// Solo columnas conocidas: campos desconocidos no deben tumbar la petición
// ni permitir escribir columnas arbitrarias (p. ej. created_by).
const pick = (obj: any, keys: string[]) => Object.fromEntries(Object.entries(obj || {}).filter(([k, v]) => keys.includes(k) && v !== undefined))


// Devuelve UNA pieza. Existe para que ContenidoSection pueda releer el `feedback`
// justo antes de escribirlo: esa columna tiene dos escritores —el equipo desde la
// app y el cliente desde /review— y publicar una opinion partiendo de la copia en
// memoria borraba lo que el cliente hubiera mandado mientras tanto.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = await createAdminClient()
  const { data, error } = await admin.from('content_agenda').select('*').eq('id', id).single()
  if (error) {
    console.error('[agenda/:id] la consulta fallo:', error.message)
    return NextResponse.json({ error: 'No se pudo cargar la pieza' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // El bucket es privado: lo guardado es un identificador, no una URL que
  // funcione. Se firma justo antes de salir. Ver src/lib/storageFirmado.ts.
  return NextResponse.json(await firmarCampos(admin, data, ['cover_url', 'video_url']))
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  const admin = await createAdminClient()
  // `feedback` y `cover_url` faltaban en el allowlist, así que "Opiniones del
  // equipo" pintaba el estado optimista, decía "Opinión publicada" y se perdía al
  // recargar: el PATCH nunca las llevaba.
  const payload: any = pick(body, ['title','platform','content_type','status','publish_date','publish_time','notes','client_id','account_name','video_url','feedback','cover_url'])
  let { data, error } = await admin.from('content_agenda').update(payload).eq('id', id).select('*, client:clients(id,name,initials,color)').single()
  // El fallback debe cubrir también las columnas nuevas: si cover_url no existe
  // en la BD (upload-cover ya contempla ese caso), sin esto el guardado entero
  // reventaría con un 500 y se llevaría por delante notas, fechas y plataforma.
  // El reintento descarta columnas y la respuesta seguía siendo un 200 limpio:
  // la UI decía "Guardado" mientras esos cuatro campos se perdían en silencio.
  // Ahora se devuelve `dropped` para que el cliente pueda avisar.
  let dropped: string[] = []
  if (error && /account_name|video_url|feedback|cover_url/.test(error.message)) {
    dropped = ['account_name','video_url','feedback','cover_url'].filter(k => k in payload)
    console.error('[agenda] columnas ausentes en la BD, guardado parcial:', dropped.join(', '), '—', error.message)
    delete payload.account_name; delete payload.video_url
    delete payload.feedback; delete payload.cover_url
    ;({ data, error } = await admin.from('content_agenda').update(payload).eq('id', id).select('*, client:clients(id,name,initials,color)').single())
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(dropped.length ? { ...data, __dropped: dropped } : data)
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = await createAdminClient()
  const { error } = await admin.from('content_agenda').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
