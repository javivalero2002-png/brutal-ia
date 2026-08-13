import { createClient, createAdminClient } from '@/lib/supabase/server'
import { firmarCampos } from '@/lib/storageFirmado'
import { getAuthCtx, projectExists } from '@/lib/authz'
import { NextRequest, NextResponse } from 'next/server'

// Solo columnas conocidas: campos desconocidos no deben tumbar la petición
// ni permitir escribir columnas arbitrarias (p. ej. created_by).
const pick = (obj: any, keys: string[]) => Object.fromEntries(Object.entries(obj || {}).filter(([k, v]) => keys.includes(k) && v !== undefined))


export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  // El proyecto debe existir (evita PATCH a ciegas sobre IDs arbitrarios)
  if (!(await projectExists(ctx, id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await request.json()
  const admin = ctx.admin
  const { data, error } = await admin
    .from('projects').update({ ...pick(body, ['name','client_id','status','progress','deadline','color','cover_url','pdf_url','pdf_analysis']), updated_at: new Date().toISOString() })
    .eq('id', id).select('*, client:clients(id,name,initials,color)').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // El bucket es privado: lo guardado es un identificador, no una URL que
  // funcione. Se firma justo antes de salir. Ver src/lib/storageFirmado.ts.
  return NextResponse.json(await firmarCampos(ctx.admin, data, ['cover_url', 'pdf_url']))
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { error } = await admin.from('projects').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
