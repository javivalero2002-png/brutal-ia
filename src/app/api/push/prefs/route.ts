import { createClient, createAdminClient } from '@/lib/supabase/server'
import { PREFS_ROW } from '@/lib/push'
import { AVISOS, type CategoriaAviso } from '@/lib/avisos'
import { NextRequest, NextResponse } from 'next/server'

// ─────────────────────────────────────────────────────────────────────────────
// Qué avisos NO quiere cada uno.
//
// Se guarda como una fila de `reglas` con `created_by` del usuario, igual que la
// suscripción push y el logo de cuenta: es un par clave/valor y crear una tabla
// para eso sería más trabajo del que ahorra. `reglaRows.ts` ya las excluye de la
// lista de automatizaciones.
//
// Solo lo propio, siempre: el id sale de la sesión y no hay parámetro que lo
// cambie. Silenciar los avisos de otra persona sería una forma silenciosa de
// dejarla sin enterarse de su trabajo.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const { data, error } = await admin
    .from('reglas').select('condition_text').eq('name', PREFS_ROW).eq('created_by', user.id).maybeSingle()

  // «No pude leerlas» no puede pintarse como «no ha silenciado nada»: la pantalla
  // enseñaría todo encendido y al guardar reactivaría lo que la persona apagó.
  if (error) {
    console.error('[push/prefs] no se pudieron leer:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let prefs: Record<string, boolean> = {}
  try { prefs = JSON.parse(data?.condition_text || '{}') } catch { /* ilegible = todo activo */ }
  return NextResponse.json({ prefs })
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let cuerpo: Record<string, unknown>
  try { cuerpo = (await request.json())?.prefs || {} } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // Allowlist por categoría, como el `pick()` del resto de la API: solo entran
  // las que existen y las que se pueden silenciar. Sin esto, un cliente podría
  // escribir `{ averia: false }` y quedarse sin la única señal de que su correo
  // ha dejado de entrar — que es justo la que no debe poder apagarse.
  const prefs: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(cuerpo)) {
    const ficha = AVISOS[k as CategoriaAviso]
    if (ficha?.silenciable && typeof v === 'boolean') prefs[k] = v
  }

  const admin = await createAdminClient()
  const { data: existente } = await admin
    .from('reglas').select('id').eq('name', PREFS_ROW).eq('created_by', user.id).maybeSingle()

  // La tabla no tiene `name` único, así que no hay upsert: se busca y se
  // actualiza o se inserta. Mismo camino que el latido.
  const { error } = existente?.id
    ? await admin.from('reglas').update({ condition_text: JSON.stringify(prefs) }).eq('id', existente.id)
    : await admin.from('reglas').insert({
        name: PREFS_ROW, created_by: user.id, condition_text: JSON.stringify(prefs),
        description: 'Avisos silenciados', active: false,
      })

  if (error) {
    console.error('[push/prefs] no se pudieron guardar:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, prefs })
}
