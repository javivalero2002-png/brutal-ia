// Valida que una URL enviada por el cliente apunte al Storage propio.
//
// Por qué: /api/documents y /api/projects/analyze-pdf hacen `fetch(url)` con una
// URL que llega en el body. Sin validar, cualquier usuario autenticado podía
// hacer que el servidor descargase lo que quisiera — y /api/documents ADEMÁS
// devuelve el resumen que Claude hace de lo descargado, así que no es un SSRF
// ciego: es una primitiva de lectura con canal de exfiltración. En Vercel eso
// alcanza cualquier endpoint accesible desde la función.
//
// Los dos llamantes legítimos (MemoriaSection y ProyectosSection) siempre mandan
// un getPublicUrl() del propio Supabase, así que restringir a ese host no rompe
// ningún flujo real.

function supabaseHost(): string | null {
  try {
    const raw = process.env.NEXT_PUBLIC_SUPABASE_URL
    return raw ? new URL(raw).host : null
  } catch { return null }
}

/** true si la URL es https y apunta al host de Supabase del proyecto. */
export function isOwnStorageUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || !raw) return false
  const host = supabaseHost()
  if (!host) return false
  let u: URL
  try { u = new URL(raw) } catch { return false }
  // Solo https: http permitiría degradar a redes internas por nombre.
  if (u.protocol !== 'https:') return false
  if (u.host !== host) return false
  // Y la RUTA, no solo el host. Esto se usa en dos sitios con consecuencias
  // distintas: para decidir a donde hace `fetch` el servidor, y para decidir a
  // donde redirige /api/archivo. En el segundo, aceptar cualquier ruta del host de
  // Supabase convierte un enlace de brutalia.tech en un salto a la API de Supabase
  // — que es justo lo que hace creible un phishing, y encima con nuestro dominio
  // delante. A 7 personas con sesion es menor; cuesta una linea.
  // Y EL BUCKET, no solo el prefijo. Aqui faltaba, y con el prefijo suelto la
  // comprobacion aceptaba tambien `/storage/v1/object/public/copias/…`.
  //
  // Lo que eso abria: `/api/archivo` pide sesion pero NO rol, y firma con el
  // service role —que se salta que el bucket sea privado— y redirige 307 a una URL
  // valida doce horas. O sea que cualquiera de los siete, sin ser propietario, se
  // descargaba la copia entera de la base fabricando la URL a mano; y el nombre del
  // fichero es `AAAA-MM-DD.json.gz`, o sea que no hay nada que adivinar.
  //
  // Enfrente, `/api/admin/backup` corta con `role !== 'owner'` y el motivo esta
  // escrito al lado: «quien cobra cuanto, que se habla de cada cliente, el diario
  // de cada uno». La mitad de eso ya lo ve un miembro por la API normal, pero
  // `inbox_messages` (el correo personal de los siete) y `chat_messages` (las
  // conversaciones privadas con Harvey) no: esas la app las filtra por persona.
  //
  // `content-videos` es el unico bucket donde vive contenido de usuario. Los tres
  // sitios que usan esta funcion —el visor de archivos, el analisis de PDF y el de
  // documentos— solo tienen que alcanzar ese.
  return /^\/storage\/v1\/object\/(public|sign)\/content-videos\//.test(u.pathname)
}
