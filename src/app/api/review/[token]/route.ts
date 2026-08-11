import { createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Public endpoint — no auth required (token = agenda item ID)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = await createAdminClient()

  // Endpoint PÚBLICO: no exponer `notes` (uso interno) ni `client_id`.
  const { data, error } = await admin
    .from('content_agenda')
    .select('id, title, platform, status, video_url, publish_date')
    .eq('id', token)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(data)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  let feedback: string
  try {
    const body = await req.json()
    feedback = body.feedback || ''
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (!feedback.trim()) return NextResponse.json({ error: 'feedback required' }, { status: 400 })
  if (feedback.length > 5000) return NextResponse.json({ error: 'Feedback too long' }, { status: 400 })

  const admin = await createAdminClient()

  // No sobrescribir el feedback anterior: se anexa con fecha, preservando el historial.
  const { data: existing } = await admin
    .from('content_agenda')
    .select('feedback')
    .eq('id', token)
    .single()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const stamp = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const prev = (existing.feedback || '').trim()
  const merged = (prev ? `${prev}\n\n` : '') + `[${stamp}] ${feedback.trim()}`

  // El recorte se hace por el PRINCIPIO, no por el final. Cortando por el final,
  // una vez lleno el campo el cliente enviaba su comentario, recibia "ok" y se
  // perdia en silencio — justo el ultimo, que es el que importa. Asi se conserva
  // siempre lo mas reciente y lo que se descarta es lo mas antiguo, avisando de
  // que se ha recortado para que no parezca que el historial empieza ahi.
  const LIMITE = 20000
  const recortado = merged.length > LIMITE
  const final = recortado
    ? '[…historial antiguo recortado…]\n\n' + merged.slice(-(LIMITE - 40))
    : merged

  const { error } = await admin
    .from('content_agenda')
    .update({ feedback: final })
    .eq('id', token)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
