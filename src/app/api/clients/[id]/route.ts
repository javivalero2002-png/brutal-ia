import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getAuthCtx } from '@/lib/authz'
import { codigoHttpDeError, mensajeDeError } from '@/lib/respuestaDb'
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
  if (error) return NextResponse.json({ error: mensajeDeError(error) }, { status: codigoHttpDeError(error) })
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
  if (error) {
    console.error('[clients] no se pudo borrar el cliente', id, '—', error.message)
    // 23503 = violación de clave ajena. projects.client_id es ON DELETE RESTRICT
    // desde migrations/20260810_retencion_e_integridad.sql, precisamente para que
    // borrar un cliente no se lleve por delante su historial de proyectos. La UI
    // ya no ofrece el borrado duro cuando quedan proyectos, pero se puede llegar
    // aquí por una carrera: otra persona crea un proyecto entre el render y el
    // clic. Sin traducir, el owner veía el texto crudo de Postgres —«violates
    // foreign key constraint "projects_client_id_fkey"»— porque apiFetch deja
    // pasar cualquier `error` de menos de 160 caracteres.
    if ((error as { code?: string }).code === '23503') {
      return NextResponse.json(
        { error: 'Este cliente tiene proyectos: archívalo, o mueve o borra sus proyectos antes.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: 'No se pudo borrar el cliente' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
