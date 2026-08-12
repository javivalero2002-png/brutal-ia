import { createClient, createAdminClient } from '@/lib/supabase/server'
import { checkAiRateLimit } from '@/lib/rate-limit'
import { logQueryErrors } from '@/lib/queryLog'
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { textOf } from '@/lib/aiText'

// Analisis de cliente con Claude: el default de Vercel se queda corto.
export const maxDuration = 60

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  if (await checkAiRateLimit(admin, user.id, 'advice')) {
    return NextResponse.json({ error: 'Demasiadas solicitudes. Espera un momento.' }, { status: 429 })
  }
  const q = await Promise.all([
    admin.from('clients').select('*').eq('id', id).single(),
    admin.from('projects').select('*').eq('client_id', id),
    admin.from('tasks').select('*').eq('client_id', id).eq('done', false),
  ])

  // supabase-js NO lanza: devuelve { data:null, error }. Desestructurando solo
  // `data`, una consulta caída llegaba al prompt como "Proyectos (0)" y Claude
  // devolvía tres recomendaciones estratégicas con total aplomo partiendo de que
  // el cliente no tiene nada en marcha. Un fallo de lectura no es un cliente
  // vacío, y aquí la diferencia acaba en una decisión de negocio.
  logQueryErrors('ai-advice', q)
  const [{ data: client, error: errCliente }, { data: projects, error: errProyectos }, { data: tasks, error: errTareas }] = q

  // `.single()` sin filas devuelve PGRST116, y eso sí es un 404. Cualquier otro
  // error es la base de datos fallando: contestar "Not found" lo disfrazaba de
  // cliente inexistente.
  if (errCliente && errCliente.code !== 'PGRST116') {
    return NextResponse.json({ error: 'No se han podido leer los datos del cliente' }, { status: 503 })
  }
  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Si proyectos o tareas no se han podido leer se dice en el propio contexto,
  // en vez de mandar un cero que el modelo interpreta como "no tiene".
  const proyectosTxt = errProyectos
    ? '  (no se han podido leer los proyectos — NO asumas que el cliente no tiene ninguno)'
    : projects?.map((p: any) => `  - "${p.name}": ${p.progress}% completado, estado: ${p.status}, deadline: ${p.deadline}`).join('\n') || '  (sin proyectos)'
  const tareasTxt = errTareas
    ? '  (no se han podido leer las tareas — NO asumas que el cliente no tiene ninguna)'
    : tasks?.slice(0,5).map((t: any) => `  - ${t.text} [${t.level}]`).join('\n') || '  (sin tareas)'

  const context = `
Cliente: ${client.name} (${client.industry})
Facturación: ${client.revenue || 'no especificada'}
Estado: ${client.status}
Notas internas: ${client.notes || 'ninguna'}
Proyectos (${errProyectos ? 'no disponible' : projects?.length || 0}):
${proyectosTxt}
Tareas activas (${errTareas ? 'no disponible' : tasks?.length || 0}):
${tareasTxt}
`

  // Sin topes, el SDK se queda con 10 MINUTOS de timeout y 2 reintentos: quien
  // acaba cortando es la plataforma al llegar al techo de 60s del plan Hobby, y
  // entonces no hay ni mensaje de error ni log — la petición muere a secas. El
  // timeout del SDK es POR INTENTO, así que un reintento no cabe dentro de esos
  // 60s: maxRetries 0 y un tope que deja margen para responder con un error de
  // verdad en vez de que nos maten desde fuera.
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 45_000, maxRetries: 0 })
  let msg: Awaited<ReturnType<typeof anthropic.messages.create>>
  try {
    msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `Eres el estratega creativo de Brutal Studios, una agencia creativa boutique. Analiza este cliente y da exactamente 3 recomendaciones concretas y accionables para los próximos 30 días.

${context}

Formato estricto: devuelve JSON con este esquema exacto:
{"recommendations": [{"title": "Título corto (3-5 palabras)", "body": "Explicación en 1-2 frases directas", "priority": "alta|media|baja"}]}

Sin texto fuera del JSON. Sin asteriscos. En español. Sé específico y directo.`,
      }],
    })
  } catch {
    return NextResponse.json({ error: 'AI no disponible' }, { status: 502 })
  }

  try {
    const raw = textOf(msg).trim() || '{}'
    const json = JSON.parse(raw.replace(/```json\n?|```/g, '').trim())
    return NextResponse.json(json)
  } catch {
    return NextResponse.json({ recommendations: [{ title: 'Sin datos suficientes', body: textOf(msg), priority: 'media' }] })
  }
}
