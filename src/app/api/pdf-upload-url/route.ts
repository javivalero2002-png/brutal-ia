import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'

const BUCKET = 'content-videos'
const MAX_MB = 50

// Devuelve una signed upload URL para que el cliente suba el PDF directamente
// a Supabase sin pasar por el límite de body de Next.js/Vercel.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { filename, size, prefix = 'pdfs' } = await request.json().catch(() => ({}))
  if (!filename) return NextResponse.json({ error: 'Falta el nombre del archivo' }, { status: 400 })
  // El tamaño es obligatorio: sin él no se puede validar el límite antes de subir.
  if (typeof size !== 'number' || size <= 0) {
    return NextResponse.json({ error: 'Falta el tamaño del archivo' }, { status: 400 })
  }
  if (size > MAX_MB * 1024 * 1024) {
    return NextResponse.json({ error: `El PDF supera ${MAX_MB} MB` }, { status: 413 })
  }

  const admin = await createAdminClient()
  await admin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_MB * 1024 * 1024 }).then(() => {}, () => {})

  // Path deterministico por nombre+tamaño para reutilizar si ya existe
  // El nombre del objeto lleva un componente ALEATORIO, no solo el hash del
  // fichero.
  //
  // Antes era md5(nombre + tamaño + usuario) con upsert:true, o sea DETERMINISTA:
  // adjuntar el mismo fichero a dos tareas daba un unico objeto en Storage con dos
  // filas apuntando a el. Borrar el adjunto de una borraba el fichero de LA OTRA,
  // que se quedaba con un enlace roto y sin ninguna pista de por que. Y subir una
  // version revisada del mismo nombre y tamaño pisaba la anterior en silencio.
  //
  // Se pierde la deduplicacion, que a esta escala no compensa: un fichero repetido
  // ocupa dos veces, pero ningun borrado se lleva por delante el de otro.
  const slug = createHash('md5').update(`${filename}-${size || 0}-${user.id}`).digest('hex').slice(0, 10)
    + '-' + crypto.randomUUID().slice(0, 8)
  // La extensión sale del propio fichero, no se fuerza a .pdf. Antes, cualquier
  // subida que no acabara en .pdf recibía ese sufijo: las portadas de proyecto
  // (`project-covers`, que son JPEG/PNG) se guardaban como `<md5>.jpg.pdf`, con
  // el tipo equivocado. Allowlist para que el nombre del cliente no decida la
  // extensión del objeto almacenado.
  const ALLOWED = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov', 'webm'])
  const raw = (filename.split('.').pop() || '').toLowerCase()
  // Lo que no esta en la lista se RECHAZA, no se renombra. Antes recibia `.pdf`:
  // un .docx o un .zip se guardaba y se servia como PDF, asi que al abrirlo el
  // visor daba un fichero corrupto y nadie relacionaba una cosa con la otra.
  if (!ALLOWED.has(raw)) {
    return NextResponse.json(
      { error: `No se admite ese tipo de archivo (.${raw || 'sin extensión'}). Acepta PDF, imagen o vídeo.` },
      { status: 400 },
    )
  }
  const ext = `.${raw}`
  const path = `${prefix}/${slug}${ext}`

  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true })
  if (error || !data) return NextResponse.json({ error: 'No se pudo generar la URL de subida' }, { status: 500 })

  const publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl

  return NextResponse.json({ signedUrl: data.signedUrl, token: data.token, path, publicUrl })
}
