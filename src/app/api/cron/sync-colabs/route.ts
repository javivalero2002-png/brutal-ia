import { createAdminClient } from '@/lib/supabase/server'
import { syncColabsInbox, syncPersonalInbox } from '@/lib/colabsSync'
import { runAutomations } from '@/lib/automations'
import { NextRequest, NextResponse } from 'next/server'

// Analizar varios buzones con IA puede superar los 10s por defecto
export const maxDuration = 60

// ⚠️ NO colapsar los 24 crons de vercel.json en un solo `0 * * * *`.
// Esta cuenta es plan Hobby, donde cada cron job debe ser como máximo DIARIO.
// Las 24 entradas (`0 0 * * *` … `0 23 * * *`) son un apaño deliberado: cada una
// es legalmente diaria, y juntas dan cobertura horaria. Un único `0 * * * *`
// hace que el deploy falle con "Hobby accounts are limited to daily cron jobs".
//
// Cron de Vercel (horario, ver vercel.json): sincroniza el buzón compartido de
// colaboraciones Y el Gmail personal de cada perfil conectado, sin sesión de
// usuario — los pushes de emails llegan aunque nadie tenga la app abierta.
// Vercel añade automáticamente `Authorization: Bearer ${CRON_SECRET}` a la petición.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = await createAdminClient()
  const colabs = await syncColabsInbox(admin)

  // Buzones personales de todos los perfiles con Gmail conectado
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, gmail_refresh_token')
    .eq('gmail_connected', true)
    .not('gmail_refresh_token', 'is', null)

  const personal: Record<string, number | string> = {}
  for (const p of profiles || []) {
    const r = await syncPersonalInbox(admin, p)
    personal[p.id] = r.ok ? r.synced : r.error
  }

  // Motor de automatizaciones: tras sincronizar los buzones, evalúa las reglas
  // activas (crear tareas / avisar) sobre los datos ya frescos. Best-effort:
  // un fallo aquí no debe tumbar el sync de emails.
  let automations: { ran: number } | { error: string } = { ran: 0 }
  try {
    const { ran } = await runAutomations(admin)
    automations = { ran }
  } catch (err: any) {
    automations = { error: err?.message || 'error' }
  }

  return NextResponse.json({
    ok: true,
    colabs: colabs.ok ? { synced: colabs.synced } : { error: colabs.error },
    personal,
    automations,
  })
}
