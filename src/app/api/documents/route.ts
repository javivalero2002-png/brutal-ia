import { createClient, createAdminClient } from '@/lib/supabase/server'
import { firmarUrl } from '@/lib/storageFirmado'
import { rutaDeStorage } from '@/lib/taskAttachments'
import { checkAiRateLimit } from '@/lib/rate-limit'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'crypto'
import { isOwnStorageUrl } from '@/lib/safeFetch'
import { textOf } from '@/lib/aiText'

export const maxDuration = 60

// Sin topes, el SDK se queda con 10 MINUTOS de timeout y 2 reintentos: quien
// acaba cortando es la plataforma al llegar al techo de 60s del plan Hobby, y
// entonces no hay ni mensaje de error ni log — la petición muere a secas. El
// timeout del SDK es POR INTENTO, así que un reintento no cabe dentro de esos
// 60s: maxRetries 0 y un tope que deja margen para responder con un error de
// verdad en vez de que nos maten desde fuera.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 45_000, maxRetries: 0 })
const BUCKET = 'content-videos'
const MAX_BYTES = 20 * 1024 * 1024

// Sube un PDF a Supabase Storage y genera un resumen con Haiku (barato).
// Deduplica por hash SHA-256: el mismo archivo nunca se sube dos veces.
/**
 * Descarga un fichero del Storage por su identificador, con el service role.
 *
 * Sustituye a `fetch(urlPublica)`. Dos motivos, y el segundo es el bueno:
 *   · con el bucket cerrado esa URL devuelve 400, asi que dejaria de funcionar;
 *   · y sobre todo, quita del medio un `fetch()` del SERVIDOR a una URL que llega
 *     en el body. Eso era una primitiva de lectura con canal de salida —esta ruta
 *     devuelve el resumen que Claude hace de lo descargado— que habia que
 *     defender con isOwnStorageUrl(). Bajando por la API de Storage no hay
 *     peticion saliente que envenenar: se pide un objeto por su ruta, y punto.
 */
async function bajarDelStorage(admin: any, url: string): Promise<Buffer | null> {
  const r = rutaDeStorage(url)
  if (!r) return null
  const { data, error } = await admin.storage.from(r.bucket).download(r.path)
  if (error || !data) {
    console.error('[storage] no se pudo descargar', r.path, '—', error?.message)
    return null
  }
  return Buffer.from(await data.arrayBuffer())
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  if (await checkAiRateLimit(admin, user.id, 'doc')) {
    return NextResponse.json({ error: 'Demasiadas solicitudes. Espera un momento.' }, { status: 429 })
  }

  const contentType = request.headers.get('content-type') || ''
  let buffer: Buffer
  let filename: string
  let publicUrl: string

  if (contentType.includes('application/json')) {
    // Opción A: cliente ya subió a Supabase, nos manda la URL pública
    const { url, name } = await request.json().catch(() => ({}))
    if (!url) return NextResponse.json({ error: 'Falta la URL del documento' }, { status: 400 })
    // Solo el Storage propio: esta ruta devuelve el resumen que Claude hace del
    // contenido descargado, así que una URL arbitraria sería lectura con salida.
    if (!isOwnStorageUrl(url)) return NextResponse.json({ error: 'URL de documento no permitida' }, { status: 400 })
    filename = name || 'documento.pdf'
    publicUrl = url
    // Descargar para generar el resumen con Claude
    const admin0 = await createAdminClient()
    const bajado = await bajarDelStorage(admin0, url)
    if (!bajado) return NextResponse.json({ error: 'No se pudo leer el archivo subido' }, { status: 502 })
    buffer = bajado
  } else {
    // Opción B (legacy): FormData con el archivo
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No se recibió el archivo' }, { status: 400 })
    if (file.type !== 'application/pdf') return NextResponse.json({ error: 'Solo se admiten PDF' }, { status: 415 })
    if (file.size > MAX_BYTES) return NextResponse.json({ error: `El PDF supera 20 MB (${(file.size/1024/1024).toFixed(0)} MB).` }, { status: 413 })
    filename = file.name
    buffer = Buffer.from(await file.arrayBuffer())

    // public:false — si el bucket se borrara, recrearlo ABIERTO devolveria los
  // contratos y presupuestos a la intemperie. Ver src/lib/storageFirmado.ts.
  await admin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_BYTES }).then(() => {}, () => {})
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16)
    const path = `docs/${hash}.pdf`
    const { data: existing } = await admin.storage.from(BUCKET).list('docs', { search: `${hash}.pdf` })
    if (existing && existing.length > 0) {
      publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
    } else {
      const { error: ue } = await admin.storage.from(BUCKET).upload(path, buffer, { contentType: 'application/pdf', upsert: false })
      if (ue) return NextResponse.json({ error: 'Error al subir: ' + ue.message }, { status: 500 })
      publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
    }
  }

  // Resumen con Haiku
  let summary = ''
  try {
    if (buffer.length < 20 * 1024 * 1024) {
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } } as any,
          { type: 'text', text: 'Resume este documento para la base de conocimiento de Brutal Studios. En español, 80-150 palabras: de qué trata, datos clave (cliente, presupuesto, fechas, entregables) y puntos importantes. Sin preámbulos.' }
        ] }],
      })
      summary = textOf(msg).trim()
    } else {
      summary = 'Documento subido (demasiado grande para resumir automáticamente).'
    }
  } catch {
    summary = 'Documento subido. (No se pudo generar el resumen automático.)'
  }

  // Se devuelve la forma PUBLICA, no una firmada, y es deliberado: MemoriaSection
  // guarda este valor dentro del texto de la nota ("📎 Documento: <url>"), asi que
  // una URL firmada quedaria escrita ahi y caducaria en una hora.
  //
  // RESUELTO el 2026-08-13 (commit 3496b49). Esto decia que los enlaces de
  // documentos de Memoria eran lo unico que NO sobrevivia al cierre del bucket, y
  // terminaba con «hasta entonces, NO cerrar el bucket». El diagnostico era
  // correcto y la solucion que proponia es la que se hizo: `/api/archivo`
  // comprueba la sesion y redirige a una firma fresca, y MemoriaSection guarda ya
  // ese enlace en vez de la URL cruda.
  //
  // Se reescribe en vez de borrarse porque la frase de antes es la que iba a leer
  // quien fuera a decidir si cerrar el bucket, y decia que no.
  //
  // Lo que SI queda: las notas creadas entre el 2026-07-30 y el 2026-08-13 llevan
  // la URL publica cruda dentro de `memoria.content`, que es texto libre y nadie
  // parsea. Se arreglan a mano desde la app anteponiendoles el enlace estable.
  return NextResponse.json({ url: publicUrl, name: filename, summary })
}
