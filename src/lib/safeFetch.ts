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
  return u.pathname.startsWith('/storage/v1/object/')
}
