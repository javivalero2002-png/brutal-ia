import { createAdminClient } from '@/lib/supabase/server'
import { leerLatidos, marcarLatido } from '@/lib/reglaRows'
import { CADENCIA, seHaPasado } from '@/lib/cadencia'
import { sendPushToUser } from '@/lib/push'
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

// ─────────────────────────────────────────────────────────────────────────────
// EL VIGILANTE.
//
// El panel de latido contesta «¿sigue corriendo lo automático?» — pero solo si
// vas a mirarlo. El 18 de agosto el cron horario estuvo muerto un día entero y
// nadie lo notó; el panel existía y decía la verdad, y aun así se perdió el día.
// Un panel que hay que ir a ver no es vigilancia, es un informe.
//
// Esto es la otra mitad: cuando un proceso lleva más del doble de su cadencia
// sin latir, avisa al propietario en el móvil. La categoría `averia` no se puede
// silenciar, y es a propósito — es la única señal de un fallo que no da señales.
//
// LO QUE ESTO NO PUEDE VER, y hay que decirlo: si Supabase se cae, este cron
// también se cae, porque necesita Supabase para leer los latidos y para saber a
// quién avisar. Para eso está `/api/salud`, que se mira desde FUERA. Un vigilante
// que vive dentro de la casa no avisa de que la casa se ha caído.
// ─────────────────────────────────────────────────────────────────────────────

/** Dónde se apunta a quién ya se ha avisado, para no repetirlo cada hora. */
const AVISADO_ROW = '__vigilante_avisado__'

/**
 * Cada cuánto se puede repetir el aviso de la MISMA avería, en horas.
 *
 * Sin esto, un cron caído un fin de semana son 48 avisos. Y 48 avisos de lo
 * mismo no son 48 veces más información: son cero, porque se silencia la app.
 */
const REPETIR_CADA_H = 12

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = await createAdminClient()
  let latidos
  try {
    latidos = await leerLatidos(admin)
  } catch (e) {
    // «No pude leer los latidos» NO es «todo va bien». Si esto falla, el
    // vigilante está ciego y hay que decirlo en los registros, no devolver ok.
    const motivo = e instanceof Error ? e.message : String(e)
    console.error('[vigilante] no se pudieron leer los latidos:', motivo)
    return NextResponse.json({ error: motivo }, { status: 500 })
  }

  const ahora = Date.now()
  const caidos: { tarea: string; horas: number }[] = []
  for (const tarea of Object.keys(CADENCIA)) {
    const l = latidos.find(x => x.tarea === tarea)
    const en = l?.en ? Date.parse(l.en) : null
    const minutos = en && Number.isFinite(en) ? Math.round((ahora - en) / 60000) : null
    if (seHaPasado(tarea, minutos)) caidos.push({ tarea, horas: Math.round((minutos as number) / 60) })
  }

  // Late él también. Si el vigilante se para, nadie avisa de nada — y el panel es
  // lo único que puede enseñarlo. Vigilarse a uno mismo no sirve para el caso en
  // que estás muerto, pero sí para que se vea desde fuera que lo estás.
  await marcarLatido(admin, 'vigilante', true, `${caidos.length} caido(s)`)

  if (!caidos.length) return NextResponse.json({ ok: true, caidos: [] })

  // A quién se avisa: al propietario. Es quien puede arreglarlo, y un aviso que
  // le llega a alguien que no puede hacer nada es ruido con culpa.
  const { data: duenos, error: eD } = await admin.from('profiles').select('id').eq('role', 'owner')
  if (eD) {
    console.error('[vigilante] no se pudo leer quién es el propietario:', eD.message)
    return NextResponse.json({ error: eD.message }, { status: 500 })
  }

  const { data: fila } = await admin.from('reglas')
    .select('condition_text').eq('name', AVISADO_ROW).maybeSingle()
  let avisado: Record<string, string> = {}
  try { avisado = JSON.parse(fila?.condition_text || '{}') } catch { /* si está roto, se reescribe */ }

  const avisados: string[] = []
  for (const c of caidos) {
    const ultimo = avisado[c.tarea] ? Date.parse(avisado[c.tarea]) : 0
    if (ahora - ultimo < REPETIR_CADA_H * 3600_000) continue
    for (const d of duenos || []) {
      try {
        await sendPushToUser(admin, d.id as string, {
          title: 'Algo automático ha dejado de correr',
          // Dice QUÉ, CUÁNTO y DÓNDE mirarlo. Un aviso sin las tres cosas solo
          // produce inquietud, que es lo que enseña a ignorarlos.
          body: `«${c.tarea}» lleva ${c.horas} h sin ejecutarse. Míralo en Operativa → Sincronización.`,
          url: '/dashboard?s=ajustes',
          tag: `vigilante-${c.tarea}`,
          categoria: 'averia',
          urgent: true,
        })
      } catch (err) {
        console.error('[vigilante] no se pudo avisar:', err)
      }
    }
    avisado[c.tarea] = new Date(ahora).toISOString()
    avisados.push(c.tarea)
  }
  // Lo que vuelve a latir se olvida, o el registro crece para siempre y un
  // proceso que se arregló seguiría contando como avisado el mes que viene.
  for (const t of Object.keys(avisado)) if (!caidos.some(c => c.tarea === t)) delete avisado[t]

  // BUSCAR Y ACTUALIZAR, no upsert. `reglas.name` NO tiene restricción de unicidad
  // —lo dice `marcarLatido`, que guarda una fila por tarea con el mismo `name`—,
  // así que un `onConflict: 'name'` revienta en ejecución con «no unique or
  // exclusion constraint matching the ON CONFLICT specification». Compila igual.
  const payload = JSON.stringify(avisado)
  const { data: yaHay } = await admin.from('reglas').select('id').eq('name', AVISADO_ROW).limit(1).maybeSingle()
  const { error: eU } = yaHay
    ? await admin.from('reglas').update({ condition_text: payload }).eq('id', yaHay.id)
    : await admin.from('reglas').insert({ name: AVISADO_ROW, description: 'vigilante', condition_text: payload, active: false })
  // Si esto falla, el próximo pase volvería a avisar de lo mismo. Se registra
  // para que no sea un misterio por qué llegan avisos repetidos.
  if (eU) console.error('[vigilante] no se pudo apuntar el aviso:', eU.message)

  return NextResponse.json({ ok: true, caidos, avisados })
}
