import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Lo que queda detrás del corte por tiempo SE GUARDA, marcado como pendiente.
 *
 * POR QUÉ EXISTE ESTO, que es lo que hay que entender antes de tocarlo: la ventana
 * de correos de una pasada **no pagina**. `messages.list` devuelve los N más
 * recientes y ya está — no hay «página siguiente» ni relleno hacia atrás. Así que
 * un correo que se queda detrás del corte no es un correo que se verá luego: es un
 * correo que **no se verá nunca**, porque en la pasada siguiente ya no estará entre
 * los más recientes. Y no falla nada ni se registra nada: desaparece en silencio.
 *
 * Guardarlo con `ai_estado: 'pendiente'` convierte «quedarse sin tiempo» de PERDER
 * correo en APLAZARLO. Entra en la Bandeja, en la búsqueda y en lo que ve Harvey;
 * lo único que le falta es el análisis, y eso se recupera.
 *
 * Y ESTÁ AQUÍ, EN UN SOLO SITIO, A PROPÓSITO. Estaba escrito solo en
 * `/api/gmail/sync` y faltaba en las DOS funciones del cron (`colabsSync`), que son
 * las que corren cada hora sin que nadie mire. O sea el fallo de fondo de este
 * repo: el mismo arreglo hecho en una copia y vivo en la otra. Con una función y
 * tres llamadas, el siguiente que aparezca ya nace arreglado.
 */

export type CorreoAplazable = {
  gmail_id: string
  from_name?: string | null
  from_email?: string | null
  subject?: string | null
  body_preview?: string | null
  is_unread?: boolean
  received_at?: string | null
  attachments?: unknown[] | null
}

export async function aplazarResto(
  admin: SupabaseClient,
  resto: CorreoAplazable[],
  destino: { userId: string; shared: boolean; etiqueta: string },
): Promise<number> {
  if (!resto.length) return 0
  const cola = resto.map(e => ({
    user_id: destino.userId,
    source: 'gmail',
    gmail_id: e.gmail_id,
    from_name: e.from_name,
    from_email: e.from_email,
    subject: e.subject,
    body_preview: e.body_preview,
    is_read: !e.is_unread,
    is_unread: e.is_unread,
    received_at: e.received_at,
    shared: destino.shared,
    attachments: e.attachments?.length ? e.attachments : [],
    ai_estado: 'pendiente',
  }))
  // `gmail_id` es UNIQUE, así que esto es idempotente: si la pasada siguiente los
  // vuelve a traer, el insert rebota entero y no duplica.
  const { error } = await admin.from('inbox_messages').insert(cola)
  if (error) {
    // Se registra y no se lanza: perder el aplazamiento es malo, pero tumbar la
    // sync entera por ello es peor — lo ya guardado en esta pasada se queda.
    console.error(`[${destino.etiqueta}] no se pudo aplazar el resto de correos:`, error.message)
    return 0
  }
  return cola.length
}
