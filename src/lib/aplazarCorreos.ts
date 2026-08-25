import type { SupabaseClient } from '@supabase/supabase-js'
import { acquireLock, releaseLock } from '@/lib/jobLock'
import { analyzeEmail, plazoRestante, MINIMO_UTIL_MS } from '@/lib/ai'
import { insertarEnInbox } from '@/lib/inboxInsert'

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
  /** `cuenta` es la dirección del buzón por el que entró. Sin ella los correos
 *  aplazados aparecen sin atribuir y el selector de buzones no los ve. */
  destino: { userId: string; shared: boolean; etiqueta: string; cuenta: string | null },
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
    cuenta: destino.cuenta,
    attachments: e.attachments?.length ? e.attachments : [],
    ai_estado: 'pendiente',
  }))
  // `gmail_id` es UNIQUE, así que esto es idempotente: si la pasada siguiente los
  // vuelve a traer, el insert rebota entero y no duplica.
  const { error } = await insertarEnInbox(admin, cola)
  if (error) {
    // Se registra y no se lanza: perder el aplazamiento es malo, pero tumbar la
    // sync entera por ello es peor — lo ya guardado en esta pasada se queda.
    console.error(`[${destino.etiqueta}] no se pudo aplazar el resto de correos:`, error.message)
    return 0
  }
  return cola.length
}

/**
 * Vuelve a mirar los correos que se aplazaron por falta de tiempo.
 *
 * Sin esto, `ai_estado: 'pendiente'` era una vía muerta: los tres bucles del sync
 * hacen `continue` sobre cualquier `gmail_id` ya guardado, así que un correo
 * aplazado no se volvía a analizar NUNCA. Se quedaba en la bandeja sin resumen,
 * sin urgencia y fuera del filtro de Clientes — y la única salida era abrirlo a
 * mano y pulsar reanalizar. Hoy hay 27 así.
 *
 * No hace falta volver a Gmail: el cuerpo ya está guardado en `body_preview`, que
 * es exactamente lo que usa el reanálisis manual.
 *
 * ACOTADO POR TIEMPO Y POR NÚMERO. Corre con lo que sobra del cron, después de los
 * buzones, así que lo primero es no comerse el minuto de nadie: pregunta si cabe
 * la siguiente llamada antes de hacerla, en vez de comprobar entre iteraciones si
 * ya se pasó. Es la lección que CLAUDE.md documenta sobre los presupuestos.
 */
export async function rescatarAplazados(
  admin: SupabaseClient,
  plazoMs: number,
  max = 12,
): Promise<{ rescatados: number; quedan: number }> {
  const T0 = Date.now()
  // `plazoRestante` y no una resta a mano: es el mismo reloj que usa el resto del
  // repo, y la regla de regresiones exige que todo bucle que llama a `analyzeEmail`
  // pregunte por él. El segundo argumento son los segundos de vida de la función.
  const restante = () => Math.min(plazoMs - (Date.now() - T0), plazoRestante(T0, 300))
  // Por debajo del mínimo útil no cabe ni una llamada: no se empieza.
  if (restante() < MINIMO_UTIL_MS) return { rescatados: 0, quedan: -1 }

  // CERROJO PROPIO. Sin él, dos ejecuciones solapadas del cron analizarían los
  // mismos correos aplazados y se pagaría dos veces cada uno — que es exactamente
  // lo que el cerrojo del sync evita para el correo nuevo.
  const cerrojo = await acquireLock(admin, 'aplazados', 5 * 60_000)
  if (!cerrojo.adquirido) return { rescatados: 0, quedan: -1 }
  try {

  const { data: pendientes, error } = await admin
    .from('inbox_messages')
    .select('id, subject, body_preview, from_name')
    .eq('ai_estado', 'pendiente')
    .order('received_at', { ascending: false })
    .limit(max)
  if (error) {
    console.error('[aplazados] no se pudieron leer —', error.message)
    return { rescatados: 0, quedan: -1 }
  }
  if (!pendientes?.length) return { rescatados: 0, quedan: 0 }

  const { data: clientsData } = await admin.from('clients').select('name')
  const knownClients = (clientsData || []).map((c: { name: string }) => c.name)

  let rescatados = 0
  for (const m of pendientes) {
    // ¿Cabe la SIGUIENTE? No «¿me he pasado?»: eso autoriza una llamada sin saber
    // lo que va a costar, y una sola puede irse a 75s si Google contesta 429.
    if (restante() < MINIMO_UTIL_MS) break
    let a: Awaited<ReturnType<typeof analyzeEmail>> | null = null
    try {
      a = await analyzeEmail(m.subject || '', (m.body_preview || '').slice(0, 800),
        m.from_name || '', knownClients, restante())
    } catch { /* analyzeEmail no lanza, pero por si acaso */ }
    if (!a || a.degraded) continue

    const { error: errUp } = await admin.from('inbox_messages').update({
      ai_summary: a.summary, ai_action: a.action, ai_client: a.client,
      ai_urgency: a.urgency, ai_estado: 'ok', ai_motivo: null,
    }).eq('id', m.id)
    if (errUp) { console.error('[aplazados] no se pudo guardar —', errUp.message); continue }
    rescatados++
  }

  const { count } = await admin
    .from('inbox_messages')
    .select('id', { count: 'exact', head: true })
    .eq('ai_estado', 'pendiente')
  return { rescatados, quedan: count ?? -1 }
  } finally {
    if (!cerrojo.degradado) await releaseLock(admin, 'aplazados', cerrojo.holder)
  }
}
