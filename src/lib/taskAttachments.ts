import type { SupabaseClient } from '@supabase/supabase-js'

// Ficheros de los adjuntos de tarea en Supabase Storage.
//
// Por qué esto vive en un módulo y no en cada ruta: `task_attachments.task_id` es
// ON DELETE CASCADE (migrations/20260809_task_attachments.sql), así que al borrar
// una tarea las filas se van solas — y con ellas la ÚNICA referencia al objeto. El
// fichero se queda en `content-videos`, que es un bucket PÚBLICO con contratos,
// presupuestos y briefs: huérfano, accesible por URL y ya imposible de inventariar
// desde la app. Hay que borrarlo a mano en los tres sitios que borran adjuntos
// (tarea suelta, tarea en lote y adjunto individual), y tres copias de este código
// es exactamente la fábrica de gemelos que la auditoría vino a cerrar.

/** Saca bucket y ruta de una URL de Storage, pública o firmada. `null` si no casa. */
export function rutaDeStorage(url: unknown): { bucket: string; path: string } | null {
  if (typeof url !== 'string' || !url) return null
  try {
    const m = new URL(url).pathname.match(/\/object\/(?:public|sign)\/([^/]+)\/(.+)$/)
    return m ? { bucket: m[1], path: decodeURIComponent(m[2]) } : null
  } catch { return null }
}

/**
 * Borra del Storage los ficheros de unos adjuntos, agrupando por bucket para no
 * hacer una llamada por fichero (importa en el borrado en lote, que puede llevar
 * cientos y va dentro de una función de 60s).
 *
 * Best-effort a propósito: registra los fallos pero nunca los propaga. Lo contrario
 * dejaría una tarea imposible de borrar por culpa de un adjunto que ya no está.
 */
export async function borrarFicherosDeAdjuntos(
  admin: SupabaseClient,
  urls: unknown[],
  etiqueta = '[tasks]',
): Promise<void> {
  const porBucket = new Map<string, string[]>()
  for (const url of urls) {
    const r = rutaDeStorage(url)
    // Una URL con otro formato (bucket renombrado, dominio propio) es justo el caso
    // que deja huérfanos sin rastro: tiene que verse en los logs.
    if (!r) {
      if (url) console.error(`${etiqueta} adjunto con URL que no casa el patrón de Storage, su fichero se queda:`, url)
      continue
    }
    porBucket.set(r.bucket, [...(porBucket.get(r.bucket) || []), r.path])
  }
  for (const [bucket, paths] of porBucket) {
    // La API de Storage de supabase-js tampoco lanza: devuelve { data, error }.
    const { error } = await admin.storage.from(bucket).remove(paths)
    if (error) console.error(`${etiqueta} no se pudieron borrar ${paths.length} fichero(s) de ${bucket}:`, error.message)
  }
}
