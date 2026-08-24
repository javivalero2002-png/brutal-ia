import { createAdminClient } from '@/lib/supabase/server'
import { sendPushToUser, canSendPush } from '@/lib/push'
import { todayKey, madridHour } from '@/components/shared/helpers'
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

// ─────────────────────────────────────────────────────────────────────────────
// «CIERRA EL DÍA», A LAS 20:00.
//
// Javi: «a las 8 de la tarde, si no has cerrado el día y lo has empezado, te
// tiene que mandar una notificación».
//
// Las DOS condiciones importan, y saltarse una lo convierte en ruido:
//
//   · lo has EMPEZADO — hay objetivos escritos. A quien no fichó por la mañana ya
//     se le avisó a las 10:00; repetirlo por la tarde es regañar dos veces.
//   · y NO lo has CERRADO — no hay `cierre_at`. Si ya cerraste, no hay nada que
//     pedirte.
//
// El cierre es lo que da valor al panel del equipo: sin él, el día de esa persona
// queda con sus objetivos y sin su balance, y ni el briefing ni Harvey pueden
// decir qué hizo de verdad. De ahí que Javi lo llame vital.
//
// La hora se comprueba con `madridHour()` y no con la del servidor, que va en UTC.
// El cron está registrado DOS veces en `vercel.json` (18:00 y 19:00 UTC) porque
// España cambia de hora: una de las dos cae en las 20:00 de Madrid y la otra se
// descarta aquí. Es el mismo patrón que el recordatorio de las 10:00.
// ─────────────────────────────────────────────────────────────────────────────

const HORA_CIERRE = 20

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const hora = madridHour()
  if (hora !== HORA_CIERRE) {
    return NextResponse.json({ ok: true, saltado: true, motivo: `en Madrid son las ${hora}, no las ${HORA_CIERRE}` })
  }

  // `todayKey()` y no `new Date().toISOString()`: a las 20:00 de Madrid en verano
  // son las 18:00 UTC y coincide, pero en cuanto alguien mueva la hora deja de
  // coincidir y el aviso miraría el día equivocado.
  const dia = todayKey()
  const diaSemana = new Date(`${dia}T12:00:00`).getDay()
  if (diaSemana === 0 || diaSemana === 6) {
    return NextResponse.json({ ok: true, saltado: true, motivo: 'fin de semana' })
  }

  const admin = await createAdminClient()

  // Se piden las tres columnas y se filtra aquí: `cierre_at is null` en la consulta
  // dejaría fuera los días cerrados, sí, pero también haría invisible el caso de
  // que la consulta falle. Con el error a la vista, un fallo se distingue de «no
  // hay nadie a quien avisar», que es la confusión que este repo persigue.
  const { data: dias, error } = await admin
    .from('diario')
    .select('user_id, entrada, cierre_at')
    .eq('dia', dia)

  if (error) {
    console.error('[cerrar] no se pudo leer el diario:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const pendientes = (dias || []).filter(d =>
    ((d.entrada as string | null) || '').trim().length > 0 && !d.cierre_at)

  let avisados = 0
  for (const d of pendientes) {
    const uid = d.user_id as string
    // Una vez por persona y día. Si el cron se dispara dos veces —o si algún día
    // se añade otra hora— no se avisa dos veces a la misma persona.
    if (!(await canSendPush(admin, `cerrar:${dia}:${uid}`, 12 * 60 * 60 * 1000))) continue
    try {
      await sendPushToUser(admin, uid, {
        title: 'Cierra tu día',
        body: 'Cuenta en dos líneas qué has sacado adelante hoy. Es lo que ve el equipo mañana.',
        url: '/dashboard?s=diario',
        tag: 'recordatorio-cerrar',
        categoria: 'fichaje',
      })
      avisados++
    } catch (err) {
      console.error('[cerrar] el push falló para', uid, err)
    }
  }

  return NextResponse.json({ ok: true, dia, avisados, pendientes: pendientes.length })
}
