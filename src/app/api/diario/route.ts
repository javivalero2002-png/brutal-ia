import { createClient, createAdminClient } from '@/lib/supabase/server'
import { todayKey } from '@/components/shared/helpers'
import { NextRequest, NextResponse } from 'next/server'

// Solo columnas conocidas. Misma razón que en el resto de rutas: impide que un
// cliente escriba `user_id` o `dia` y se cuele en el día de otro.
const pick = (obj: any, keys: string[]) =>
  Object.fromEntries(Object.entries(obj || {}).filter(([k]) => keys.includes(k)))

/** El diario del equipo. Por defecto, hoy. */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  // El día llega del cliente solo para NAVEGAR el historial. Se valida la forma
  // antes de meterlo en la consulta: es texto y va a un filtro.
  const pedido = searchParams.get('dia')
  const dia = pedido && /^\d{4}-\d{2}-\d{2}$/.test(pedido) ? pedido : todayKey()

  const admin = await createAdminClient()
  const { data, error } = await admin
    .from('diario')
    .select('*, autor:profiles!user_id(id,name,initials,color)')
    .eq('dia', dia)
    .order('entrada_at', { ascending: true, nullsFirst: false })

  // El error NO se disfraza de lista vacía: eso hace que "nadie ha fichado" y
  // "no se pudo leer" se vean igual, que es el bug que este repo ya ha pagado.
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ dia, entradas: data ?? [] })
}

/**
 * Abre o actualiza MI día. Upsert sobre (user_id, dia).
 *
 * El `dia` y el `user_id` los pone el SERVIDOR, nunca el cuerpo: si viajaran en el
 * body, cualquiera podría escribir en el día de otro o retocar un día pasado.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const campos = pick(body, ['entrada', 'cierre']) as { entrada?: string; cierre?: string }

  const dia = todayKey()
  const ahora = new Date().toISOString()

  const admin = await createAdminClient()

  // Se lee antes para no pisar la hora de fichaje al editar por segunda vez: la
  // hora de entrada es cuándo empezaste, no cuándo tocaste el texto por última vez.
  const { data: previo, error: errLeer } = await admin
    .from('diario').select('entrada_at, cierre_at').eq('user_id', user.id).eq('dia', dia).maybeSingle()
  if (errLeer) return NextResponse.json({ error: errLeer.message }, { status: 500 })

  const fila: Record<string, unknown> = { user_id: user.id, dia, updated_at: ahora, ...campos }
  if (campos.entrada !== undefined && !previo?.entrada_at) fila.entrada_at = ahora
  if (campos.cierre !== undefined && !previo?.cierre_at) fila.cierre_at = ahora

  const { data, error } = await admin
    .from('diario')
    .upsert(fila, { onConflict: 'user_id,dia' })
    .select('*, autor:profiles!user_id(id,name,initials,color)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
