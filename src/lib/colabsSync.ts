import type { SupabaseClient } from '@supabase/supabase-js'
import { acquireLock, releaseLock } from '@/lib/jobLock'
import { esTokenMuerto, esConexionRota } from '@/lib/gmailAuth'
import { getEmailsWithRefreshToken, getGmailAccountEmail } from '@/lib/gmail'
import { analyzeEmail, EmailAnalysis } from '@/lib/ai'
import { sendPushToAll, sendPushToUser, canSendPush } from '@/lib/push'
import { localDayKey } from '@/components/shared/helpers'

const MEETING_RE = /meet\.google\.com\/[a-z-]+|zoom\.us\/j\/\d+|teams\.microsoft\.com\/l\/meetup/i

type SyncResult =
  // `insertFailures` sale al exterior a propósito: con los inserts fallando el
  // resultado es `synced: 0` sobre 20 revisados, que desde fuera es idéntico a
  // "no había nada nuevo". Es el recuento el que distingue las dos cosas.
  | { ok: true; synced: number; total: number; account: string; aiFailures?: number; insertFailures?: number; saltado?: boolean }
  | { ok: false; error: string; code?: number; details?: unknown }


// ─────────────────────────────────────────────────────────────────────────────
// Un cerrojo por buzón, y hace falta de verdad.
//
// Medido en los logs de producción del 2026-08-13: `/api/gmail/colabs-sync` se
// llamó 4 veces en 12 minutos. No es un bug del freno —cada navegador se frena a
// sí mismo 15 minutos con localStorage— es que el freno es POR DISPOSITIVO y el
// buzón es UNO. Siete personas con la app abierta son siete relojes distintos
// sincronizando el mismo correo, más el cron de la hora en punto, que tampoco
// pedía cerrojo: el de sync-colabs solo cubre la purga diaria de retención.
//
// Lo que cuesta cuando dos se solapan: el dedup lee los `gmail_id` ya guardados
// ANTES del bucle y luego analiza y escribe uno a uno. Entre esa lectura y el
// insert de un email cabe otra ejecución entera, así que las dos mandan el MISMO
// correo a Claude y las dos lo pagan. Y si `inbox_messages.gmail_id` no tiene
// UNIQUE en producción —no hay DDL de esa tabla en ningún .sql del repo, es una
// de las que CLAUDE.md avisa que están sin reconciliar— las dos lo insertan, y
// el equipo entero ve el correo duplicado.
//
// El cerrojo es el mismo que ya usan el motor de automatizaciones y la purga:
// se apoya en la PK de Postgres, así que no hay ventana entre comprobar y tomar.
// TTL de 90 s: el presupuesto interno son 25 s y el tope de la función 60 s, de
// modo que una instancia que Vercel corte a los 60 s libera sola 30 s después.
// ─────────────────────────────────────────────────────────────────────────────
const TTL_CERROJO_MS = 90_000

/**
 * Sincroniza el buzón COMPARTIDO de colaboraciones.
 * Es un buzón único de la empresa: usa el refresh token de quien lo tenga conectado
 * (no el del usuario que dispara la sync) e inserta los mensajes como `shared: true`,
 * de modo que aparecen para todo el equipo. Idempotente por `gmail_id`.
 */
export async function syncColabsInbox(
  admin: SupabaseClient,
  opts: { triggeredBy?: string; max?: number } = {}
): Promise<SyncResult> {
  const cerrojo = await acquireLock(admin, 'sync-colabs', TTL_CERROJO_MS)
  // `adquirido: false` es contención real: otra instancia lo está haciendo AHORA.
  // No es un error —el trabajo se está haciendo— así que sale `ok` con `saltado`,
  // y quien lo llamó decide qué contarle al usuario. Devolver un fallo aquí
  // pintaría de rojo una sincronización que en realidad va bien.
  if (!cerrojo.adquirido) return { ok: true, synced: 0, total: 0, account: '', saltado: true }
  try {
    return await syncColabsInboxSinCerrojo(admin, opts)
  } finally {
    // Solo si es NUESTRO. Con `degradado` (la tabla no existe) no se tomó nada.
    if (!cerrojo.degradado) await releaseLock(admin, 'sync-colabs', cerrojo.holder)
  }
}

