import { createAdminClient } from '@/lib/supabase/server'
import { sendPushToUser, canSendPush } from '@/lib/push'
import { todayKey, madridHour } from '@/components/shared/helpers'
import { NextRequest, NextResponse } from 'next/server'

// ─────────────────────────────────────────────────────────────────────────────
// «Son las diez: ficha y escribe tus objetivos».
//
// Javi: «todos los días todos los becarios tienen a las 10:00 que pulsar el botón
// de fichar más los objetivos que se proponen».
//
// LA HORA ES DE MADRID, NO DE UTC, y eso es la mitad del trabajo. Los crons de
// Vercel se programan en UTC, así que `0 10 * * *` sería las 10:00 de Madrid solo
// en invierno: en verano avisaría a las 12:00, dos horas tarde y todos los días
// durante siete meses. Y al revés si se compensa a mano.
//
// La solución no es adivinar el horario de verano: es programar las DOS horas UTC
// que pueden ser las 10:00 en Madrid —08:00 y 09:00— y comprobar aquí dentro cuál
// de las dos lo es de verdad. La que no lo sea sale sin hacer nada. Dos
// invocaciones al día para un aviso, y ningún cambio dos veces al año.
//
// A QUIÉN se le avisa: solo a quien NO haya fichado todavía. Avisar a quien ya lo
// hizo es lo que enseña a ignorar los avisos.
// ─────────────────────────────────────────────────────────────────────────────

export const maxDuration = 60

const HORA_FICHAJE = 10

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // La comprobación que hace que esto funcione todo el año.
  const hora = madridHour()
  if (hora !== HORA_FICHAJE) {
    return NextResponse.json({ ok: true, saltado: true, motivo: `en Madrid son las ${hora}, no las ${HORA_FICHAJE}` })
  }

  const dia = todayKey()

  // Fin de semana no se ficha. `getDay()` sobre la fecha de Madrid y no sobre
  // `new Date()`: a las 10:00 de Madrid del lunes, en UTC puede seguir siendo
  // lunes, pero construir la fecha desde el day key evita tener que pensarlo.
  const diaSemana = new Date(`${dia}T12:00:00`).getDay()
  if (diaSemana === 0 || diaSemana === 6) {
    return NextResponse.json({ ok: true, saltado: true, motivo: 'fin de semana' })
  }

  const admin = await createAdminClient()

  const { data: equipo, error: errEquipo } = await admin
    .from('profiles')
    .select('id, name')
  // El error SE MIRA: sin esto, un fallo de consulta es una lista vacía y el aviso
  // no le llega a nadie — en silencio, todos los días.
  if (errEquipo) {
    console.error('[recordatorio] no se pudo leer el equipo:', errEquipo.message)
    return NextResponse.json({ error: errEquipo.message }, { status: 500 })
  }

  const { data: yaFicharon, error: errDiario } = await admin
    .from('diario')
    .select('user_id, entrada')
    .eq('dia', dia)
  if (errDiario) {
    console.error('[recordatorio] no se pudo leer el diario:', errDiario.message)
    return NextResponse.json({ error: errDiario.message }, { status: 500 })
  }

  // «Fichado» es haber puesto objetivos, no solo haber abierto la pantalla: una
  // fila con la entrada vacía es alguien que entró y no escribió nada, que es
  // justo a quien hay que recordárselo.
  const conObjetivos = new Set(
    (yaFicharon || [])
      .filter(f => ((f.entrada as string | null) || '').trim().length > 0)
      .map(f => f.user_id as string))

  let avisados = 0
  for (const p of equipo || []) {
    if (conObjetivos.has(p.id)) continue
    // Uno al día por persona. El cron corre dos veces y solo una hace algo, pero
    // si algún día se reintenta, esto impide el segundo aviso.
    if (!(await canSendPush(admin, `fichar:${dia}:${p.id}`, 12 * 60 * 60 * 1000))) continue
    try {
      await sendPushToUser(admin, p.id, {
        title: 'Son las 10:00 — ficha tu día',
        // Dice las DOS cosas que hay que hacer, porque fichar sin objetivos deja
        // la mitad del trabajo hecho y nadie vuelve a por la otra mitad.
        body: 'Pulsa fichar y escribe los objetivos que te propones para hoy.',
        url: '/dashboard?s=diario',
        tag: 'recordatorio-fichar',
        // 'fichaje' y no 'tarea': quien silencie los avisos de tareas no debe
          // perder el recordatorio de fichar, que es otra cosa. Estaba mal
          // clasificado desde el principio.
          categoria: 'fichaje',
      })
      avisados++
    } catch (err) {
      console.error('[recordatorio] el push falló para', p.id, err)
    }
  }

  return NextResponse.json({ ok: true, dia, avisados, delEquipo: (equipo || []).length })
}
