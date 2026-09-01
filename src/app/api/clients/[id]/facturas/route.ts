import { getAuthCtx } from '@/lib/authz'
import { codigoHttpDeError, mensajeDeError } from '@/lib/respuestaDb'
import { sinControl } from '@/components/shared/helpers'
import { NextRequest, NextResponse } from 'next/server'

// Las facturas de un cliente.
//
// LAS LEE cualquiera con sesión —el MRR y la facturación de cada cliente ya son
// visibles para el equipo, así que esconder las facturas sería una barrera de
// mentira—, pero solo las ESCRIBE el propietario, igual que `clients.revenue`.
// Ese dato ya tenía dos puertas (POST y PATCH) y una se quedó sin cerrojo durante
// meses: aquí las dos comprueban el rol en la primera línea.

const DIA = /^\d{4}-\d{2}-\d{2}$/

/**
 * ¿Falta la migración?
 *
 * PGRST205 es «la tabla no existe» de PostgREST. Sin distinguirlo, esta pantalla
 * daría un 500 y un «Error» a secas, y el camino desde ahí hasta «hay que pegar un
 * SQL en Supabase» es exactamente el que ya costó meses con
 * `content_agenda.feedback`: la revisión con cliente devolvía 404 y parecía que la
 * página no existía. El síntoma tiene que nombrar la causa.
 */
const faltaLaTabla = (error: { code?: string | null } | null | undefined) => error?.code === 'PGRST205'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data, error } = await ctx.admin
    .from('facturas').select('*').eq('client_id', id).order('emitida_el', { ascending: false })

  // Sin la tabla se contesta 200 con `disponible: false` y no un error: la ficha
  // del cliente entera se pinta igual y solo ese bloque dice qué falta. Un 500 aquí
  // tumbaría media pantalla por una función que todavía no está instalada.
  if (faltaLaTabla(error)) return NextResponse.json({ disponible: false, facturas: [] })
  // Y un fallo de verdad NO se disfraza de lista vacía: «este cliente no tiene
  // facturas» y «no se han podido leer» se verían igual, que es el bug que este
  // repo ya ha pagado.
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ disponible: true, facturas: data ?? [] })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (ctx.role !== 'owner') return NextResponse.json({ error: 'Solo el propietario factura' }, { status: 403 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))

  // El importe llega ya en céntimos y ENTERO. Se valida aquí en vez de confiar en
  // el CHECK de la columna: un decimal rebotaría con un 22P02 críptico, y un
  // importe con decimales de céntimo es un dato mal formado, no un error de base.
  const centimos = Number(body?.importe_centimos)
  if (!Number.isInteger(centimos) || centimos < 0) {
    return NextResponse.json({ error: 'Importe no válido' }, { status: 400 })
  }
  const emitida = typeof body?.emitida_el === 'string' && DIA.test(body.emitida_el) ? body.emitida_el : null
  if (!emitida) return NextResponse.json({ error: 'Falta la fecha de emisión' }, { status: 400 })
  const vence = typeof body?.vence_el === 'string' && DIA.test(body.vence_el) ? body.vence_el : null
  // Vencer ANTES de emitirse no es un caso raro, es un dedazo — y deja una factura
  // nacida vencida, que aparece en rojo en el panel el mismo día que se crea.
  if (vence && vence < emitida) {
    return NextResponse.json({ error: 'La fecha de vencimiento es anterior a la de emisión' }, { status: 400 })
  }
  const iva = Number.isInteger(body?.iva_pct) && body.iva_pct >= 0 && body.iva_pct <= 100 ? body.iva_pct : 21

  const { data, error } = await ctx.admin.from('facturas').insert({
    client_id: id,
    // `sinControl` en todo lo que es texto libre: un byte nulo pegado desde un PDF
    // tumbaba el insert con un 500 crudo. Son ocho gemelos ya arreglados y este
    // habría sido el noveno.
    numero: sinControl(body?.numero) || null,
    concepto: sinControl(body?.concepto) || null,
    notas: sinControl(body?.notas) || null,
    importe_centimos: centimos,
    iva_pct: iva,
    emitida_el: emitida,
    vence_el: vence,
    cobrada_el: typeof body?.cobrada_el === 'string' && DIA.test(body.cobrada_el) ? body.cobrada_el : null,
    created_by: ctx.userId,
  }).select().single()

  if (faltaLaTabla(error)) {
    return NextResponse.json(
      { error: 'Falta aplicar la migración 20260901_facturas.sql en Supabase: la tabla de facturas todavía no existe.' },
      { status: 503 })
  }
  if (error) return NextResponse.json({ error: mensajeDeError(error) }, { status: codigoHttpDeError(error) })
  return NextResponse.json(data)
}
