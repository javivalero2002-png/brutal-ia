import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { runAutomations } from '@/lib/automations'

// Evaluar reglas + crear tareas + enviar avisos puede superar los 10s por defecto
export const maxDuration = 60

// Ejecución manual del motor de automatizaciones (botón "Ejecutar ahora").
// Solo owners. El cron horario lo llama también sin sesión.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const { ran, results, skipped } = await runAutomations(admin)
    // `skipped` distingue "no había nada que hacer" de "otra ejecución lo tenía
    // tomado". Sin ese matiz la UI dice "sin acciones pendientes", que es falso.
    return NextResponse.json({ ok: true, ran, results, skipped: skipped ?? false })
  } catch (err: any) {
    console.error('runAutomations error:', err?.message)
    return NextResponse.json({ error: 'Error ejecutando automatizaciones' }, { status: 500 })
  }
}
