import { getAuthCtx } from '@/lib/authz'
import type { SupabaseClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'

// El techo de la plataforma es mayor, pero este se pone a mano: cada documento
// cuesta una lectura de PDF con el modelo (~20 s), y un tope bajo es lo que
// convierte «se colgó» en un error con mensaje. Lo que no quepa se queda para la
// siguiente pasada, y la respuesta dice cuántos quedan.
export const maxDuration = 300

// ─────────────────────────────────────────────────────────────────────────────
// Los documentos de Memoria que solo guardan su RESUMEN.
//
// Hasta hoy, subir un PDF guardaba 80-150 palabras y un enlace. El enlace no lo
// abre ninguna IA, así que de un documento de 4.500 caracteres la app sabía 684.
//
// Lo destapó una pregunta de Javi: «¿qué tipo de campaña hicimos con Nutella?».
// Las dos IAs contestaron que no había ninguna. La había —NUTELLA & PAN, «Una
// tradición muy nuestra», rechazada, campaña vía agencia Pavlov/IKI Group— en el
// primer tercio del PDF. El resumen no la nombraba, y lo que no está en la nota
// no existe para nadie.
//
// Los documentos nuevos ya se guardan enteros. Esto es para los de antes.
//
// NO REGENERA LA NOTA: añade el bloque de contenido justo antes del enlace y deja
// intacto todo lo demás, palabra por palabra. Una nota de Memoria puede llevar
// texto escrito por una persona, y eso no se toca.
//
// Solo owner: lee documentos del estudio y reescribe notas en lote.
// ─────────────────────────────────────────────────────────────────────────────

const BUCKET = 'content-videos'
const MARCA = 'CONTENIDO DEL DOCUMENTO:'
const ENLACE = /📎 Documento: (\S+)/

type Pendiente = { id: string; title: string; ruta: string; content: string }

/** La ruta dentro del bucket que hay escrita en el enlace de la nota. */
function rutaDe(texto: string): string | null {
  const m = texto.match(ENLACE)
  if (!m) return null
  // El enlace es `/api/archivo?u=<url pública codificada>`; la ruta va dentro.
  const dentro = decodeURIComponent(m[1])
  const r = dentro.match(new RegExp(`${BUCKET}/(\\S+?\\.pdf)`, 'i'))
  return r ? r[1] : null
}

async function pendientes(admin: SupabaseClient): Promise<Pendiente[]> {
  const { data, error } = await admin.from('memoria')
    .select('id,title,content,category').ilike('category', 'documento')
  // «No pude leerlo» no puede pintarse como «no queda ninguno»: diría que las IAs
  // ya tienen el contenido de todos los documentos cuando no lo han mirado.
  if (error) throw new Error(error.message)

  const fuera: Pendiente[] = []
  for (const n of data || []) {
    const texto = String(n.content || '')
    if (texto.includes(MARCA)) continue
    const ruta = rutaDe(texto)
    if (!ruta) continue
    fuera.push({ id: n.id as string, title: (n.title as string) || '(sin título)', ruta, content: texto })
  }
  return fuera
}

/** Cuántos quedan, sin leer ni un PDF. */
export async function GET() {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (ctx.role !== 'owner') return NextResponse.json({ error: 'Solo el propietario' }, { status: 403 })
  try {
    const p = await pendientes(ctx.admin)
    return NextResponse.json({ pendientes: p.map(({ id, title }) => ({ id, title })), total: p.length })
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e)
    console.error('[memoria-releer] no se pudieron revisar los documentos:', motivo)
    return NextResponse.json({ error: motivo }, { status: 500 })
  }
}

/** Releerlos. Idempotente: el que ya lleva el bloque se salta. */
export async function POST() {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (ctx.role !== 'owner') return NextResponse.json({ error: 'Solo el propietario' }, { status: 403 })

  const arranque = Date.now()
  // Se pregunta si CABE LA SIGUIENTE, no si ya nos hemos pasado. Comprobarlo entre
  // vueltas autoriza una llamada sin saber lo que va a costar, que es justo como
  // se agotan estos presupuestos.
  const CUESTA = 35_000
  const cabeOtra = () => Date.now() - arranque < (maxDuration * 1000) - CUESTA

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  try {
    const lista = await pendientes(ctx.admin)
    let releidos = 0
    const fallos: string[] = []

    for (const nota of lista) {
      if (!cabeOtra()) break
      try {
        const { data: fichero, error: eBaja } = await ctx.admin.storage.from(BUCKET).download(nota.ruta)
        if (eBaja || !fichero) { fallos.push(`${nota.title}: no se pudo bajar (${eBaja?.message || 'vacío'})`); continue }
        const buf = Buffer.from(await fichero.arrayBuffer())
        if (buf.length > 20 * 1024 * 1024) { fallos.push(`${nota.title}: demasiado grande`); continue }

        const msg = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 3000,
          messages: [{ role: 'user', content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } } as never,
            { type: 'text', text: 'Transcribe este documento a texto plano, hasta 4000 caracteres. NO es un resumen: lo va a leer una IA para contestar preguntas concretas, así que tienen que estar los NOMBRES PROPIOS tal cual (marcas, personas, agencias, formatos), el estado de cada cosa (aprobado, rechazado, en proceso), las cifras y las fechas. Si es una lista de proyectos, tienen que salir TODOS con su nombre y su estado. Condensa solo si te pasas de 4000, quitando relleno y nunca nombres ni cifras. Responde solo con el texto, sin preámbulo.' },
          ] }],
        })
        const contenido = (msg.content as { type: string; text?: string }[])
          .filter(c => c.type === 'text').map(c => c.text || '').join('').trim().slice(0, 4000)
        if (!contenido) { fallos.push(`${nota.title}: el modelo no devolvió texto`); continue }

        const bloque = `${MARCA}\n${contenido}`
        // Antes del enlace si lo hay, y al final si no. Nada más se toca.
        const nuevo = ENLACE.test(nota.content)
          ? nota.content.replace(ENLACE, (l) => `${bloque}\n\n${l}`)
          : `${nota.content}\n\n${bloque}`

        const { error } = await ctx.admin.from('memoria').update({ content: nuevo }).eq('id', nota.id)
        // El error SÍ se mira: contar como releído uno que no se guardó diría que
        // la IA ya sabe lo que pone dentro cuando sigue sin saberlo.
        if (error) fallos.push(`${nota.title}: ${error.message}`)
        else releidos++
      } catch (e) {
        fallos.push(`${nota.title}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    if (fallos.length) console.error('[memoria-releer] no se pudieron releer:', fallos.join(' | '))
    return NextResponse.json({ releidos, quedan: Math.max(0, lista.length - releidos - fallos.length), fallos })
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e)
    console.error('[memoria-releer] falló la relectura:', motivo)
    return NextResponse.json({ error: motivo }, { status: 500 })
  }
}
