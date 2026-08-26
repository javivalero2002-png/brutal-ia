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
  let datos: { tipo: string; cliente: string; sector: string; fechas: string; importe: string } | null = null
  // El documento en texto plano. Es lo que separa «sé de qué va este PDF» de «sé
  // qué campaña hicimos con Nutella»: el resumen de 80-150 palabras no nombra ni
  // la mitad de las cosas que hay dentro.
  let contenido = ''
  try {
    if (buffer.length < 20 * 1024 * 1024) {
      // La MISMA llamada de siempre —un documento se lee UNA vez y nunca más—,
      // pero devolviendo DATOS además de prosa. El resumen suelto convertía cada
      // documento en una nota huérfana: nadie sabía de qué cliente era, así que no
      // aparecía al mirar ese cliente y Harvey no podía relacionarlo con nada.
      // Extraer el cliente aquí no cuesta ni un céntimo más y es lo que convierte
      // el documento en conocimiento en vez de en un archivo guardado.
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        // Sube de 700 porque ahora se pide el CONTENIDO, no solo el resumen.
        max_tokens: 3000,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } } as any,
          { type: 'text', text: `Analiza este documento para la base de conocimiento de Brutal Studios, una agencia creativa.

Responde SOLO con un objeto JSON, sin texto alrededor y sin vallas de código:
{
  "resumen": "80-150 palabras en español: de qué trata, datos clave y puntos importantes. Sin preámbulos.",
  "contenido": "el documento ENTERO en texto plano, hasta 4000 caracteres. Condensa solo si se pasa de ahí, y condensa quitando relleno, NUNCA quitando nombres ni cifras.",
  "tipo": "presupuesto | contrato | brief | factura | propuesta | informe | otro",
  "cliente": "nombre de la empresa CLIENTE, tal cual aparece. Cadena vacía si no hay uno claro.",
  "sector": "sector del cliente en una o dos palabras, o cadena vacía",
  "fechas": "las fechas relevantes, en una línea, o cadena vacía",
  "importe": "el importe principal con su moneda, o cadena vacía"
}

Para "contenido": esto NO es un resumen, es el documento. Lo lee una IA para
contestar preguntas concretas, así que lo que importa es que estén los NOMBRES
PROPIOS tal cual (marcas, personas, formatos, agencias), los estados de cada cosa
(aprobado, rechazado, en proceso), las cifras y las fechas. Si el documento es una
lista de proyectos, tienen que aparecer TODOS con su nombre y su estado — un
resumen que dice «cinco propuestas» y no dice cuáles no sirve para nada. Mantén el
orden y los apartados del original.

Para "cliente": el cliente ES QUIEN CONTRATA. Brutal Studios NO es el cliente: si
el documento lo emite Brutal Studios, el cliente es el destinatario. Si no estás
razonablemente seguro, deja la cadena vacía — es mejor no decir nada que decir un
nombre equivocado.` }
        ] }],
      })
      const bruto = textOf(msg).trim()
      try {
        // El modelo a veces envuelve el JSON en vallas pese a pedírselo.
        const limpio = bruto.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
        const j = JSON.parse(limpio)
        summary = String(j.resumen || '').trim()
        contenido = String(j.contenido || '').trim().slice(0, 4000)
        datos = {
          tipo: String(j.tipo || '').trim(),
          cliente: String(j.cliente || '').trim(),
          sector: String(j.sector || '').trim(),
          fechas: String(j.fechas || '').trim(),
          importe: String(j.importe || '').trim(),
        }
      } catch {
        // Si no vino JSON, el texto SIGUE valiendo como resumen: se degrada al
        // comportamiento de antes en vez de perder el análisis que ya se ha pagado.
        summary = bruto
      }
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
  // ¿Ese cliente ya lo tenemos? Se compara sin tildes, mayúsculas ni S.L.: «Zara»,
  // «ZARA» e «Inditex, S.L.» escritos de tres formas son el mismo cliente, y sin
  // esto el documento se quedaría suelto o propondría dar de alta un duplicado.
  let clientId: string | null = null
  let clientePropuesto: { nombre: string; sector: string } | null = null
  if (datos?.cliente) {
    const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\b(s\.?l\.?u?|s\.?a\.?|sl|sa|inc|ltd|llc)\b/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
    const objetivo = norm(datos.cliente)
    const { data: clientes, error: errCli } = await admin.from('clients').select('id,name')
    // Un fallo al leer clientes NO puede leerse como «no existe»: propondría dar
    // de alta uno que ya está, y duplicar un cliente ensucia Proyectos y Reportes.
    if (errCli) console.error('[documents] no se pudieron leer los clientes:', errCli.message)
    else {
      const ya = (clientes || []).find(c => objetivo && norm(c.name || '') === objetivo)
      if (ya) clientId = ya.id
      else if (objetivo.length > 2) clientePropuesto = { nombre: datos.cliente, sector: datos.sector || '' }
    }
  }

  return NextResponse.json({ url: publicUrl, name: filename, summary, contenido, datos, clientId, clientePropuesto })
}
