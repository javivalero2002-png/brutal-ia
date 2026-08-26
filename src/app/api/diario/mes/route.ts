import { createClient, createAdminClient } from '@/lib/supabase/server'
import { haFichado, normalizarObjetivo } from '@/components/shared/helpers'
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
    .select('dia, user_id, entrada, entrada_at, cierre_at, autor:profiles!user_id(id,name,initials,avatar_color)')
    // `like` sobre 'YYYY-MM-%' en vez de un rango de fechas: la columna es texto
    // y el orden lexicográfico de un ISO coincide con el cronológico, así que el
    // prefijo basta y no hay que calcular el último día del mes.
    .like('dia', `${mes}-%`)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Una entrada por día, con quién estuvo. Se agrupa aquí y no en el cliente para
  // que el calendario reciba justo lo que pinta.
  // LAS TAREAS DEL MES, para saber qué objetivos se cumplieron DE VERDAD.
  //
  // Antes esto solo leía `diario`, así que no había forma de saberlo: el panel
  // «Resumen semanal» enseñaba `cerrados` bajo la etiqueta «Objetivos completados»,
  // y `cerrados` son DÍAS CERRADOS. El porcentaje salía de dividir días entre
  // objetivos. El propio comentario del cliente ya decía «el porcentaje es de
  // OBJETIVOS, no de días» mientras el código hacía lo contrario.
  //
  // `cerrados` se queda como está —el calendario lo usa para «todos cerraron», y
  // ahí sí significa días— y se añade `objetivosHechos` al lado.
  const { data: tareas, error: errT } = await admin
    .from('tasks')
    .select('text, done, diario_dia, diario_objetivo')
    .like('diario_dia', `${mes}-%`)
  if (errT) {
    console.error('[diario/mes] no se pudieron leer las tareas:', errT.message)
    return NextResponse.json({ error: errT.message }, { status: 500 })
  }
  const hechasPorDia = new Map<string, Set<string>>()
  for (const t of tareas ?? []) {
    if (!t.done || !t.diario_dia) continue
    const s = hechasPorDia.get(t.diario_dia as string) ?? new Set<string>()
    // Por el vínculo y, si no lo hay, por el texto — el mismo orden de ramas que
    // usa el Diario para pintar la burbuja verde.
    if (t.diario_objetivo) s.add(normalizarObjetivo(t.diario_objetivo as string))
    if (t.text) s.add(normalizarObjetivo(t.text as string))
    hechasPorDia.set(t.diario_dia as string, s)
  }

  const porDia: Record<string, { personas: unknown[]; objetivos: number; objetivosHechos: number; cerrados: number }> = {}
  for (const fila of data ?? []) {
    const d = fila.dia as string
    if (!porDia[d]) porDia[d] = { personas: [], objetivos: 0, objetivosHechos: 0, cerrados: 0 }
    // SOLO QUIEN FICHÓ DE VERDAD. Antes entraba cualquier fila, y el guardado
    // automático del borrador deja filas vacías con solo abrir la sección: la
    // racha contaba 3 días seguidos sobre cero días fichados.
    if (haFichado(fila as { entrada_at?: string | null })) porDia[d].personas.push(fila.autor)
    const suyos = (fila.entrada || '').split('\n').map((l: string) => l.trim()).filter(Boolean)
    porDia[d].objetivos += suyos.length
    const hechas = hechasPorDia.get(d)
    if (hechas) porDia[d].objetivosHechos += suyos.filter((o: string) => hechas.has(normalizarObjetivo(o))).length
    if (fila.cierre_at) porDia[d].cerrados++
  }

  return NextResponse.json({ mes, dias: porDia })
}
