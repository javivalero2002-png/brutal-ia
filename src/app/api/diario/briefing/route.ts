import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getAuthCtx } from '@/lib/authz'
import { todayKey, localDayKey } from '@/components/shared/helpers'
import { NextRequest, NextResponse } from 'next/server'

// Lee varios días de diario y las tareas de ese tramo. Sin llamadas al modelo:
// el resumen se compone con los datos, que es lo que un jefe quiere ver —quién
// hizo qué— y no una paráfrasis que puede inventarse un matiz.
export const maxDuration = 30

/**
 * Briefing del equipo: qué se propuso y qué hizo cada uno, por día o por semana.
 *
 * SOLO OWNER. Es una vista agregada del trabajo de otras personas: en una app
 * donde todo lo demás es compartido a propósito, esto sí es distinto — leer el
 * diario de un compañero es una cosa y tener un panel de rendimiento de todos es
 * otra. El rol se resuelve en el servidor, como el resto de la app.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ctx = await getAuthCtx()
  if (ctx?.role !== 'owner') {
    return NextResponse.json({ error: 'Solo el propietario puede ver el briefing del equipo' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const rango = searchParams.get('rango') === 'semana' ? 'semana' : 'dia'

  // Los días del tramo, como claves 'YYYY-MM-DD' de Madrid. Se calculan restando
  // días a la clave de HOY, no a un Date: un timestamp menos 7 días cruza el
  // cambio de hora y se sale por un día en octubre y en marzo.
  const hoy = todayKey()
  const dias: string[] = []
  const n = rango === 'semana' ? 7 : 1
  for (let i = 0; i < n; i++) {
    // Mediodía UTC como ancla: a esa hora Madrid va por la tarde, así que restar
    // días nunca cruza una frontera de día ni la tropieza el cambio de hora. Y el
    // día se saca con `localDayKey`, no cortando el ISO — cortar da el día en UTC,
    // que a partir de las ~22:00 de Madrid ya es el siguiente. Hay una regla que
    // lo prohíbe en todo el repo, y cazó este mismo código al escribirlo.
    const d = new Date(`${hoy}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - i)
    dias.push(localDayKey(d))
  }
  const desde = dias[dias.length - 1]

  const admin = await createAdminClient()

  const [{ data: entradas, error: errDiario }, { data: equipo, error: errEquipo }, { data: tareas, error: errTareas }] =
    await Promise.all([
      admin.from('diario')
        .select('*, autor:profiles!user_id(id,name,initials,avatar_color)')
        .in('dia', dias)
        .order('dia', { ascending: false }),
      admin.from('profiles').select('id,name,initials,avatar_color'),
      // Completadas dentro del tramo. `completed_at` es el que dice CUÁNDO se
      // terminó; usar `updated_at` contaría como trabajo de hoy cualquier retoque.
      admin.from('tasks')
        .select('id,text,done,assigned_to,completed_at,level')
        .eq('done', true)
        .gte('completed_at', `${desde}T00:00:00Z`),
    ])

  // Ningún fallo se disfraza de lista vacía: «nadie hizo nada» y «no pude leerlo»
  // son cosas distintas, y confundirlas es como un error vive semanas.
  const fallo = errDiario || errEquipo || errTareas
  if (fallo) return NextResponse.json({ error: fallo.message }, { status: 500 })

  const porPersona = (equipo ?? []).map(p => {
    const suyas = (entradas ?? []).filter(e => e.user_id === p.id)
    const completadas = (tareas ?? []).filter(t => t.assigned_to === p.id)
    const objetivos = suyas.flatMap(e =>
      (e.entrada || '').split('\n').map((l: string) => l.replace(/^[-•*\s]+/, '').trim()).filter(Boolean))
    return {
      persona: p,
      dias: suyas.length,
      // Días que llegó a cerrar: un día abierto y nunca cerrado es una señal, no ruido.
      cerrados: suyas.filter(e => e.cierre_at).length,
      objetivos: objetivos.length,
      completadas: completadas.length,
      entradas: suyas.map(e => ({ dia: e.dia, entrada: e.entrada, cierre: e.cierre, entrada_at: e.entrada_at, cierre_at: e.cierre_at })),
      tareas: completadas.map(t => ({ id: t.id, text: t.text, level: t.level })),
    }
  })
  // Quien no ha fichado ni cerrado nada no ensucia el panel, pero se cuenta aparte.
  const activos = porPersona.filter(p => p.dias > 0 || p.completadas > 0)

  return NextResponse.json({
    rango,
    desde,
    hasta: hoy,
    dias,
    equipo: activos,
    sinActividad: porPersona.filter(p => !activos.includes(p)).map(p => p.persona.name),
    total: {
      objetivos: activos.reduce((n, p) => n + p.objetivos, 0),
      completadas: activos.reduce((n, p) => n + p.completadas, 0),
      diasCerrados: activos.reduce((n, p) => n + p.cerrados, 0),
    },
  })
}
