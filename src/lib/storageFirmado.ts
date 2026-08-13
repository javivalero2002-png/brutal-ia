import type { SupabaseClient } from '@supabase/supabase-js'
import { rutaDeStorage } from '@/lib/taskAttachments'

// Convierte las URLs del Storage que salen de la base en permisos TEMPORALES.
//
// El problema que resuelve: el bucket `content-videos` era público, y dentro hay
// contratos, presupuestos y briefs. Público ahí significa literalmente que quien
// tenga la dirección se lo descarga — sin sesión, sin contraseña. Comprobado el
// 2026-08-13: un adjunto de tarea respondía 200 desde fuera, sin credenciales.
//
// Por qué se firma AL LEER y no se migran las columnas:
//
// Las columnas (`projects.cover_url`, `content_agenda.cover_url`,
// `task_attachments.url`…) guardan la URL pública como texto. Migrarlas a rutas
// obligaría a tocar los 17 sitios que las pintan y a reescribir filas existentes.
// En vez de eso, la cadena guardada pasa a ser un IDENTIFICADOR: sigue teniendo
// forma de URL, `rutaDeStorage()` le saca el bucket y la ruta, y aquí se cambia
// por una URL firmada justo antes de mandarla al cliente.
//
// Resultado: cero migración de datos, y la interfaz no se entera — sigue pintando
// `src={item.cover_url}` como siempre.
//
// El riesgo que queda, y conviene saberlo: si una ruta de lectura se olvida de
// llamar aquí, sus imágenes salen rotas. Es un fallo VISIBLE, no silencioso, y por
// eso se prefiere a la alternativa (dejar el bucket abierto).

// Una jornada, no una hora.
//
// La primera version puso 60 minutos «porque al recargar se renuevan», y eso es
// falso en una PWA: instalada en el movil no se recarga NUNCA — se deja abierta y
// se vuelve a ella. A la hora, las portadas y los PDF empezaban a dar 400 sin que
// el usuario hubiera hecho nada raro.
//
// Se acompaña de un refresco al volver a la app (NexusDashboard), que vuelve a
// firmar todo. Las dos cosas juntas: la ventana larga cubre el uso normal, y el
// refresco cubre a quien deja la app abierta el fin de semana.
const VIGENCIA_SEGUNDOS = 12 * 60 * 60

/**
 * Firma una URL guardada. Devuelve la original si no es del Storage (vídeos de
 * YouTube en `video_url`, por ejemplo) y `null` si el fichero ya no está.
 */
export async function firmarUrl(admin: SupabaseClient, url: unknown): Promise<string | null> {
  if (typeof url !== 'string' || !url.trim()) return null
  const r = rutaDeStorage(url)
  // No es del Storage: `content_agenda.video_url` admite enlaces de YouTube o
  // Vimeo, que se incrustan tal cual y no hay que tocar.
  if (!r) return url
  const { data, error } = await admin.storage.from(r.bucket).createSignedUrl(r.path, VIGENCIA_SEGUNDOS)
  if (error || !data?.signedUrl) {
    // Se registra y se devuelve null en vez de la URL vieja: con el bucket cerrado
    // esa URL da 400, y un enlace roto que parece bueno confunde más que un hueco.
    console.error('[storage] no se pudo firmar', r.path, '—', error?.message)
    return null
  }
  return data.signedUrl
}

/**
 * Firma, en el sitio, los campos indicados de una fila o de una lista de filas.
 * Pensado para envolver el `data` de una consulta justo antes del NextResponse.
 *
 * Firma en paralelo: con 20 tareas y sus adjuntos, hacerlo en serie añadiría
 * fácilmente un segundo a la respuesta.
 */
export async function firmarCampos<T extends Record<string, unknown>>(
  admin: SupabaseClient,
  filas: T | T[] | null,
  campos: string[],
): Promise<T | T[] | null> {
  if (!filas) return filas
  const lista = Array.isArray(filas) ? filas : [filas]

  await Promise.all(lista.flatMap(fila =>
    campos
      .filter(c => typeof fila?.[c] === 'string' && (fila[c] as string).trim() !== '')
      .map(async c => { (fila as Record<string, unknown>)[c] = await firmarUrl(admin, fila[c]) }),
  ))

  return filas
}
