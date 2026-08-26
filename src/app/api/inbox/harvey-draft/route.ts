import { createClient, createAdminClient } from '@/lib/supabase/server'
import { checkAiRateLimit } from '@/lib/rate-limit'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { textOf } from '@/lib/aiText'
import { leerFicha } from '@/lib/fichaEstudio'
import { memoriaRelevante, lineasDeMemoria } from '@/lib/memoriaRelevante'
import { anotarError } from '@/lib/errores'
import { localDayKey } from '@/components/shared/helpers'

// Sin topes, el SDK se queda con 10 MINUTOS de timeout y 2 reintentos: quien
// acaba cortando es la plataforma, y entonces no hay ni mensaje de error ni log —
// la petición muere a secas. El timeout del SDK es POR INTENTO, así que un
// reintento no cabe: maxRetries 0 y un tope que deja margen para responder con un
// error de verdad en vez de que nos maten desde fuera.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 45_000, maxRetries: 0 })

export const maxDuration = 60

// ─────────────────────────────────────────────────────────────────────────────
// EL BORRADOR DE RESPUESTA, CON EL CONTEXTO DEL ESTUDIO DETRÁS.
//
// Javi: «cuando le das a redactar, Harvey y la IA tienen constancia de toda la
// empresa y todo el contexto». Lo daba por hecho. NO ERA ASÍ.
//
// Esta ruta era la TERCERA superficie de IA de la app, y la única sin nada: 61
// líneas, CERO consultas de negocio. No veía la ficha del estudio, ni la memoria,
// ni los clientes, ni los proyectos, ni un solo correo anterior de ese remitente.
// Ni siquiera el cuerpo del email — solo `ai_summary`, que es un resumen que hizo
// Haiku de los primeros 800 caracteres. Un resumen de un resumen.
//
// Y no lo cazaba ninguna regla porque las que exigen contexto enumeran A MANO las
// superficies de IA, y eran una lista de dos. Una tercera se escapaba sola.
//
// AHORA EL CLIENTE MANDA EL ID DEL CORREO, no seis campos sueltos. Eso cambia
// quién decide qué se ve: antes el navegador elegía qué contarle al modelo y el
// servidor no podía comprobar nada. Ahora el servidor lee la fila, verifica que
// esa persona puede verla, y compone el contexto él.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  if (await checkAiRateLimit(admin, user.id, 'draft')) {
    return NextResponse.json({ error: 'Demasiadas solicitudes. Espera un momento.' }, { status: 429 })
  }

  const { id } = await request.json().catch(() => ({}))
  if (typeof id !== 'string' || !id) {
    return NextResponse.json({ error: 'Falta el correo' }, { status: 400 })
  }

  // ── EL CORREO, Y SI ESTA PERSONA PUEDE VERLO ────────────────────────────
  // Mismo criterio que `/api/inbox`: el suyo, o uno del buzón compartido si
  // tiene `ver_colabs`. Sin esto, mandar un id ajeno redactaría —y enseñaría—
  // el contenido de un correo de otro.
  const [{ data: correo, error: errCorreo }, { data: perfil }] = await Promise.all([
    admin.from('inbox_messages')
      .select('id, user_id, shared, cuenta, from_name, from_email, subject, body_preview, ai_summary, ai_action, ai_client, ai_urgency, received_at')
      .eq('id', id).maybeSingle(),
    admin.from('profiles').select('name, ver_colabs').eq('id', user.id).maybeSingle(),
  ])
  if (errCorreo) {
    await anotarError(admin, {
      clave: 'borrador:lectura', donde: 'borrador de respuesta',
      que: 'No se pudo leer el correo para redactar la respuesta.',
      gravedad: 'media', contexto: { motivo: errCorreo.message },
    })
    return NextResponse.json({ error: 'No se pudo leer el correo' }, { status: 500 })
  }
  if (!correo) return NextResponse.json({ error: 'Ese correo no existe' }, { status: 404 })

  const veColabs = perfil?.ver_colabs !== false
  const suyo = correo.user_id === user.id || (correo.shared === true && veColabs)
  if (!suyo) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // ── EL CONTEXTO ─────────────────────────────────────────────────────────
  // Lo mismo que ven las otras dos IAs, más una cosa que solo tiene sentido
  // aquí: lo que ya se habló con este remitente.
  // Los errores SE NOMBRAN. supabase-js no lanza, asi que sin esto un fallo al
  // leer la memoria o los clientes se cuela como «no hay nada relevante» y el
  // borrador sale escrito sobre menos contexto del que hay — sin que nadie lo sepa.
  // El borrador se hace igual (es util aunque le falte algo), pero queda anotado.
  const [ficha, { data: curadas, error: eNotas }, { data: documentos, error: eDocs }, { data: clientes, error: eCli }, { data: anteriores, error: eAnt }] = await Promise.all([
    leerFicha(admin),
    // DOS consultas, no una con limit(200). Era el gemelo vivo del bug que
    // /api/chat ya tenía arreglado y explicado: con un solo cubo ordenado por
    // fecha, cada PDF que se sube empuja fuera una nota escrita a mano, y lo
    // primero que se cae es la doctrina del estudio —cómo se factura, cómo se
    // habla a un cliente— que es justo lo que un borrador de respuesta necesita.
    admin.from('memoria').select('title, category, content').not('category', 'ilike', 'documento').order('created_at', { ascending: false }).limit(200),
    admin.from('memoria').select('title, category, content').ilike('category', 'documento').order('created_at', { ascending: false }).limit(150),
    admin.from('clients').select('name, industry, status, notes').limit(100),
    // Los correos anteriores de ESA dirección. Es lo que convierte un borrador
    // genérico en una respuesta que sabe de qué se venía hablando.
    correo.from_email
      ? admin.from('inbox_messages')
          .select('subject, ai_summary, received_at')
          .eq('from_email', correo.from_email).neq('id', correo.id)
          .order('received_at', { ascending: false }).limit(5)
      : Promise.resolve({
          data: [] as { subject: string | null; ai_summary: string | null; received_at: string }[],
          // `error: null` en la rama que no consulta: sin el, los dos lados del
          // ternario tienen forma distinta y `error` no existe en el tipo union.
          error: null as { message: string } | null,
        }),
  ])
  if (eNotas || eDocs || eCli || eAnt) {
    console.error('[harvey-draft] contexto incompleto —',
      eNotas?.message || '', eDocs?.message || '', eCli?.message || '', eAnt?.message || '')
  }

  // La memoria se elige con el ASUNTO Y EL CUERPO como pregunta: es lo que hay
  // para emparejar. Con la pregunta vacía devolvería siempre las mismas notas.
  const consulta = [correo.subject, correo.ai_summary, correo.body_preview].filter(Boolean).join(' ')
  const memoria = lineasDeMemoria(memoriaRelevante([...(curadas || []), ...(documentos || [])] as never, consulta))

  const cliente = (clientes || []).find(c =>
    String(c.name || '').toLowerCase().trim() === String(correo.ai_client || '').toLowerCase().trim())

  const historia = (anteriores || []).length
    ? (anteriores || []).map(a => `  - ${localDayKey(String(a.received_at))} · ${a.subject || 'sin asunto'}${a.ai_summary ? `: ${a.ai_summary}` : ''}`).join('\n')
    : null

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      messages: [{
        role: 'user',
        content: `Eres el asistente de Brutal Studios, un estudio de vídeo y contenido español de 7 personas. Redacta un borrador de respuesta a este email.

${ficha ? `FICHA DEL ESTUDIO (quiénes somos, cómo trabajamos, qué hemos decidido):
${ficha}

` : ''}${cliente ? `ESTE REMITENTE ES UN CLIENTE NUESTRO: ${cliente.name}${cliente.industry ? ` · ${cliente.industry}` : ''}${cliente.status ? ` · ${cliente.status}` : ''}${cliente.notes ? `
Notas internas sobre él: ${String(cliente.notes).slice(0, 400)}` : ''}

` : ''}${historia ? `LO QUE YA SE HABLÓ CON ESTA DIRECCIÓN (de lo más reciente a lo más viejo):
${historia}

` : ''}${memoria ? `DE NUESTRA MEMORIA, lo que encaja con este email:
${memoria}

` : ''}EL EMAIL AL QUE RESPONDES
Llegó a: ${correo.cuenta || 'nuestro buzón'}${correo.shared ? ' (buzón COMPARTIDO del estudio — respondes en nombre del equipo, no a título personal)' : ''}
De: ${correo.from_name || 'Desconocido'} <${correo.from_email || ''}>
Asunto: ${correo.subject || 'Sin asunto'}
${correo.ai_action ? `Lo que hay que resolver: ${correo.ai_action}
` : ''}
Cuerpo:
"""
${String(correo.body_preview || correo.ai_summary || '').slice(0, 2000)}
"""

INSTRUCCIONES
- Responde EN EL MISMO IDIOMA en que está escrito el cuerpo de arriba. Míralo tú: no te fíes de suposiciones.
- Tono profesional pero cercano, como lo haría un estudio creativo.
- Usa lo que sabes del estudio y de lo que ya se habló. Si algo encaja, dilo con concreción; si no viene a cuento, no lo metas con calzador.
- NO inventes precios, plazos ni compromisos que no estén arriba. Si hace falta un dato que no tienes, deja la frase abierta en vez de rellenarla.
- No pongas asunto, ni fecha, ni "De:"/"Para:". Solo el cuerpo.
- Nada de placeholders entre corchetes. Deja la firma en blanco.
- Máximo 150 palabras.

Responde SOLO con el cuerpo del email.`,
      }],
    })

    const draft = textOf(msg)?.trim()
    if (!draft) throw new Error('respuesta vacía')
    // Se devuelve lo que se USÓ, para que la pantalla pueda decirlo. Un borrador
    // que parece saber cosas sin explicar de dónde salen no se puede revisar.
    return NextResponse.json({
      draft,
      cuenta: correo.cuenta || null,
      compartido: correo.shared === true,
      uso: {
        ficha: !!ficha,
        cliente: cliente?.name || null,
        anteriores: (anteriores || []).length,
        memoria: memoria ? memoria.split('\n').filter(Boolean).length : 0,
      },
    })
  } catch (err) {
    // Antes el catch estaba VACÍO: un 502 sin una línea de log. Un borrador que
    // falla en silencio parece un problema de red y no se investiga nunca.
    await anotarError(admin, {
      clave: 'borrador:modelo', donde: 'borrador de respuesta',
      que: 'La IA no pudo redactar el borrador de respuesta.',
      gravedad: 'media', contexto: { motivo: err instanceof Error ? err.message : String(err) },
    })
    return NextResponse.json({ error: 'Error generando borrador' }, { status: 502 })
  }
}
