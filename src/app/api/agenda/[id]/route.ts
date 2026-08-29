import { createClient, createAdminClient } from '@/lib/supabase/server'
import { firmarCampos } from '@/lib/storageFirmado'
import { esStorageDeOtroBucket } from '@/lib/safeFetch'
import { sinControl } from '@/components/shared/helpers'
import { codigoHttpDeError } from '@/lib/respuestaDb'
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
  const payload: any = pick(body, ['title','platform','content_type','status','publish_date','publish_time','notes','client_id','account_name','video_url','carpeta','feedback','cover_url'])
  // cover_url/video_url salen firmados por el GET y por /api/review (PÚBLICO): un
  // identificador a otro bucket (copias) se convertiría en una URL firmada al
  // backup expuesta a cualquiera con el enlace de revisión. Defensa en
  // profundidad del pin de firmarUrl; los enlaces externos (YouTube) pasan.
  if (esStorageDeOtroBucket(payload.cover_url) || esStorageDeOtroBucket(payload.video_url))
    return NextResponse.json({ error: 'URL de almacenamiento no permitida' }, { status: 400 })
  if ('title' in payload) payload.title = sinControl(payload.title)
  if ('notes' in payload) payload.notes = sinControl(payload.notes)
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

  if (error) return NextResponse.json({ error: error.message }, { status: codigoHttpDeError(error) })
  // Firmar TAMBIEN aqui, no solo en el GET. La UI pinta la fila que devuelve este
  // PATCH, asi que sin esto tocar cualquier campo de una pieza —el estado, una
  // nota— le devolvia la portada con la URL publica y la imagen se rompia hasta
  // recargar. Con el bucket cerrado esa URL da 400.
  const fila = await firmarCampos(admin, data, ['cover_url', 'video_url'])
  return NextResponse.json(dropped.length ? { ...(fila as Record<string, unknown>), __dropped: dropped } : fila)
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
