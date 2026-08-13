import { createAdminClient } from '@/lib/supabase/server'
import { borrarFicherosDeAdjuntos } from '@/lib/taskAttachments'
import { getAuthCtx, canAccessTask } from '@/lib/authz'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await ctx.admin
    .from('task_attachments')
    .select('*')
    .eq('task_id', id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await canAccessTask(ctx, id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const { name, url, size, mime_type } = body
  if (!name || !url) return NextResponse.json({ error: 'name and url required' }, { status: 400 })

  const { data, error } = await ctx.admin
    .from('task_attachments')
    .insert({ task_id: id, name, url, size: size || null, mime_type: mime_type || null, created_by: ctx.userId })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const attachmentId = searchParams.get('attachmentId')
  if (!attachmentId) return NextResponse.json({ error: 'attachmentId required' }, { status: 400 })

  // Fetch the attachment to get its storage path for deletion
  const { data: att } = await ctx.admin
    .from('task_attachments')
    .select('url, task_id')
    .eq('id', attachmentId)
    .eq('task_id', id)
    .single()

  if (!att) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Borrar el fichero del Storage. Antes se partía por '/object/public/pdfs/' y
  // se borraba del bucket 'pdfs', pero las subidas van a 'content-videos'
  // (pdf-upload-url/route.ts:5). pathParts[1] era SIEMPRE undefined: la fila se
  // borraba y el fichero quedaba público para siempre. Ahora el bucket y la ruta
  // se derivan de la propia URL, así que funciona con cualquier bucket.
  //
  // El resultado del remove() SÍ se mira: la API de Storage de supabase-js tampoco
  // lanza, devuelve { data, error }, así que el catch de abajo solo cubre el
  // new URL() y el match — un remove() fallido (ruta con otra codificación, bucket
  // renombrado, objeto ya movido) pasaba de largo y la fila se borraba igual. El
  // resultado era el MISMO bug que arregló este bloque, por otra puerta: fichero
  // público sin fila que lo referencie, o sea sin forma de volver a encontrarlo.
  // Sigue siendo best-effort —el adjunto se borra de la base pase lo que pase—,
  // pero al menos queda inventario en los logs.
  // El derivado de la ruta y el borrado viven en src/lib/taskAttachments.ts: este
  // mismo código estaba escrito TRES veces (aquí, en el borrado de una tarea y en
  // el borrado en lote), que es la forma exacta en que este repo fabrica gemelos —
  // se arregla una copia y las otras dos siguen rotas.
  await borrarFicherosDeAdjuntos(ctx.admin, [att.url], '[attachments]')

  const { error } = await ctx.admin
    .from('task_attachments')
    .delete()
    .eq('id', attachmentId)
    .eq('task_id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
