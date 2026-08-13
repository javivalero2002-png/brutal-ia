import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCalendarEvents, createCalendarEvent } from '@/lib/gmail'

// Consulta a la API de Google por cada calendario conectado: el default de
// Vercel se queda corto cuando hay varios buzones.
export const maxDuration = 60

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  // supabase-js NO lanza: devuelve { data:null, error }. Descartando el `error`,
  // una lectura caída del perfil dejaba `profile` en null, se cumplía el `if` de
  // abajo y la ruta contestaba `[]` con 200. El hook trata ese array vacío como
  // agenda vacía (useNexusData.ts:118-122) y ni siquiera enciende `loadError`:
  // el calendario se pintaba en blanco sin un solo aviso. «No tienes Gmail
  // conectado» y «no he podido comprobar si lo tienes» no pueden ser la misma
  // respuesta.
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('gmail_refresh_token, gmail_connected, gmail_colabs_refresh_token, gmail_colabs_connected')
    .eq('id', user.id)
    .single()

  // PGRST116 es «cero filas»: alguien sin perfil todavía no tiene Gmail
  // conectado, y ese caso sí es el vacío legítimo de abajo.
  if (profileErr && profileErr.code !== 'PGRST116') {
    console.error('[calendar] no se pudo leer el perfil:', profileErr.message)
    return NextResponse.json(
      { __error: 'db', error: 'No se pudo comprobar tu conexión con Google Calendar' },
      { status: 500 },
    )
  }

  if (!profile?.gmail_refresh_token || !profile?.gmail_connected) {
    return NextResponse.json([])
  }

  const coProfile = profile

  const isNoScope = (err: any) => {
    const code = Number(err?.status ?? err?.code ?? 0)
    const reason = err?.errors?.[0]?.reason ?? err?.response?.data?.error?.errors?.[0]?.reason ?? ''
    return code === 403 || code === 401 || reason === 'insufficientPermissions' || reason === 'forbidden' || reason === 'invalid_grant'
  }

  let personalEvents: any[] = []
  let personalNoScope = false
  try {
    personalEvents = await getCalendarEvents(profile.gmail_refresh_token, 3)
  } catch (err: any) {
    if (isNoScope(err)) { personalNoScope = true }
    else { console.error('Calendar GET personal error:', err?.message) }
  }

  let colabsEvents: any[] = []
  if (coProfile?.gmail_colabs_refresh_token && coProfile?.gmail_colabs_connected) {
    try {
      colabsEvents = await getCalendarEvents(coProfile.gmail_colabs_refresh_token, 3)
    } catch (err: any) {
      if (!isNoScope(err)) { console.error('Calendar GET colabs error:', err?.message) }
    }
  }

  if (personalNoScope && colabsEvents.length === 0 && !coProfile?.gmail_colabs_refresh_token) {
    return NextResponse.json({ __error: 'no_scope' })
  }

  // Merge and deduplicate by event id
  const seen = new Set<string>()
  const merged = [...personalEvents, ...colabsEvents].filter(e => {
    if (seen.has(e.id)) return false
    seen.add(e.id)
    return true
  }).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())

  return NextResponse.json(merged)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  // Gemelo del GET: sin mirar el `error`, una lectura caída del perfil se
  // anunciaba como «Gmail no conectado» y mandaba a reconectar una cuenta que ya
  // estaba conectada.
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('gmail_refresh_token, gmail_connected')
    .eq('id', user.id)
    .single()

  if (profileErr && profileErr.code !== 'PGRST116') {
    console.error('[calendar] no se pudo leer el perfil (POST):', profileErr.message)
    return NextResponse.json({ error: 'No se pudo comprobar tu conexión con Google Calendar' }, { status: 500 })
  }

  if (!profile?.gmail_refresh_token || !profile?.gmail_connected) {
    return NextResponse.json({ error: 'Gmail no conectado' }, { status: 400 })
  }

  const { title, date, time, description, attendees } = await request.json()
  if (typeof title !== 'string' || !title.trim() || !date) {
    return NextResponse.json({ error: 'Faltan título o fecha' }, { status: 400 })
  }

  // La fecha y la hora no siempre vienen de un <input type="date">: cuando el
  // evento lo propone Harvey salen de texto libre («el martes que viene») y hasta
  // ahora llegaban sin mirar hasta google.calendar.events.insert. Dos finales
  // distintos, los dos malos:
  //   · fecha basura ('martes', '2026-13-40') → Google rechaza el insert, el
  //     catch de abajo responde «Error creando evento» y el aviso culpa a Google
  //     de un fallo que estaba en lo que le mandamos.
  //   · hora basura ('10h', '25:00') → tramoHorario() hace split(':') + Number,
  //     y Number(undefined) es NaN: el evento se crea con dateTime 'NaN:NaN' o a
  //     una hora que nadie pidió, se responde 200 y nadie se entera hasta abrir
  //     el calendario.
  // Se valida aquí y se devuelve un error propio que dice qué no se entendió.
  const esFechaReal = (d: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
    // Date.UTC, no `new Date(d)` con hora local: aquí solo se comprueba que el
    // día exista de verdad (rechaza 2026-02-31, que JS desborda a marzo).
    const [y, m, dia] = d.split('-').map(Number)
    const probe = new Date(Date.UTC(y, m - 1, dia))
    return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === dia
  }
  if (typeof date !== 'string' || !esFechaReal(date)) {
    return NextResponse.json(
      { error: `No se entendió la fecha «${String(date).slice(0, 30)}» — tiene que ser AAAA-MM-DD`, code: 'fecha_invalida' },
      { status: 400 },
    )
  }
  // La hora se acepta con o sin cero delante ('9:00' es lo que suele escribir
  // Harvey y tramoHorario() ya lo rellena con pad()); lo que se rechaza es lo que
  // no es una hora: '10h', '25:00', '9:5'.
  const esHoraReal = (t: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t)
    return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59
  }
  if (time != null && time !== '' && (typeof time !== 'string' || !esHoraReal(time))) {
    return NextResponse.json(
      { error: `No se entendió la hora «${String(time).slice(0, 20)}» — tiene que ser HH:MM`, code: 'hora_invalida' },
      { status: 400 },
    )
  }

  try {
    const event = await createCalendarEvent(profile.gmail_refresh_token, {
      title, date, time, description,
      attendees: Array.isArray(attendees) ? attendees.filter((a: any) => typeof a === 'string' && a.includes('@')) : undefined,
    })
    return NextResponse.json(event)
  } catch (err: any) {
    const code = Number(err?.status ?? err?.code ?? 0)
    const reason = err?.errors?.[0]?.reason ?? err?.response?.data?.error?.errors?.[0]?.reason ?? ''
    if (code === 403 || reason === 'insufficientPermissions') {
      return NextResponse.json({ error: 'insufficient_scope' }, { status: 403 })
    }
    console.error('Calendar create error:', err?.message, code)
    return NextResponse.json({ error: 'Error creando evento' }, { status: 500 })
  }
}
