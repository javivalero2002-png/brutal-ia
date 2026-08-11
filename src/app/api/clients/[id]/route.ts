import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getAuthCtx } from '@/lib/authz'
import { NextRequest, NextResponse } from 'next/server'

// Solo columnas conocidas: campos desconocidos no deben tumbar la petición
// ni permitir escribir columnas arbitrarias (p. ej. created_by).
const pick = (obj: any, keys: string[]) => Object.fromEntries(Object.entries(obj || {}).filter(([k, v]) => keys.includes(k) && v !== undefined))


export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  // La facturación es un dato sensible: solo el owner puede modificarla.
  const allowed = ctx.role === 'owner'
    ? ['name','industry','status','revenue','notes','color','initials']
    : ['name','industry','status','notes','color','initials']
  const admin = ctx.admin
  const cambios: Record<string, any> = pick(body, allowed)
  // `archived_at` se deriva del estado, no se acepta del cliente: asi no puede
  // llegar una fecha inventada por el navegador y no hay forma de que la columna
  // y el estado se contradigan. Se sella al archivar y se limpia al reactivar.
  if (typeof cambios.status === 'string') {
    cambios.archived_at = cambios.status === 'Archivado' ? new Date().toISOString() : null
  }
  const { data, error } = await admin.from('clients').update(cambios).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { error } = await admin.from('clients').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
