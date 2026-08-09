import { createAdminClient } from '@/lib/supabase/server'
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

  // Extract storage path from the public URL and delete from bucket
  try {
    const urlObj = new URL(att.url)
    const pathParts = urlObj.pathname.split('/object/public/pdfs/')
    if (pathParts[1]) {
      await ctx.admin.storage.from('pdfs').remove([pathParts[1]])
    }
  } catch { /* best-effort storage deletion */ }

  const { error } = await ctx.admin
    .from('task_attachments')
    .delete()
    .eq('id', attachmentId)
    .eq('task_id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
