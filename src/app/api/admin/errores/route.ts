import { NextRequest, NextResponse } from 'next/server'
import { getAuthCtx } from '@/lib/authz'

/**
 * Los errores que la app ha anotado.
 *
 * SOLO PROPIETARIO: dice qué está roto y dónde, que es justo lo que no se le
 * enseña a todo el mundo en una herramienta de trabajo — y además hay poco que
 * hacer con ello si no eres quien la arregla.
 *
 * Por defecto solo los ABIERTOS, ordenados por gravedad y luego por lo reciente:
 * un registro que lo enseña todo se lee una vez y nunca más.
 */
export async function GET(request: NextRequest) {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (ctx.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const todos = searchParams.get('todos') === '1'

  let q = ctx.admin
    .from('errores')
    .select('id, clave, donde, que, gravedad, contexto, veces, primera_at, ultima_at, resuelto_at')
    .order('ultima_at', { ascending: false })
    .limit(100)
  if (!todos) q = q.is('resuelto_at', null)

  const { data, error } = await q
  if (error) {
    // El fallo se dice. Un registro de errores que devuelve una lista vacía porque
    // su propia consulta falló es la broma más cara de todas.
    console.error('[errores] no se pudieron leer —', error.message)
    return NextResponse.json({ error: 'No se pudieron leer los errores' }, { status: 500 })
  }

  const orden = { alta: 0, media: 1, baja: 2 } as Record<string, number>
  const lista = (data || []).sort((a, b) =>
    (orden[a.gravedad as string] ?? 1) - (orden[b.gravedad as string] ?? 1))

  return NextResponse.json({
    errores: lista,
    abiertos: lista.filter(e => !e.resuelto_at).length,
  })
}

/** Marcar uno como resuelto. Si vuelve a pasar, `anotarError` lo reabre solo. */
export async function PATCH(request: NextRequest) {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (ctx.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, resuelto } = await request.json().catch(() => ({}))
  if (typeof id !== 'string' || !id) {
    return NextResponse.json({ error: 'Falta el id' }, { status: 400 })
  }

  const { error } = await ctx.admin
    .from('errores')
    .update({ resuelto_at: resuelto === false ? null : new Date().toISOString() })
    .eq('id', id)
  if (error) {
    console.error('[errores] no se pudo marcar —', error.message)
    return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
