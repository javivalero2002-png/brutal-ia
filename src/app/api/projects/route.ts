import { createClient, createAdminClient } from '@/lib/supabase/server'
import { firmarCampos } from '@/lib/storageFirmado'
import { esStorageDeOtroBucket } from '@/lib/safeFetch'
import { NextRequest, NextResponse } from 'next/server'

// Solo columnas conocidas: campos desconocidos no deben tumbar la petición
// ni permitir escribir columnas arbitrarias (p. ej. created_by).
const pick = (obj: any, keys: string[]) => Object.fromEntries(Object.entries(obj || {}).filter(([k, v]) => keys.includes(k) && v !== undefined))


export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const { data, error } = await admin
    .from('projects')
    .select('*, client:clients(id,name,initials,color)')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // El bucket es privado: lo guardado es un identificador, no una URL que
  // funcione. Se firma justo antes de salir. Ver src/lib/storageFirmado.ts.
  return NextResponse.json(await firmarCampos(admin, data, ['cover_url', 'pdf_url']))
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Cualquier miembro del equipo autenticado puede crear proyectos (el borrado sigue siendo solo-owner)
  const admin = await createAdminClient()

  const body = await request.json()
  if (esStorageDeOtroBucket(body?.cover_url) || esStorageDeOtroBucket(body?.pdf_url))
    return NextResponse.json({ error: 'URL de almacenamiento no permitida' }, { status: 400 })
  const { data, error } = await admin
    .from('projects')
    .insert({ ...pick(body, ['name','client_id','status','progress','deadline','color','cover_url','pdf_url','tipo','empieza_el','semanas','salidas_semana']), created_by: user.id })
    .select('*, client:clients(id,name,initials,color)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
