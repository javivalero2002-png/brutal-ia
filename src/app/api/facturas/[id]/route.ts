import { getAuthCtx } from '@/lib/authz'
import { codigoHttpDeError, mensajeDeError } from '@/lib/respuestaDb'
import { sinControl } from '@/components/shared/helpers'
import { NextRequest, NextResponse } from 'next/server'

// Editar y borrar una factura. Solo el propietario, igual que crearla.

const DIA = /^\d{4}-\d{2}-\d{2}$/

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (ctx.role !== 'owner') return NextResponse.json({ error: 'Solo el propietario factura' }, { status: 403 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const cambios: Record<string, unknown> = {}

  // Allowlist campo a campo, y NUNCA `client_id`: mover una factura de cliente
  // desde el navegador cambiaría lo facturado de dos clientes a la vez. Tampoco
  // `created_by`, por lo de siempre.
  for (const k of ['numero', 'concepto', 'notas'] as const) {
    if (k in body) cambios[k] = sinControl(body[k]) || null
  }
  if ('importe_centimos' in body) {
    const c = Number(body.importe_centimos)
    if (!Number.isInteger(c) || c < 0) return NextResponse.json({ error: 'Importe no válido' }, { status: 400 })
    cambios.importe_centimos = c
  }
  if ('iva_pct' in body) {
    const v = Number(body.iva_pct)
    if (!Number.isInteger(v) || v < 0 || v > 100) return NextResponse.json({ error: 'IVA no válido' }, { status: 400 })
    cambios.iva_pct = v
  }
  // Las tres fechas admiten `null` a propósito: desmarcar «cobrada» es la
  // corrección más probable de todas —se marca por error y hay que poder
  // deshacerlo—, y sin el null explícito no habría forma de volver atrás.
  for (const k of ['emitida_el', 'vence_el', 'cobrada_el'] as const) {
    if (!(k in body)) continue
    const v = body[k]
    if (v === null) { cambios[k] = null; continue }
    if (typeof v !== 'string' || !DIA.test(v)) return NextResponse.json({ error: `Fecha no válida: ${k}` }, { status: 400 })
    cambios[k] = v
  }
  if (Object.keys(cambios).length === 0) return NextResponse.json({ error: 'Nada que cambiar' }, { status: 400 })
  cambios.updated_at = new Date().toISOString()

  // Se lee lo que hay para comprobar la coherencia de las fechas contra los
  // valores FINALES, no contra los que vengan en el cuerpo: un PATCH que solo
  // manda `vence_el` no trae la emisión, y comparar contra undefined deja pasar
  // una factura que vence antes de existir.
  const { data: previa, error: eLeer } = await ctx.admin
    .from('facturas').select('emitida_el, vence_el').eq('id', id).maybeSingle()
  if (eLeer) return NextResponse.json({ error: eLeer.message }, { status: 500 })
  if (!previa) return NextResponse.json({ error: 'Esa factura no existe' }, { status: 404 })
  const emitida = (cambios.emitida_el as string) ?? previa.emitida_el
  const vence = 'vence_el' in cambios ? (cambios.vence_el as string | null) : previa.vence_el
  if (vence && emitida && vence < emitida) {
    return NextResponse.json({ error: 'La fecha de vencimiento es anterior a la de emisión' }, { status: 400 })
  }

  const { data, error } = await ctx.admin.from('facturas').update(cambios).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: mensajeDeError(error) }, { status: codigoHttpDeError(error) })
  return NextResponse.json(data)
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (ctx.role !== 'owner') return NextResponse.json({ error: 'Solo el propietario factura' }, { status: 403 })

  const { id } = await params
  const { error, count } = await ctx.admin.from('facturas').delete({ count: 'exact' }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Cero filas borradas NO es un éxito: un id equivocado respondería 200 y quien
  // lo pidió se quedaría creyendo que la factura ya no está.
  if (!count) return NextResponse.json({ error: 'Esa factura no existe' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
