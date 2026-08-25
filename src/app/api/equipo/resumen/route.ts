import { NextRequest, NextResponse } from 'next/server'
import { getAuthCtx } from '@/lib/authz'
import { checkAiRateLimit } from '@/lib/rate-limit'
import { comoVaLaPersona, type DiaDeTrabajo } from '@/lib/ai'
import { esTareaDe } from '@/components/shared/helpers'
import { localDayKey, ventanaDelDia } from '@/components/shared/helpers'

export const maxDuration = 60

/**
 * «¿Qué tal va esta persona?» — el texto que redacta la IA para el panel de equipo.
 *
 * SOLO PROPIETARIO, comprobado en el servidor. Es una valoración del trabajo de un
 * compañero: que la lea cualquiera cambia lo que es la herramienta. Mismo criterio
 * que `/api/diario/briefing`.
 *
 * El rango llega por query y se acota aquí: sin tope, una petición con `dias=3650`
 * arrastraría el diario entero a una llamada al modelo.
 */
export async function GET(request: NextRequest) {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (ctx.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('user') || ''
  const desde = searchParams.get('desde') || ''
  const hasta = searchParams.get('hasta') || ''
  if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    return NextResponse.json({ error: 'Faltan user, desde o hasta (YYYY-MM-DD)' }, { status: 400 })
  }
  if (desde > hasta) return NextResponse.json({ error: 'El rango va al revés' }, { status: 400 })

  const admin = ctx.admin

  // Tope de peticiones, como todas las rutas que llaman al modelo. Aqui el riesgo
  // no es un abuso desde fuera —solo entra un propietario— sino el dedo: el boton
  // esta en una fila por persona, y seis toques seguidos son seis llamadas.
  if (await checkAiRateLimit(admin, ctx.userId, 'equipo')) {
    return NextResponse.json({ error: 'Demasiadas seguidas. Espera un momento.' }, { status: 429 })
  }

  const [{ data: quien, error: errQuien }, { data: diario, error: errDiario }, { data: tareas, error: errTareas }] =
    await Promise.all([
      admin.from('profiles').select('id, name').eq('id', userId).maybeSingle(),
      admin.from('diario')
        .select('dia, entrada, cierre, entrada_at, cierre_at, animo')
        .eq('user_id', userId).gte('dia', desde).lte('dia', hasta)
        .order('dia', { ascending: true }),
      // Se piden las de TODOS y se filtran con `esTareaDe`, que es la única forma
      // de contar también las co-asignadas: en la base son dos columnas distintas.
      admin.from('tasks')
        .select('id, text, assigned_to, co_assigned_to, completed_at')
        .eq('done', true)
        .gte('completed_at', ventanaDelDia(desde).desde)
        .lte('completed_at', ventanaDelDia(hasta).hasta),
    ])

  // Los tres errores se miran: supabase-js no lanza, y sin esto un fallo de
  // consulta llega al modelo como «esta persona no ha hecho nada», que es una
  // afirmación falsa sobre el trabajo de alguien.
  if (errQuien || errDiario || errTareas) {
    console.error('[equipo/resumen] consulta fallida —',
      errQuien?.message || errDiario?.message || errTareas?.message)
    return NextResponse.json({ error: 'No se pudieron leer los datos' }, { status: 500 })
  }
  if (!quien) return NextResponse.json({ error: 'Esa persona no existe' }, { status: 404 })

  const suyas = (tareas || []).filter(t => esTareaDe(t, { id: userId }))

  // LOS DIAS SALEN DE LAS DOS COSAS, no solo del diario.
  //
  // Esto mapeaba sobre `diario` y colgaba las tareas DENTRO de cada dia, asi que un
  // dia trabajado sin fichar no existia — y con el, todas las tareas que se
  // cerraron ese dia. En el caso limite (una semana entera cerrando tareas sin
  // escribir nada en Fichar) `dias` salia vacio y `comoVaLaPersona` contestaba, sin
  // llamar siquiera al modelo, «No hay nada escrito de Pablo en este tramo: ni
  // objetivos, ni cierres, NI TAREAS COMPLETADAS».
  //
  // Eso lo lee un jefe sobre el trabajo de alguien. No es un hueco: es una
  // afirmacion, y es falsa — con las tareas de esa persona pintadas justo al lado
  // en el mismo panel.
  const conDiario = new Map((diario || []).map(d => [d.dia as string, d]))
  const conTareas = new Set(suyas
    .map(t => t.completed_at ? localDayKey(t.completed_at as string) : null)
    .filter((x): x is string => !!x && x >= desde && x <= hasta))
  const todosLosDias = [...new Set([...conDiario.keys(), ...conTareas])].sort()

  const dias: DiaDeTrabajo[] = todosLosDias.map(clave => {
    const d = conDiario.get(clave) || { dia: clave, entrada: null, cierre: null, entrada_at: null, cierre_at: null, animo: null }
    const ini = d.entrada_at ? new Date(d.entrada_at as string) : null
    const fin = d.cierre_at ? new Date(d.cierre_at as string) : null
    const horas = ini && fin
      ? `${Math.floor((+fin - +ini) / 3600000)}h ${Math.round(((+fin - +ini) % 3600000) / 60000)}m`
      : ini ? 'sin cerrar' : null
    return {
      dia: clave,
      entrada: (d.entrada as string | null) || null,
      cierre: (d.cierre as string | null) || null,
      horas,
      animo: (d.animo as string | null) || null,
      hechas: suyas
        .filter(t => t.completed_at && localDayKey(t.completed_at as string) === clave)
        .map(t => t.text as string),
    }
  })

  const r = await comoVaLaPersona((quien.name as string) || 'Esta persona', dias)
  if (r.degraded) {
    // 503 y no un 200 con texto vacío: la pantalla tiene que poder distinguir
    // «la IA no pudo» de «no hay nada que contar», que es una respuesta legítima
    // y la da `comoVaLaPersona` sin llamar al modelo.
    return NextResponse.json({ error: 'La IA no pudo redactarlo ahora mismo' }, { status: 503 })
  }
  return NextResponse.json({ texto: r.texto, dias: dias.length })
}
