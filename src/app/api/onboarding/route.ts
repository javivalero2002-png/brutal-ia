import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * Marca la puesta en marcha como hecha para QUIEN LA PIDE.
 *
 * Ruta propia y no un campo más de PATCH /api/profile: ahí la allowlist es la que
 * impide que un cliente escriba `role` o `id`, y añadirle campos la va aflojando.
 * Esto solo puede hacer una cosa, sobre una sola fila, y esa fila sale de la
 * sesión — no hay nada que un cuerpo malicioso pueda cambiar.
 */
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const { error } = await admin
    .from('profiles')
    .update({ onboarding_at: new Date().toISOString() })
    .eq('id', user.id)

  // Se devuelve el fallo: si no se guarda, la persona volverá a ver la puesta en
  // marcha en la siguiente visita. Es recuperable, pero decirlo evita que parezca
  // que la app "se olvida" sin motivo.
  if (error) {
    console.error('[onboarding] no se pudo marcar como hecha:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
