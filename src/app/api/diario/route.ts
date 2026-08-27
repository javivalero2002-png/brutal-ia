import { createClient, createAdminClient } from '@/lib/supabase/server'
import { instanteEnMadrid } from '@/lib/horaMadrid'
import { todayKey, localDayKey, ventanaDelDia, esTareaDe, diarioTieneAlgo } from '@/components/shared/helpers'
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

  // Las tareas del día viajan con el diario, no en una segunda petición: la
  // sección las pinta juntas —quién fichó y qué sacó adelante— y separarlas haría
  // que la mitad de la pantalla llegara tarde.
  const [{ data, error }, { data: equipo, error: errEquipo }, { data: tareas, error: errTareas }] = await Promise.all([
    admin.from('diario')
      .select('*, autor:profiles!user_id(id,name,initials,avatar_color)')
      .eq('dia', dia)
      .order('entrada_at', { ascending: true, nullsFirst: false }),
    admin.from('profiles').select('id,name,initials,avatar_color,role'),
    // Completadas ESE día. `completed_at` es cuándo se terminó; `updated_at`
    // contaría como trabajo de hoy cualquier retoque posterior.
    admin.from('tasks')
      .select('id,text,level,assigned_to,co_assigned_to,completed_at')
      .eq('done', true)
      // Con margen: el día que se quiere es de MADRID y `completed_at` es UTC.
      // Se acota abajo con `localDayKey`, que es lo único que sabe a qué día de
      // Madrid pertenece un instante. El `.lt(...23:59:59Z)` de antes, además de
      // desplazar el día, se comía el último segundo.
      .gte('completed_at', ventanaDelDia(dia).desde)
      .lte('completed_at', ventanaDelDia(dia).hasta),
  ])

  // Ningún error se disfraza de lista vacía: "nadie ha fichado" y "no se pudo
  // leer" se verían igual, que es el bug que este repo ya ha pagado.
  const fallo = error || errEquipo || errTareas
  if (fallo) return NextResponse.json({ error: fallo.message }, { status: 500 })

  // El día de Madrid al que pertenece de verdad cada tarea.
  const tareasDelDia = (tareas ?? []).filter(t => t.completed_at && localDayKey(t.completed_at) === dia)

  const entradas = data ?? []
  // Una fila por persona, tenga diario, tareas o las dos cosas. Quien cerró tres
  // tareas sin escribir el diario también trabajó ese día.
  const porPersona = (equipo ?? [])
    .map(p => ({
      persona: p,
      entrada: entradas.find(e => e.user_id === p.id) ?? null,
      tareas: tareasDelDia.filter(t => esTareaDe(t, p)),
    }))
    // `diarioTieneAlgo` y no «la fila existe»: abrir Fichar y borrar lo escrito
    // deja una fila con `entrada: ''` y todo lo demás a null, y esa fila se
    // contaba como un día de trabajo de esa persona.
    .filter(x => diarioTieneAlgo(x.entrada) || x.tareas.length > 0)

  return NextResponse.json({ dia, entradas, porPersona })
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
  const campos = pick(body, ['entrada', 'cierre', 'animo']) as { entrada?: string; cierre?: string; animo?: string }
  // `animo` va por `pick`, o sea que puede llegar cualquier cosa. La columna tiene
  // un CHECK, así que un valor fuera de la lista NO deja un dato raro: hace rebotar
  // el upsert entero y se pierde el cierre del día. Es el mismo fallo que ya vivió
  // meses con `tasks.level` — ver CLAUDE.md—, así que se valida aquí y punto.
  const ANIMOS = ['productivo', 'normal', 'bloqueado']
  if (campos.animo !== undefined && campos.animo !== null && !ANIMOS.includes(campos.animo)) {
    return NextResponse.json({ error: 'Ánimo no válido' }, { status: 400 })
  }
  // `borrador` NO se guarda: solo decide si esto cuenta como fichar. El
  // autoguardado escribe el texto cada pocos segundos mientras se teclea, y sin
  // esto cada pulsación habría puesto la hora de entrada — que debe ser cuándo
  // empezaste, no cuándo tocaste el teclado por última vez.
  const esBorrador = body?.borrador === true

  // El día viene del cuerpo. Hacia atrás porque se te pasó el lunes y lo rellenas
  // el martes; hacia ADELANTE porque planificar la semana es la mitad de para qué
  // sirve esto.
  //
  // El límite que NO se mueve: el usuario sale de la sesión, nunca del cuerpo. Eso
  // es lo que impide escribir en el día de otro, y era el motivo real por el que
  // el día estaba fijado aquí.
  const hoy = todayKey()
  const dia = typeof body?.dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.dia) ? body.dia : hoy
  const esFuturo = dia > hoy
  const ahora = new Date().toISOString()

  const admin = await createAdminClient()

  // Se lee antes para no pisar la hora de fichaje al editar por segunda vez: la
  // hora de entrada es cuándo empezaste, no cuándo tocaste el texto por última vez.
  const { data: previo, error: errLeer } = await admin
    .from('diario').select('entrada_at, cierre_at').eq('user_id', user.id).eq('dia', dia).maybeSingle()
  if (errLeer) return NextResponse.json({ error: errLeer.message }, { status: 500 })

  const fila: Record<string, unknown> = { user_id: user.id, dia, updated_at: ahora, ...campos }
  // Un día futuro se PLANIFICA, no se ficha: se guardan los objetivos pero no la
  // hora de entrada. Fichar es haber estado, y el jueves todavía no has estado —
  // poner la hora ahí convertiría un plan en un registro de trabajo falso, que es
  // justo lo que no debe poder hacerse.
  if (!esBorrador && !esFuturo && campos.entrada !== undefined && !previo?.entrada_at) fila.entrada_at = ahora

  // CERRAR EL DÍA ES UN GESTO, NO UN EFECTO SECUNDARIO DE ESCRIBIR.
  //
  // Antes la hora de salida se sellaba porque llegara texto en `cierre`. Dos cosas
  // salían mal:
  //
  //   · pulsar TERMINAR sin haber escrito el balance no cerraba nada — el cliente
  //     ni siquiera llegaba a llamar—, así que el botón de parar no paraba;
  //   · y escribir el balance SIN haber fichado dejaba `cierre_at` con `entrada_at`
  //     a null. Si luego fichabas, `entrada_at > cierre_at`, la resta salía
  //     negativa y el reloj se quedaba roto PARA SIEMPRE: no hay ninguna ruta que
  //     ponga `cierre_at` a null.
  //
  // Ahora se cierra con `cerrar: true` y punto, y no se puede cerrar un día que no
  // se abrió. El texto del balance sigue guardándose por su cuenta, como cualquier
  // otro campo.
  const quiereCerrar = body?.cerrar === true
  if (quiereCerrar && !esBorrador && !esFuturo) {
    if (!previo?.entrada_at) {
      return NextResponse.json(
        { error: 'No puedes cerrar un día que no has abierto' }, { status: 400 })
    }
    if (!previo?.cierre_at) {
      // UN DÍA PASADO NO SE CIERRA «AHORA».
      //
      // Aquí se estampaba `ahora` siempre. Cerrar ayer hoy a las 16:40 habiendo
      // fichado ayer a las 09:12 daba una jornada de 31 HORAS — y esa cifra va al
      // resumen del equipo y al panel del jefe. La duración se calcula restando
      // `cierre_at - entrada_at` (resumenEquipo.ts, RelojJornada), así que un
      // cierre con la fecha de hoy no es un detalle: es una mentira con número.
      //
      // Para un día pasado la hora es OBLIGATORIA. Podría inventarse una —el
      // final del día, ocho horas después— pero inventarle horas trabajadas a
      // alguien es peor que pedirle que las escriba: la pantalla las trae ya
      // rellenas con la última señal real de ese día, así que cuesta un toque.
      if (dia < hoy) {
        const hora = typeof body?.cierre_hora === 'string' ? body.cierre_hora.trim() : ''
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) {
          return NextResponse.json(
            { error: 'Para cerrar un día pasado hace falta la hora en que terminaste' }, { status: 400 })
        }
        const instante = instanteEnMadrid(dia, hora)
        if (!instante) {
          return NextResponse.json({ error: 'Esa hora no existe en ese día' }, { status: 400 })
        }
        // Y que sea posible: después de fichar y dentro de SU día. Sin esto, el
        // cliente decide cuántas horas trabajó y el número deja de valer nada.
        if (new Date(instante) <= new Date(previo.entrada_at as string)) {
          return NextResponse.json(
            { error: 'Terminaste antes de fichar: revisa la hora' }, { status: 400 })
        }
        fila.cierre_at = instante
      } else {
        fila.cierre_at = ahora
      }
    }
  }

  const { data, error } = await admin
    .from('diario')
    .upsert(fila, { onConflict: 'user_id,dia' })
    .select('*, autor:profiles!user_id(id,name,initials,avatar_color)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
