import { createClient, createAdminClient } from '@/lib/supabase/server'
import { firmarCampos } from '@/lib/storageFirmado'
import { NextRequest, NextResponse } from 'next/server'

// Solo columnas conocidas: campos desconocidos no deben tumbar la petición
// ni permitir escribir columnas arbitrarias (p. ej. created_by).
const pick = (obj: any, keys: string[]) => Object.fromEntries(Object.entries(obj || {}).filter(([k, v]) => keys.includes(k) && v !== undefined))


export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = await createAdminClient()
  const { data, error } = await admin.from('content_agenda').select('*, client:clients(id,name,initials,color)').order('publish_date')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // El bucket es privado: lo guardado es un identificador, no una URL que
  // funcione. Se firma justo antes de salir. Ver src/lib/storageFirmado.ts.
  return NextResponse.json(await firmarCampos(admin, data, ['cover_url', 'video_url']))
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json()
  const admin = await createAdminClient()
  const payload: any = { ...pick(body, ['title','platform','content_type','status','publish_date','publish_time','notes','client_id','account_name','video_url']), created_by: user.id }
  let { data, error } = await admin.from('content_agenda').insert(payload).select('*, client:clients(id,name,initials,color)').single()
  // Si la BD aún no tiene las columnas nuevas (migración pendiente), reintentar sin ellas
  if (error && /account_name|video_url/.test(error.message)) {
    delete payload.account_name; delete payload.video_url
    ;({ data, error } = await admin.from('content_agenda').insert(payload).select('*, client:clients(id,name,initials,color)').single())
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
