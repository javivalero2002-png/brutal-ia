import { getAuthCtx } from '@/lib/authz'
import { firmarUrl } from '@/lib/storageFirmado'
import { BUCKET_CONTENIDO } from '@/lib/safeFetch'
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

// Los ficheros de UNA factura: el PDF que se manda, el justificante de la
// transferencia, el albarán firmado.
//
// SIN COLUMNA NUEVA, y por tanto sin migración: los ficheros viven en el Storage
// bajo `facturas/<id>/` y la lista sale de mirar esa carpeta. Es el mismo patrón
// que `clients/[id]/files`, que lleva meses funcionando así. Una columna
// `archivo_url` habría hecho falta solo para guardar UN fichero, y una factura
// tiene el PDF y el justificante — o sea que la columna se habría quedado corta el
// primer día.

export const maxDuration = 60
const MAX_BYTES = 10 * 1024 * 1024 // 10MB
const carpeta = (id: string) => `facturas/${id}`

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data: files, error } = await ctx.admin.storage.from(BUCKET_CONTENIDO)
    .list(carpeta(id), { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })
  // El error NO se disfraza de «sin ficheros»: una factura con su PDF dentro y una
  // consulta caída se verían igual, y la segunda es la que hace pensar que se ha
  // perdido el documento.
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // En paralelo: firmar en serie añade segundos a una lista que se pide cada vez
  // que se abre la ficha de un cliente con varias facturas.
  const archivos = await Promise.all((files || []).map(async f => {
    const path = `${carpeta(id)}/${f.name}`
    return {
      // El prefijo de orden se le quita al NOMBRE, no al path: el path es la
      // identidad del fichero y tiene que seguir apuntando a lo que hay guardado.
      name: f.name.replace(/^\d{13}-[0-9a-f]{8}-/, ''),
      path,
      size: f.metadata?.size || 0,
      type: f.metadata?.mimetype || '',
      created_at: f.created_at,
      url: await firmarUrl(ctx.admin, ctx.admin.storage.from(BUCKET_CONTENIDO).getPublicUrl(path).data.publicUrl),
    }
  }))
  return NextResponse.json(archivos)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Mismo cerrojo que crear y editar la factura: la facturación es del propietario.
  if (ctx.role !== 'owner') return NextResponse.json({ error: 'Solo el propietario factura' }, { status: 403 })

  const { id } = await params
  let formData: FormData
  try { formData = await request.formData() } catch { return NextResponse.json({ error: 'Formulario inválido' }, { status: 400 }) }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Archivo demasiado grande (máx. 10MB)' }, { status: 413 })

  // public:false — si el bucket se borrara, recrearlo ABIERTO dejaría las facturas
  // del estudio a la intemperie. Ver src/lib/storageFirmado.ts.
  await ctx.admin.storage.createBucket(BUCKET_CONTENIDO, { public: false }).then(() => {}, () => {})

  const safe = file.name.replace(/[^a-zA-Z0-9._\-\s]/g, '_').replace(/\s+/g, '_').slice(0, 120)
  // Sufijo aleatorio: dos personas subiendo el mismo «factura.pdf» a la vez no se
  // pisan. Y el prefijo de tiempo mantiene el orden de la carpeta.
  const path = `${carpeta(id)}/${Date.now()}-${randomUUID().slice(0, 8)}-${safe}`

  const { error: ue } = await ctx.admin.storage.from(BUCKET_CONTENIDO)
    .upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || 'application/octet-stream', upsert: false,
    })
  if (ue) return NextResponse.json({ error: ue.message }, { status: 500 })

  const url = await firmarUrl(ctx.admin, ctx.admin.storage.from(BUCKET_CONTENIDO).getPublicUrl(path).data.publicUrl)
  return NextResponse.json({ name: file.name, path, size: file.size, type: file.type, url })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (ctx.role !== 'owner') return NextResponse.json({ error: 'Solo el propietario factura' }, { status: 403 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const path: string = body?.path || ''
  // El path tiene que estar DENTRO de esta factura. Sin esto, mandar
  // `facturas/otra/…` —o `copias/…`— borraría un fichero ajeno con el service role.
  if (!path.startsWith(`${carpeta(id)}/`)) return NextResponse.json({ error: 'Ruta inválida' }, { status: 400 })

  // El error SE MIRA: un borrado que falla y responde `ok` deja el fichero vivo y a
  // quien lo pidió creyendo que ya no está.
  const { error } = await ctx.admin.storage.from(BUCKET_CONTENIDO).remove([path])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
