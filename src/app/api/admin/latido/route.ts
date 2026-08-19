import { createClient, createAdminClient } from '@/lib/supabase/server'
import { leerLatidos } from '@/lib/reglaRows'
import { NextResponse } from 'next/server'

// ─────────────────────────────────────────────────────────────────────────────
// ¿Sigue corriendo lo automático?
//
// Es la pregunta que no se podía responder desde dentro de la app. El 18 de
// agosto el cron horario estuvo muerto un día entero y nadie lo notó, porque
// «hoy no ha llegado correo» y «hace ocho horas que no se ejecuta» se ven
// exactamente igual desde la Bandeja.
//
// Para CUALQUIERA con sesión, no solo el propietario: si el correo del buzón
// compartido deja de entrar, afecta a las siete personas, y quien lo nota
// primero es quien está esperando un correo — no necesariamente el jefe.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cada cuánto DEBERÍA correr cada proceso, en minutos. De aquí sale el «lleva
 * demasiado».
 *
 * TIENE QUE CUADRAR CON `vercel.json`. Si aquí pone un día y el cron corre los
 * miércoles, el panel avisa de una avería que no existe desde el jueves hasta el
 * miércoles siguiente — y un aviso que salta sin motivo enseña a ignorar los
 * avisos, que es justo lo contrario de para lo que existe este panel.
 */
const CADENCIA: Record<string, number> = {
  'sync-colabs': 60,
  copia: 7 * 24 * 60,
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()

  try {
    const latidos = await leerLatidos(admin)
    const ahora = Date.now()

    const procesos = Object.entries(CADENCIA).map(([tarea, minutos]) => {
      const l = latidos.find(x => x.tarea === tarea)
      const en = l?.en ? Date.parse(l.en) : null
      const minutosDesde = en ? Math.round((ahora - en) / 60000) : null
      return {
        tarea,
        en: l?.en || null,
        ok: l?.ok ?? null,
        detalle: l?.detalle ?? null,
        // Margen del doble de su cadencia antes de dar la alarma: un retraso de
        // unos minutos es normal y avisar de eso enseña a ignorar el aviso.
        // Nunca late = null y no `true`: puede ser que se acabe de desplegar.
        retrasado: minutosDesde == null ? null : minutosDesde > minutos * 2,
        minutosDesde,
      }
    })

    return NextResponse.json({ procesos })
  } catch (e) {
    // «No pude leer los latidos» NO puede pintarse como «nada ha corrido»: sería
    // el mismo fallo que este endpoint existe para destapar.
    const motivo = e instanceof Error ? e.message : String(e)
    console.error('[admin/latido] no se pudieron leer los latidos:', motivo)
    return NextResponse.json({ error: motivo }, { status: 500 })
  }
}
