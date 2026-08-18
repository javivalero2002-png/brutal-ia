import { createClient, createAdminClient } from '@/lib/supabase/server'
import { todayKey } from '@/components/shared/helpers'
import { NextRequest, NextResponse } from 'next/server'

// ─────────────────────────────────────────────────────────────────────────────
// Traer a HOY lo que quedó pendiente de días anteriores.
//
// Existe como ruta propia y no añadiendo `diario_dia` al PATCH general de tareas,
// que es lo que parecía más corto. El PATCH lo bloquea a propósito: con esa
// columna abierta, un cliente podría mover una tarea al día de OTRA persona y
// descuadrar el diario y los reportes de los dos. Aquí solo cabe una operación
// —mover MIS tareas sin terminar a MI hoy— y no hay parámetro que decida a qué
// día van: siempre es hoy.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((x: unknown): x is string => typeof x === 'string' && x.length > 0).slice(0, 50)
    : []
  if (!ids.length) return NextResponse.json({ error: 'Nada que traer' }, { status: 400 })

  const admin = await createAdminClient()
  const hoy = todayKey()

  // Las tres condiciones van en el UPDATE, no en una comprobación previa: así no
  // hay hueco entre mirar y escribir, y una tarea que no cumpla simplemente no se
  // toca. `assigned_to` es lo que impide mover el trabajo de otra persona; `done`
  // false, que se resucite algo ya terminado.
  const { data, error } = await admin
    .from('tasks')
    .update({ diario_dia: hoy })
    .in('id', ids)
    .eq('assigned_to', user.id)
    .eq('done', false)
    .select('id')

  // supabase-js no lanza: sin mirar el error, un fallo se leería como «0 movidas»,
  // que es indistinguible de «no había ninguna tuya».
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, movidas: (data || []).length, dia: hoy })
}
