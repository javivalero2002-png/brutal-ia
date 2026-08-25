import { createClient, createAdminClient } from '@/lib/supabase/server'
import { leerFicha } from '@/lib/fichaEstudio'
import { checkAiRateLimit } from '@/lib/rate-limit'
import { analyzeEmail } from '@/lib/ai'
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

// ─────────────────────────────────────────────────────────────────────────────
// «Analiza este correo, que la criba se lo saltó.»
//
// Es la pieza que convierte la criba en una decisión y no en una amputación. Sin
// esta ruta, un correo omitido por error se queda gris para siempre: no hay
// ningún otro camino que vuelva a llamar al modelo sobre un correo ya guardado —
// los tres bucles de sincronización saltan por `gmail_id` conocido.
//
// No hace falta volver a Gmail: `analyzeEmail` trabaja con el asunto y los
// primeros 800 caracteres del cuerpo, y `body_preview` ya está en la base. El
// reanálisis es literalmente idéntico al análisis original.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let id: string
  try { id = (await request.json())?.id } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  const admin = await createAdminClient()
  if (await checkAiRateLimit(admin, user.id, 'reanalisis')) {
    return NextResponse.json({ error: 'Demasiadas peticiones seguidas. Espera un momento.' }, { status: 429 })
  }

  const { data: correo, error } = await admin
    .from('inbox_messages')
    .select('id, subject, body_preview, from_name, shared, user_id')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[reanalizar] no se pudo leer el correo:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!correo) return NextResponse.json({ error: 'Ese correo ya no está' }, { status: 404 })

  // El correo compartido lo ve todo el equipo a propósito; el personal, no. Sin
  // esta comprobación cualquiera con sesión podría mandar a analizar —y por tanto
  // leer el resumen de— el correo privado de un compañero.
  if (!correo.shared && correo.user_id !== user.id) {
    return NextResponse.json({ error: 'Ese correo no es tuyo' }, { status: 403 })
  }

  const { data: clientes } = await admin.from('clients').select('name')
  const conocidos = (clientes || []).map(c => (c as { name: string }).name)

  const analysis = await analyzeEmail(
    correo.subject || '',
    (correo.body_preview || '').slice(0, 800),
    correo.from_name,
    conocidos,
    // Plazo generoso: es UNA llamada pedida a mano, con alguien mirando la
    // pantalla. No compite con nada.
    45_000,
    await leerFicha(admin),
  )

  // `degraded` significa que el modelo no respondió y esto es el apaño local. No
  // se guarda como análisis bueno: quedaría gris otra vez pero diciendo «ok», y
  // el botón desaparecería sin haber hecho nada.
  if (analysis.degraded) {
    return NextResponse.json({ error: 'La IA no ha respondido. Vuelve a intentarlo en un momento.' }, { status: 503 })
  }

  const { error: errUpd } = await admin.from('inbox_messages').update({
    ai_summary: analysis.summary,
    ai_action: analysis.action,
    ai_client: analysis.client,
    ai_urgency: analysis.urgency,
    ai_estado: 'ok',
    ai_motivo: null,
  }).eq('id', id)

  if (errUpd) {
    console.error('[reanalizar] no se pudo guardar el análisis:', errUpd.message)
    return NextResponse.json({ error: errUpd.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, analysis })
}
