import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const [{ data: client }, { data: projects }, { data: tasks }] = await Promise.all([
    admin.from('clients').select('*').eq('id', id).single(),
    admin.from('projects').select('*').eq('client_id', id),
    admin.from('tasks').select('*').eq('client_id', id).eq('done', false),
  ])

  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const context = `
Cliente: ${client.name} (${client.industry})
Facturación: ${client.revenue || 'no especificada'}
Estado: ${client.status}
Notas internas: ${client.notes || 'ninguna'}
Proyectos (${projects?.length || 0}):
${projects?.map((p: any) => `  - "${p.name}": ${p.progress}% completado, estado: ${p.status}, deadline: ${p.deadline}`).join('\n') || '  (sin proyectos)'}
Tareas activas (${tasks?.length || 0}):
${tasks?.slice(0,5).map((t: any) => `  - ${t.text} [${t.level}]`).join('\n') || '  (sin tareas)'}
`

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `Eres el estratega creativo de Brutal Studios, una agencia creativa boutique. Analiza este cliente y da exactamente 3 recomendaciones concretas y accionables para los próximos 30 días.

${context}

Formato estricto: devuelve JSON con este esquema exacto:
{"recommendations": [{"title": "Título corto (3-5 palabras)", "body": "Explicación en 1-2 frases directas", "priority": "alta|media|baja"}]}

Sin texto fuera del JSON. Sin asteriscos. En español. Sé específico y directo.`,
    }],
  })

  try {
    const raw = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '{}'
    const json = JSON.parse(raw.replace(/```json\n?|```/g, '').trim())
    return NextResponse.json(json)
  } catch {
    return NextResponse.json({ recommendations: [{ title: 'Sin datos suficientes', body: msg.content[0].type === 'text' ? msg.content[0].text : '', priority: 'media' }] })
  }
}
