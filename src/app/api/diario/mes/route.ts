import { createClient, createAdminClient } from '@/lib/supabase/server'
import { todayKey } from '@/components/shared/helpers'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Resumen de un MES para el calendario del diario: qué días fichó quién.
 *
 * Devuelve solo lo que el calendario pinta —una celda por día con las personas y
 * un par de recuentos— y no el texto de las entradas. Un mes entero de diarios
 * completos serían decenas de KB para dibujar unos puntos de colores.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const pedido = searchParams.get('mes')
  // 'YYYY-MM'. Se valida la forma porque entra en un filtro de la consulta.
  const mes = pedido && /^\d{4}-\d{2}$/.test(pedido) ? pedido : todayKey().slice(0, 7)

  const admin = await createAdminClient()
  const { data, error } = await admin
    .from('diario')
    .select('dia, user_id, entrada, cierre_at, autor:profiles!user_id(id,name,initials,avatar_color)')
    // `like` sobre 'YYYY-MM-%' en vez de un rango de fechas: la columna es texto
    // y el orden lexicográfico de un ISO coincide con el cronológico, así que el
    // prefijo basta y no hay que calcular el último día del mes.
    .like('dia', `${mes}-%`)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Una entrada por día, con quién estuvo. Se agrupa aquí y no en el cliente para
  // que el calendario reciba justo lo que pinta.
  const porDia: Record<string, { personas: unknown[]; objetivos: number; cerrados: number }> = {}
  for (const fila of data ?? []) {
    const d = fila.dia as string
    if (!porDia[d]) porDia[d] = { personas: [], objetivos: 0, cerrados: 0 }
    porDia[d].personas.push(fila.autor)
    porDia[d].objetivos += (fila.entrada || '').split('\n').filter((l: string) => l.trim()).length
    if (fila.cierre_at) porDia[d].cerrados++
  }

  return NextResponse.json({ mes, dias: porDia })
}