async function syncColabsInboxSinCerrojo(
  admin: SupabaseClient,
  opts: { triggeredBy?: string; max?: number } = {}
): Promise<SyncResult> {
  // Token del buzón compartido: el MÁS RECIENTE de cualquier perfil que lo tenga
  // (si alguien reconecta, su token nuevo debe ganar al viejo de otro perfil)
  const { data: owner } = await admin
    .from('profiles')
    .select('id, gmail_colabs_refresh_token')
    .not('gmail_colabs_refresh_token', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const token = owner?.gmail_colabs_refresh_token as string | undefined
  if (!token) return { ok: false, error: 'Colaboraciones not connected' }

  // El user_id de los mensajes: quien dispara la sync, o el dueño del buzón (cron)
  const ownerId = opts.triggeredBy || owner!.id

  const { data: clientsData } = await admin.from('clients').select('name')
  const knownClients = (clientsData || []).map((c: { name: string }) => c.name)

  let emails: Awaited<ReturnType<typeof getEmailsWithRefreshToken>>
  let gmailAccount = ''
  try {
    emails = await getEmailsWithRefreshToken(token, opts.max ?? 20)
    gmailAccount = await getGmailAccountEmail(token)
  } catch (err: unknown) {
    const error = err as Error & { code?: number; response?: { data?: { error?: string } } }
    const isTokenExpired = esTokenMuerto(error)
    if (!isTokenExpired && esConexionRota(error)) {
      // Google rechaza la conexión pero puede ser configuración global: se avisa
      // como accionable SIN borrar el token. Ver src/lib/gmailAuth.ts.
      console.error('[sync] Google rechazó la conexión:', error.response?.data?.error)
      return { ok: false, error: 'auth_rota' }
    }
    if (isTokenExpired) {
      await admin.from('profiles').update({ gmail_colabs_connected: false, gmail_colabs_refresh_token: null }).eq('id', owner!.id)
      return { ok: false, error: 'token_expired' }
    }

    return { ok: false, error: error.message || 'Gmail API error', code: error.code, details: error.response?.data }
  }

  let newCount = 0
  let aiFailures = 0
  let insertFailures = 0
  const newUnread: { from_name: string; subject: string; urgent?: boolean }[] = []

  // Una sola consulta para saber cuáles ya existen (antes: un SELECT por email).
  const colabsIds = emails.map(e => e.gmail_id).filter(Boolean)
  const { data: colabsExisting, error: colabsExistingError } = await admin
    .from('inbox_messages')
    .select('gmail_id')
    .in('gmail_id', colabsIds)
  // Se aborta en vez de seguir: esta lista es lo ÚNICO que hace idempotente al
  // bucle. Como supabase-js no lanza, ignorar el error dejaba el Set vacío y la
  // sincronización se ejecutaba a ciegas — una llamada a Claude por CADA email
  // del buzón (hasta 20), y luego el insert rebotando contra el unique de
  // gmail_id, así que se pagaba el análisis entero para sincronizar cero. Cada
  // hora. Ejecutarlo a ciegas cuesta más que no ejecutarlo: lo que falte lo
  // recoge la ejecución siguiente.
  if (colabsExistingError) {
    console.error('[colabs] no se pudieron leer los gmail_id ya guardados:', colabsExistingError.message)
    return { ok: false, error: 'dedup_failed', details: colabsExistingError.message }
  }
  const colabsKnown = new Set((colabsExisting || []).map((r: { gmail_id: string }) => r.gmail_id))

  // Presupuesto de tiempo, igual que en /api/gmail/sync y por el mismo motivo.
  //
  // Cada email nuevo cuesta una llamada a Claude, y en Hobby la funcion se MATA a
  // los 60s. El cron llama a esta funcion LA PRIMERA y sin comprobar el reloj: con
  // una tanda grande en el buzon compartido se comia el tiempo entero, moria a
  // mitad del bucle y se llevaba por delante el push y todo lo que venia despues
  // —los buzones personales, el motor de automatizaciones y la purga—, sin dejar
  // rastro mas alla de un timeout en Vercel.
  //
  // Al agotarse se sale limpiamente: lo ya insertado queda guardado, el push sale,
  // y los emails que falten los recoge la ejecucion de la hora siguiente (el bucle
  // salta los gmail_id ya conocidos, asi que no se repite trabajo).
  //
  // 25s y no 45 como en /api/gmail/sync: alli la funcion solo hace eso, mientras
  // que aqui el cron tiene por delante los buzones personales de las 7 personas,
  // las automatizaciones y la purga dentro del mismo minuto.
  const T0 = Date.now()
  const PRESUPUESTO_MS = 25_000
  let truncado = false

  for (const email of emails) {
    if (colabsKnown.has(email.gmail_id)) continue
    if (Date.now() - T0 > PRESUPUESTO_MS) { truncado = true; break }

    let analysis: EmailAnalysis = { summary: email.subject || '(sin asunto)', action: 'Revisar email', client: 'Desconocido', urgency: 'normal' }
    try {
      analysis = await analyzeEmail(email.subject || '', (email.body_preview || '').slice(0, 800), email.from_name, knownClients)
    } catch { aiFailures++ }
    // analyzeEmail NO lanza: captura por dentro y devuelve el fallback básico,
    // así que el catch de arriba era código muerto y aiFailures siempre 0.
    // La señal real es `degraded`. No se puede loguear por email (~3.400
    // iteraciones al día, retención corta en Hobby): se agrega al final.
    if (analysis.degraded) aiFailures++

    const { error: insertError } = await admin.from('inbox_messages').insert({
      user_id: ownerId,
      source: 'gmail',
      gmail_id: email.gmail_id,
      from_name: email.from_name,
      from_email: email.from_email,
      subject: email.subject,
      body_preview: email.body_preview,
      ai_summary: analysis.summary,
      ai_action: analysis.action,
      ai_client: analysis.client,
      ai_urgency: analysis.urgency,
      is_read: !email.is_unread,
      is_unread: email.is_unread,
      received_at: email.received_at,
      shared: true,
      attachments: email.attachments?.length ? email.attachments : [],
    })

    if (insertError) {
      // Visible a propósito: el análisis con Claude ocurre ANTES del insert, así
      // que si el insert falla el gmail_id no se guarda y el siguiente cron
      // vuelve a analizar el mismo email. Cada hora. Para siempre. Sin este log
      // el bucle es invisible y solo se nota en la factura.
      console.error('[sync] insert falló para gmail_id', email.gmail_id, '—', insertError.message)
      insertFailures++
    } else {
      newCount++
      // Email con enlace de reunión → tarea con fecha (aparece en el Calendario)
      const meetingText = `${email.subject || ''} ${email.body_preview || ''}`
      if (MEETING_RE.test(meetingText)) {
        // localDayKey, no slice: `received_at` viene en UTC y cortarlo da el día
      // UTC. Un email recibido a las 00:30 de Madrid generaba la tarea con la
      // fecha de AYER, o sea vencida en el momento de crearse.
      const day = localDayKey(email.received_at || Date.now())
        await admin.from('tasks').insert({
          created_by: ownerId,
          text: `Reunión: ${email.subject || email.from_name || 'sin asunto'}`,
          level: 'high',
          due_date: day,
          source: 'gmail',
        })
      }
      if (email.is_unread) newUnread.push({ from_name: email.from_name || '?', subject: email.subject || '(sin asunto)', urgent: analysis.urgency === 'urgent' })
    }
  }

  // Los emails de colaboraciones son de todo el equipo: push a todos los suscritos (rate-limit 90s)
  if (newUnread.length > 0) {
    const first = newUnread[0]
    const anyUrgent = newUnread.some(m => m.urgent)
    if (await canSendPush(admin, 'company')) {
      // CON await, igual que en /api/gmail/sync y por lo mismo. Sin el, el envio
      // quedaba pendiente al devolver la funcion y en serverless eso es una
      // loteria: la instancia se congela o se recicla, y a sendPushToAll aun le
      // quedaban una consulta a reglas, un insert en notification_log y las
      // llamadas a web-push. Lo grave es que canSendPush() YA ha escrito last_sent,
      // asi que la ventana de 90s se consume igual: el aviso no se reintenta, se
      // pierde. Y este es el del buzon COMPARTIDO, que avisa a los siete.
      try {
        await sendPushToAll(admin, {
          title: anyUrgent ? `🔴 URGENTE · Colabs · ${first.from_name}`
            : newUnread.length === 1 ? `📩 Colabs · ${first.from_name}` : `📩 Colabs · ${newUnread.length} emails nuevos`,
          body: newUnread.length === 1 ? first.subject : `${first.from_name}: ${first.subject} y ${newUnread.length - 1} más`,
          url: '/dashboard',
          tag: 'colabs-sync',
          urgent: anyUrgent,
        })
      } catch (err) {
        console.error('[colabs] el push fallo:', err)
      }
    }
  }

  if (aiFailures) console.error(`[sync] analyzeEmail falló en ${aiFailures} de ${emails.length} emails`)
  if (insertFailures) console.error(`[colabs] ${insertFailures} de ${emails.length} emails analizados no se pudieron guardar`)
  // `truncado` sale al exterior: si aparece de forma sostenida, el buzon compartido
  // no cabe en el presupuesto y hay que repartirlo en mas ejecuciones. Callarlo
  // dejaria el problema invisible, que es como empezo este.
  if (truncado) console.warn(`[colabs] sin tiempo: quedan emails sin analizar, se recogen en la siguiente ejecucion`)
  return { ok: true, synced: newCount, total: emails.length, account: gmailAccount, aiFailures, insertFailures, ...(truncado ? { truncado: true } : {}) }
}

/**
 * Sincroniza el Gmail PERSONAL de un perfil (para el cron horario: los emails
 * llegan y notifican aunque nadie tenga la app abierta). Idempotente por gmail_id.
 */
export async function syncPersonalInbox(
  admin: SupabaseClient,
  profile: { id: string; gmail_refresh_token: string | null }
): Promise<SyncResult> {
  // Por usuario y no global: son buzones distintos y no compiten entre sí. Lo que
  // sí compite es la MISMA persona en el portátil y en el móvil —dos localStorage,
  // dos relojes— y el cron, que recorre todos los perfiles conectados.
  const clave = `sync-personal-${profile.id}`
  const cerrojo = await acquireLock(admin, clave, TTL_CERROJO_MS)
  if (!cerrojo.adquirido) return { ok: true, synced: 0, total: 0, account: '', saltado: true }
  try {
    return await syncPersonalInboxSinCerrojo(admin, profile)
  } finally {
    if (!cerrojo.degradado) await releaseLock(admin, clave, cerrojo.holder)
  }
}

async function syncPersonalInboxSinCerrojo(
  admin: SupabaseClient,
  profile: { id: string; gmail_refresh_token: string | null }
): Promise<SyncResult> {
  const token = profile.gmail_refresh_token
  if (!token) return { ok: false, error: 'not connected' }

  const { data: clientsData } = await admin.from('clients').select('name')
  const knownClients = (clientsData || []).map((c: { name: string }) => c.name)

  let emails: Awaited<ReturnType<typeof getEmailsWithRefreshToken>>
  let gmailAccount = ''
  try {
    emails = await getEmailsWithRefreshToken(token, 15)
    gmailAccount = await getGmailAccountEmail(token)
  } catch (err: unknown) {
    const error = err as Error & { code?: number; response?: { data?: { error?: string } } }
    const isTokenExpired = esTokenMuerto(error)
    if (!isTokenExpired && esConexionRota(error)) {
      // Google rechaza la conexión pero puede ser configuración global: se avisa
      // como accionable SIN borrar el token. Ver src/lib/gmailAuth.ts.
      console.error('[sync] Google rechazó la conexión:', error.response?.data?.error)
      return { ok: false, error: 'auth_rota' }
    }
    if (isTokenExpired) {
      await admin.from('profiles').update({ gmail_connected: false, gmail_refresh_token: null }).eq('id', profile.id)
      return { ok: false, error: 'token_expired' }
    }

    return { ok: false, error: error.message || 'Gmail API error', code: error.code }
  }

  let newCount = 0
  let aiFailures = 0
  let insertFailures = 0
  const newUnread: { from_name: string; subject: string; urgent?: boolean }[] = []

  // Una sola consulta para saber cuáles ya existen (antes: un SELECT por email).
  const personalIds = emails.map(e => e.gmail_id).filter(Boolean)
  const { data: personalExisting, error: personalExistingError } = await admin
    .from('inbox_messages')
    .select('gmail_id')
    .in('gmail_id', personalIds)
  // Mismo corte que en syncColabsInbox y por lo mismo: sin la lista de conocidos
  // el bucle no es idempotente y se paga una llamada a Claude por email para no
  // guardar ninguno (el unique de gmail_id rechaza los repetidos). Y aquí se
  // multiplica por las 7 personas del cron, así que es donde más cuesta.
  if (personalExistingError) {
    console.error('[sync personal] no se pudieron leer los gmail_id ya guardados:', personalExistingError.message)
    return { ok: false, error: 'dedup_failed', details: personalExistingError.message }
  }
  const personalKnown = new Set((personalExisting || []).map((r: { gmail_id: string }) => r.gmail_id))

  // Presupuesto de tiempo, gemelo del de syncColabsInbox. Se le puso alli y aqui
  // no, y esta funcion la llama el cron UNA VEZ POR CADA persona con Gmail
  // conectado: siete buzones en serie, cada email nuevo con su llamada a Claude, y
  // la funcion muere a los 60s de Hobby. Sin tope, un buzon con tanda grande se
  // come lo que quede del minuto y se lleva por delante los demas, el motor de
  // automatizaciones y la purga.
  //
  // 12s y no 25: aqui se multiplica por el numero de personas, mientras que el
  // compartido es uno solo. Al agotarse se sale limpiamente y lo que falte lo
  // recoge la ejecucion siguiente — el bucle salta los gmail_id ya conocidos.
  const T0 = Date.now()
  const PRESUPUESTO_MS = 12_000
  let truncado = false

  for (const email of emails) {
    if (personalKnown.has(email.gmail_id)) continue
    if (Date.now() - T0 > PRESUPUESTO_MS) { truncado = true; break }

    let analysis: EmailAnalysis = { summary: email.subject || '(sin asunto)', action: 'Revisar email', client: 'Desconocido', urgency: 'normal' }
    try {
      analysis = await analyzeEmail(email.subject || '', (email.body_preview || '').slice(0, 800), email.from_name, knownClients)
    } catch { aiFailures++ }
    if (analysis.degraded) aiFailures++

    const { error: insertError } = await admin.from('inbox_messages').insert({
      user_id: profile.id,
      source: 'gmail',
      gmail_id: email.gmail_id,
      from_name: email.from_name,
      from_email: email.from_email,
      subject: email.subject,
      body_preview: email.body_preview,
      ai_summary: analysis.summary,
      ai_action: analysis.action,
      ai_client: analysis.client,
      ai_urgency: analysis.urgency,
      is_read: !email.is_unread,
      is_unread: email.is_unread,
      received_at: email.received_at,
      shared: false,
      attachments: email.attachments?.length ? email.attachments : [],
    })
    if (insertError) {
      // Mismo motivo que en syncColabsInbox: el análisis con Claude va ANTES del
      // insert, así que si el insert falla el gmail_id no queda guardado y el
      // cron vuelve a analizar el mismo email a la hora siguiente, y a la
      // siguiente. Sin este log el bucle era invisible aquí —la rama era un
      // `if (!insertError)` pelado— y solo se notaba en la factura de Anthropic.
      console.error('[sync personal] insert falló para gmail_id', email.gmail_id, '—', insertError.message)
      insertFailures++
    } else {
      newCount++
      if (email.is_unread) newUnread.push({ from_name: email.from_name || '?', subject: email.subject || '(sin asunto)', urgent: analysis.urgency === 'urgent' })
    }
  }

  if (newUnread.length > 0) {
    const first = newUnread[0]
    const anyUrgent = newUnread.some(m => m.urgent)
    // Mismo caso que el de arriba: sin await el envio se pierde en cuanto la
    // instancia se congela, y la ventana de 90s ya esta gastada.
    if (await canSendPush(admin, profile.id)) {
      try {
        await sendPushToUser(admin, profile.id, {
          title: anyUrgent ? `🔴 URGENTE · ${first.from_name}`
            : newUnread.length === 1 ? `📩 ${first.from_name}` : `📩 ${newUnread.length} emails nuevos`,
          body: newUnread.length === 1 ? first.subject : `${first.from_name}: ${first.subject} y ${newUnread.length - 1} más`,
          url: '/dashboard',
          tag: 'gmail-personal',
          urgent: anyUrgent,
        })
      } catch (err) {
        console.error('[sync personal] el push fallo:', err)
      }
    }
  }

  if (aiFailures) console.error(`[sync] analyzeEmail falló en ${aiFailures} de ${emails.length} emails`)
  if (insertFailures) console.error(`[sync personal] ${insertFailures} de ${emails.length} emails analizados no se pudieron guardar`)
  if (truncado) console.warn('[sync personal] sin tiempo: quedan emails sin analizar, se recogen en la siguiente ejecucion')
  return { ok: true, synced: newCount, total: emails.length, account: gmailAccount, aiFailures, insertFailures, ...(truncado ? { truncado: true } : {}) }
}
