import { getAuthCtx } from '@/lib/authz'
import { getFreeBusy } from '@/lib/gmail'
import { NextRequest, NextResponse } from 'next/server'

// CUÁNDO ESTÁ OCUPADO CADA UNO, sin decir en qué.
//
// Javi: «cuando en el calendario le das a "todo el equipo" no se ven las reuniones
// que tiene todo el equipo». El interruptor solo filtraba tareas.
//
// Se pregunta con `freeBusy` y no leyendo el calendario ajeno, y lo eligió Javi
// teniendo las tres opciones delante: devuelve INTERVALOS y nada más — ni título,
// ni asistentes, ni sitio. Para cuadrar una hora, que es la pregunta de verdad,
// «ocupado» basta; y el médico de un compañero no acaba en la pantalla de los
// demás ni en el contexto que se le manda a Harvey.
//
// Una llamada por persona: son 5. `freeBusy` es barata —no trae eventos— pero se
// declara maxDuration por si alguna cuenta tarda en refrescar el token.
export const maxDuration = 60

const DIA = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest) {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const desde = searchParams.get('desde')
  const hasta = searchParams.get('hasta')
  // La ventana llega del cliente y va a una API externa: se valida la forma antes
  // de usarla, igual que el `dia` de /api/diario.
  if (!desde || !hasta || !DIA.test(desde) || !DIA.test(hasta)) {
    return NextResponse.json({ error: 'Fechas no válidas' }, { status: 400 })
  }
  if (hasta < desde) return NextResponse.json({ error: 'La ventana está del revés' }, { status: 400 })

  const { data: perfiles, error: errPerfiles } = await ctx.admin
    .from('profiles').select('id, name, initials, avatar_color')
  // Un fallo al leer el equipo NO se disfraza de «no hay nadie ocupado»: eso es
  // exactamente lo que hace convocar una reunión encima de otra.
  if (errPerfiles) {
    console.error('[calendar/equipo] no se pudo leer el equipo:', errPerfiles.message)
    return NextResponse.json({ error: 'No se pudo leer el equipo' }, { status: 500 })
  }

  const { data: cuentas, error: errCuentas } = await ctx.admin
    .from('gmail_cuentas').select('profile_id, email, refresh_token, compartida')
  if (errCuentas) {
    console.error('[calendar/equipo] no se pudieron leer las cuentas:', errCuentas.message)
    return NextResponse.json({ error: 'No se pudieron leer las cuentas' }, { status: 500 })
  }

  // La cuenta PERSONAL de cada uno, una sola. El buzón compartido de
  // colaboraciones no tiene jornada: su calendario no dice si Pablo puede a las 5.
  const suya = new Map<string, string>()
  for (const c of cuentas || []) {
    if (c.compartida || !c.refresh_token) continue
    if (!suya.has(c.profile_id)) suya.set(c.profile_id, c.refresh_token)
  }

  const timeMin = `${desde}T00:00:00.000Z`
  // El día `hasta` entero, no hasta su medianoche: pedir hasta las 00:00 del mismo
  // día devuelve una ventana vacía, y ese es el caso normal —mirar UN día—.
  const timeMax = `${hasta}T23:59:59.999Z`

  const resultados = await Promise.allSettled(
    (perfiles || []).filter(p => suya.has(p.id)).map(async p => ({
      profile_id: p.id, name: p.name, initials: p.initials, avatar_color: p.avatar_color,
      ocupado: await getFreeBusy(suya.get(p.id)!, timeMin, timeMax),
    })),
  )

  // `allSettled` y no `all`: con `all`, el token caducado de UNA persona dejaría la
  // pantalla entera sin disponibilidad. Quien falla sale con `medido: false` y la
  // pantalla lo dice — no se pinta como libre, que sería mentir en la dirección
  // peligrosa.
  const conCuenta = (perfiles || []).filter(p => suya.has(p.id))
  const equipo = resultados.map((r, i) => r.status === 'fulfilled'
    ? { ...r.value, medido: true }
    : {
        profile_id: conCuenta[i].id, name: conCuenta[i].name,
        initials: conCuenta[i].initials, avatar_color: conCuenta[i].avatar_color,
        ocupado: [], medido: false,
      })
  for (const r of resultados) {
    if (r.status === 'rejected') console.error('[calendar/equipo] una cuenta falló:', r.reason)
  }

  return NextResponse.json({
    desde, hasta,
    // Quién no tiene Google conectado. Sin decirlo, esa persona se vería libre
    // siempre y no es que esté libre: es que no lo sabemos.
    sinCuenta: (perfiles || []).filter(p => !suya.has(p.id)).map(p => p.name),
    equipo,
  })
}
