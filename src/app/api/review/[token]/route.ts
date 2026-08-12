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

  const { data: existing } = await admin
    .from('content_agenda')
    .select('feedback')
    .eq('id', token)
    .single()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // El feedback se anexa al MISMO ARRAY JSON que usa el equipo.
  //
  // Antes esta ruta trataba `content_agenda.feedback` como un log de texto y hacia
  // `prev + '\n\n[12/08 10:30] texto'`. Pero esa columna tiene otro escritor:
  // ContenidoSection guarda ahi un array JSON de opiniones y TODAS sus lecturas
  // hacen JSON.parse dentro de un try/catch que devuelve [] al fallar. Los dos
  // caminos llevan vivos desde que se añadio el boton COPIAR ENLACE PARA EL CLIENTE.
  //
  // Lo que pasaba, en orden:
  //   1. el equipo opina  -> feedback = '[{...}]'
  //   2. el cliente envia -> feedback = '[{...}]\n\n[12/08 10:30] Cambiad el final'
  //   3. al abrir la pieza, JSON.parse lanza y el catch devuelve []: TODAS las
  //      opiniones del equipo desaparecen de pantalla, sin ningun aviso
  //   4. la siguiente opinion parte de [] y sobrescribe la columna entera: el
  //      comentario del cliente se borra para siempre
  // Y sin nada previo era igual de malo: el texto plano tampoco es JSON, asi que
  // el comentario del cliente NO SE PINTABA EN NINGUN SITIO. La funcion de
  // revision no entregaba nunca su resultado, que es lo unico que tenia que hacer.
  const entradas: Array<Record<string, unknown>> = (() => {
    const bruto = (existing.feedback || '').trim()
    if (!bruto) return []
    try {
      const p = JSON.parse(bruto)
      if (Array.isArray(p)) return p
    } catch {}
    // Texto de la version anterior: se conserva como una entrada mas en vez de
    // tirarlo, que es lo que hacia el JSON.parse del cliente.
    return [{ origen: 'cliente', name: 'Cliente', initials: 'CL', color: '#FFB020', note: bruto, at: null }]
  })()

  entradas.push({
    origen: 'cliente',
    name: 'Cliente',
    initials: 'CL',
    color: '#FFB020',
    note: feedback.trim(),
    at: new Date().toISOString(),
  })

  // El recorte se hace por el PRINCIPIO, no por el final. Cortando por el final,
  // una vez lleno el campo el cliente enviaba su comentario, recibia "ok" y se
  // perdia en silencio — justo el ultimo, que es el que importa. Ahora que son
  // entradas y no texto, se descartan las mas antiguas hasta que quepa.
  const LIMITE = 20000
  while (entradas.length > 1 && JSON.stringify(entradas).length > LIMITE) entradas.shift()
  const recortado = JSON.stringify(entradas).length > LIMITE

  const { error } = await admin
    .from('content_agenda')
    .update({ feedback: JSON.stringify(entradas) })
    .eq('id', token)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
