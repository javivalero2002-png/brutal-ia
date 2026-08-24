import type { SupabaseClient } from '@supabase/supabase-js'
import { cuentaCompartida, cuentasDe, quitarCuenta } from '@/lib/gmailCuentas'
import { aplazarResto } from '@/lib/aplazarCorreos'
import { insertarEnInbox } from '@/lib/inboxInsert'
import { triar, remitentesConocidos, dominiosPropios } from '@/lib/inboxTriage'
import { acquireLock, releaseLock } from '@/lib/jobLock'
import { esTokenMuerto, esConexionRota, avisarConexionCaida } from '@/lib/gmailAuth'
import { getEmailsWithRefreshToken, getGmailAccountEmail } from '@/lib/gmail'
import { analyzeEmail, EmailAnalysis, plazoRestante, MINIMO_UTIL_MS } from '@/lib/ai'
import { sendPushToAll, sendPushToUser, canSendPush } from '@/lib/push'
import { localDayKey } from '@/components/shared/helpers'

const MEETING_RE = /meet\.google\.com\/[a-z-]+|zoom\.us\/j\/\d+|teams\.microsoft\.com\/l\/meetup/i

type SyncResult =
  // `insertFailures` sale al exterior a propósito: con los inserts fallando el
  // resultado es `synced: 0` sobre 20 revisados, que desde fuera es idéntico a
  // "no había nada nuevo". Es el recuento el que distingue las dos cosas.
  | { ok: true; synced: number; total: number; account: string; aiFailures?: number; insertFailures?: number; saltado?: boolean
      // `truncado` ya viajaba en los `return` pero no estaba en el tipo, asi que
      // leerlo desde fuera no compilaba. Al recorrer varias cuentas hace falta:
      // es la senal de parar y dejar el resto para la pasada siguiente.
      truncado?: boolean }
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

// Topes POR BUZON, mas estrictos que lo que cabe en la funcion.
//
// No son redundantes con `plazoRestante`: ese protege a la funcion de morirse,
// estos reparten el minuto entre los ocho buzones que el cron recorre seguidos
// (el compartido + los 7 personales) para que no se lo coma el primero. Los borre
// al cambiar de palanca y el reparto del cron se quedo describiendo algo que ya no
// pasaba — ver el comentario de src/app/api/cron/sync-colabs/route.ts.
const TOPE_COLABS_MS = 25_000
const TOPE_PERSONAL_MS = 20_000

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
  // De `gmail_cuentas`, buscando por la MARCA de compartida y no por la dirección:
  // quién decide cuál es el buzón común es quien lo conectó, no una constante.
  //
  // El respaldo por las columnas viejas se queda mientras existan. No es cinturón y
  // tirantes por si acaso: es lo que hace que desplegar esto sin haber corrido la
  // migración no deje al equipo sin correo compartido.
  const compartida = await cuentaCompartida(admin)
  let token = compartida?.refresh_token as string | undefined
  // De quién es esa conexión: para saber a quién avisar si se cae y a quién
  // atribuir los correos. Venga de la tabla o de las columnas viejas, un solo
  // nombre — si no, cada uso de abajo tendría que preguntar de dónde salió.
  let duenoConexion: string | null = compartida?.profile_id ?? null
  // La direccion, para poder decir DE QUE BUZON entro cada correo. Se resuelve
  // aqui junto al token porque los dos caminos —tabla nueva y columnas viejas—
  // tienen que dejar el mismo nombre puesto.
  let correoCuenta: string | null = compartida?.email ?? null
  if (!token) {
    const { data: owner } = await admin
      .from('profiles')
      .select('id, gmail_colabs_refresh_token, gmail_colabs_account')
      .not('gmail_colabs_refresh_token', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    token = owner?.gmail_colabs_refresh_token as string | undefined
    duenoConexion = owner?.id ?? null
    correoCuenta = (owner?.gmail_colabs_account as string | undefined) || 'colaboraciones@brutalstudios.es'
    if (token) console.warn('[colabs] usando el token de profiles: ¿falta correr 20260820_gmail_cuentas.sql?')
  }
  if (!token) return { ok: false, error: 'Colaboraciones not connected' }

  // El user_id de los mensajes: quien dispara la sync, o el dueño del buzón (cron)
  const ownerId = opts.triggeredBy || duenoConexion!

  const { data: clientsData } = await admin.from('clients').select('name')
  const knownClients = (clientsData || []).map((c: { name: string }) => c.name)

  // T0 arranca AQUI, no junto al bucle: el fetch de Gmail y sus consultas tambien
  // gastan del minuto de la funcion. Medirlo desde despues era contar solo una
  // parte y creer que sobraba tiempo.
  const T0 = Date.now()

  let emails: Awaited<ReturnType<typeof getEmailsWithRefreshToken>>
  let gmailAccount = ''
  try {
    emails = await getEmailsWithRefreshToken(token, opts.max ?? 40)
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
      await admin.from('profiles').update({ gmail_colabs_connected: false, gmail_colabs_refresh_token: null }).eq('id', duenoConexion!)
      // Y se AVISA. Hasta ahora se borraba la conexión y se devolvía un error que
      // nadie proactivo leía: el correo del buzón compartido dejaba de entrar en
      // silencio, y con el modo de prueba de Google eso pasa cada siete días.
      await avisarConexionCaida(admin, duenoConexion!, 'colabs')
      return { ok: false, error: 'token_expired' }
    }

    return { ok: false, error: error.message || 'Gmail API error', code: error.code, details: error.response?.data }
  }

  let newCount = 0
  let aiFailures = 0
  let insertFailures = 0
  let omitidos = 0

  // La criba, preparada una vez fuera del bucle: es una consulta.
  const DOMINIOS = dominiosPropios()
  const CONOCIDOS = await remitentesConocidos(admin)
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
  // El tope de abajo es el que cabe en la funcion; el 25 s es una eleccion PROPIA
  // y mas estricta (ver comentario de arriba). Se toma el menor, para que la
  // intencion se conserve y el invariante no dependa de que alguien recuerde.
  let truncado = false
  // Dónde se rompió el bucle. Arranca en `length` porque si NO se rompe no
  // queda nada detrás — y así `emails.slice(corte)` sale vacío sin casos aparte.
  let corte = emails.length

  // Indexado para saber POR DÓNDE se cortó: sin el índice no hay forma de
  // guardar lo que queda detrás, y lo que queda detrás se pierde para siempre.
  for (const [indice, email] of emails.entries()) {
    if (colabsKnown.has(email.gmail_id)) continue
    // Dos limites, y hacen falta los dos:
    //  · `plazoRestante` es el de la FUNCION — no empezar una llamada que no quepa;
    //  · `TOPE_COLABS_MS` es una eleccion PROPIA y mas estricta, porque quien llama
    //    a esto suele ser el cron y detras van los 7 buzones personales, el motor y
    //    la purga dentro de la misma ejecucion.
    //
    // El Math.min existia y lo borre yo al cambiar de palanca, dejando estos
    // comentarios describiendo un tope que ya no estaba. Sin el, el reparto del
    // cron se queda sin base: 51 s por buzon en vez de 25 no caben siete veces.
    // ¿Le pagamos un análisis? NO decide si se guarda: se guarda siempre.
    const { analizar, motivo } = triar(email, DOMINIOS, CONOCIDOS)

    let analysis: EmailAnalysis | null = null
    let estado: 'ok' | 'omitido' | 'pendiente' | 'fallo' = 'omitido'

    if (analizar) {
      // La guarda de tiempo va DESPUÉS de la criba: un correo omitido cuesta cero
      // milisegundos, así que no debe gastar plaza del presupuesto ni quedarse
      // fuera por falta de tiempo.
      const plazo = Math.min(plazoRestante(T0, 60), TOPE_COLABS_MS - (Date.now() - T0))
      if (plazo < MINIMO_UTIL_MS) { truncado = true; corte = indice; break }
      try {
        analysis = await analyzeEmail(email.subject || '', (email.body_preview || '').slice(0, 800), email.from_name, knownClients, plazo)
      } catch { aiFailures++ }
      estado = !analysis || analysis.degraded ? 'fallo' : 'ok'
    } else {
      omitidos++
    }
    // analyzeEmail NO lanza: captura por dentro y devuelve el fallback básico,
    // así que el catch de arriba era código muerto y aiFailures siempre 0.
    // La señal real es `degraded`. No se puede loguear por email (~3.400
    // iteraciones al día, retención corta en Hobby): se agrega al final.
    if (analysis?.degraded) aiFailures++

    const { error: insertError } = await insertarEnInbox(admin, {
      user_id: ownerId,
      source: 'gmail',
      gmail_id: email.gmail_id,
      from_name: email.from_name,
      from_email: email.from_email,
      subject: email.subject,
      body_preview: email.body_preview,
      // NULL, no un resumen inventado: el fallback sacaba el correo del filtro
      // de Clientes y del contador de Prioridad, y encima hacía que la pantalla
      // pintara un panel «BRUTAL.IA — ANÁLISIS» sobre algo que la IA no vio.
      ai_summary: analysis?.summary ?? null,
      ai_action: analysis?.action ?? null,
      ai_client: analysis?.client ?? null,
      ai_urgency: analysis?.urgency ?? null,
      ai_estado: estado,
      ai_motivo: analizar ? null : motivo,
      is_read: !email.is_unread,
      is_unread: email.is_unread,
      received_at: email.received_at,
      shared: true,
      cuenta: correoCuenta,
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
      // Solo si el correo mereció análisis. Un webinar promocional con enlace de
      // Zoom casa este patrón igual que la reunión de un cliente, y crearía una
      // tarea con fecha en el calendario de todo el equipo.
      if (analizar && MEETING_RE.test(meetingText)) {
        // localDayKey, no slice: `received_at` viene en UTC y cortarlo da el día
      // UTC. Un email recibido a las 00:30 de Madrid generaba la tarea con la
      // fecha de AYER, o sea vencida en el momento de crearse.
      const day = localDayKey(email.received_at || Date.now())
        // El error SE MIRA, igual que en el insert hermano de veinte lineas arriba.
        // Se registra y no se corta: convertirlo en `continue` romperia otra cosa
        // —se saltarian newUnread.push y newCount++ para un correo que SI se
        // guardo—. Y no se reintenta solo: el gmail_id ya esta en la base, asi que
        // el siguiente sync hace `continue` y la tarea no vuelve a intentarse nunca.
        const { error: reunionErr } = await admin.from('tasks').insert({
          created_by: ownerId,
          text: `Reunión: ${email.subject || email.from_name || 'sin asunto'}`,
          level: 'high',
          due_date: day,
          source: 'gmail',
        })
        if (reunionErr) console.error('[colabs] no se pudo crear la tarea de reunión:', reunionErr.message)
      }
      if (email.is_unread) newUnread.push({ from_name: email.from_name || '?', subject: email.subject || '(sin asunto)', urgent: analysis?.urgency === 'urgent' })
    }
  }

  // Lo que quedó detrás del corte se APLAZA, no se pierde. Ver aplazarCorreos.ts:
  // la ventana de Gmail no pagina, así que un correo que no entra aquí no vuelve.
  if (truncado) {
    const aplazados = await aplazarResto(
      admin,
      emails.slice(corte).filter(e => !colabsKnown.has(e.gmail_id)),
      { userId: ownerId, shared: true, etiqueta: 'colabs', cuenta: correoCuenta },
    )
    if (aplazados) console.log('[colabs] aplazados', aplazados, 'correos para la siguiente pasada')
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
          categoria: 'correo',
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
  /**
   * `analizar_correo`: si esta persona quiere que su correo PERSONAL pase por el
   * modelo. Opcional para no romper a quien llame sin él, y con `!== false` abajo
   * para que la ausencia signifique «sí» — que es como estaba antes.
   */
  profile: { id: string; gmail_refresh_token: string | null; analizar_correo?: boolean | null }
): Promise<SyncResult> {
  // Por usuario y no global: son buzones distintos y no compiten entre sí. Lo que
  // sí compite es la MISMA persona en el portátil y en el móvil —dos localStorage,
  // dos relojes— y el cron, que recorre todos los perfiles conectados.
  const clave = `sync-personal-${profile.id}`
  const cerrojo = await acquireLock(admin, clave, TTL_CERROJO_MS)
  if (!cerrojo.adquirido) return { ok: true, synced: 0, total: 0, account: '', saltado: true }
  try {
    // UNA PASADA POR CADA CUENTA PROPIA, no una y ya.
    //
    // Antes cada persona tenía exactamente un buzón personal, porque el token vivía
    // en una columna. Ahora puede tener varios —los jefes quieren su Gmail y su
    // dirección de empresa— así que se recorren todos dentro del MISMO cerrojo:
    // son de la misma persona y no compiten entre sí, y un cerrojo por cuenta
    // multiplicaría las filas de bloqueo sin evitar nada.
    //
    // Las compartidas se excluyen aquí: de esas se encarga `syncColabsInbox`, y
    // sincronizarlas dos veces duplicaría el trabajo de análisis por cada persona
    // que la tenga conectada.
    const cuentas = (await cuentasDe(admin, profile.id)).filter(c => !c.compartida)

    // Sin cuentas en la tabla se usa la columna vieja. Es lo que permite desplegar
    // esto antes de correr la migración sin dejar a nadie sin correo.
    if (!cuentas.length) return await syncPersonalInboxSinCerrojo(admin, profile, profile.gmail_refresh_token, '')

    let total = 0, synced = 0, aiFailures = 0, insertFailures = 0
    // `algunoTruncado` y no `truncado`: esto NO es un punto de corte por tiempo
    // —los cortes están dentro de cada pasada y cada uno aplaza lo suyo—, es solo
    // recoger la señal para no empezar la cuenta siguiente. La regla de
    // regresiones.test.ts cuenta cortes y exige un rescate por cada uno; llamarlo
    // igual la haría contar uno de más y ponerse roja sin fallo.
    let algunoTruncado = false
    const cuentasOk: string[] = []
    let ultimoError: string | null = null
    for (const c of cuentas) {
      const r = await syncPersonalInboxSinCerrojo(admin, profile, c.refresh_token, c.email)
      if (!r.ok) { ultimoError = r.error; continue }
      total += r.total || 0; synced += r.synced || 0
      aiFailures += r.aiFailures || 0; insertFailures += r.insertFailures || 0
      if (r.truncado) algunoTruncado = true
      cuentasOk.push(c.email)
      // Si una cuenta se queda sin tiempo, la siguiente tampoco lo tendrá: el
      // presupuesto es de la función entera, no de cada buzón. Parar aquí deja el
      // resto para la pasada siguiente en vez de gastar el tiempo que no hay.
      if (r.truncado) break
    }
    if (!cuentasOk.length) return { ok: false, error: ultimoError || 'not connected' }
    return { ok: true, synced, total, account: cuentasOk.join(', '), aiFailures, insertFailures, ...(algunoTruncado ? { truncado: true } : {}) }
  } finally {
    if (!cerrojo.degradado) await releaseLock(admin, clave, cerrojo.holder)
  }
}

async function syncPersonalInboxSinCerrojo(
  admin: SupabaseClient,
  profile: { id: string; gmail_refresh_token: string | null; analizar_correo?: boolean | null },
  /** El token de ESTA cuenta. Se pasa desde fuera porque ahora hay varias. */
  token: string | null,
  /** Su dirección, solo para poder decir cuál falló. Vacía = la columna vieja. */
  correoCuenta: string,
): Promise<SyncResult> {
  if (!token) return { ok: false, error: 'not connected' }

  const { data: clientsData } = await admin.from('clients').select('name')
  const knownClients = (clientsData || []).map((c: { name: string }) => c.name)

  // T0 arranca AQUI, no junto al bucle: el fetch de Gmail y sus consultas tambien
  // gastan del minuto de la funcion. Medirlo desde despues era contar solo una
  // parte y creer que sobraba tiempo.
  const T0 = Date.now()

  let emails: Awaited<ReturnType<typeof getEmailsWithRefreshToken>>
  let gmailAccount = ''
  try {
    emails = await getEmailsWithRefreshToken(token, 40)
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
      // POR CUENTA, no por perfil entero.
      //
      // Antes esto vaciaba `profiles.gmail_refresh_token` sin mirar cuál de las
      // cuentas de la persona era la que acababa de caducar. Con una sola cuenta
      // daba igual — era la única que había—; con varias, la caducada podía ser la
      // secundaria y esto borraba el token de la BUENA, que seguía viva. El
      // resultado: la pantalla decía «no conectado» sobre una cuenta que
      // funcionaba, y la de verdad muerta se reintentaba para siempre porque nadie
      // la borraba de `gmail_cuentas`.
      if (correoCuenta) {
        await quitarCuenta(admin, profile.id, correoCuenta)
        // Si esa dirección es también la de las columnas viejas, se limpian —
        // `quitarCuenta` ya lo hace por dentro comparándola con `gmail_account`.
      } else {
        // El camino de respaldo (tabla vacía, sin migración corrida): solo existe
        // esta cuenta, así que sigue siendo correcto vaciar el perfil entero.
        await admin.from('profiles').update({ gmail_connected: false, gmail_refresh_token: null }).eq('id', profile.id)
      }
      await avisarConexionCaida(admin, profile.id, 'personal', correoCuenta || undefined)
      return { ok: false, error: 'token_expired' }
    }

    return { ok: false, error: error.message || 'Gmail API error', code: error.code }
  }

  let newCount = 0
  let aiFailures = 0
  let insertFailures = 0
  let omitidos = 0

  // La criba, preparada una vez fuera del bucle: es una consulta.
  const DOMINIOS = dominiosPropios()
  const CONOCIDOS = await remitentesConocidos(admin)
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
  let truncado = false
  // Dónde se rompió el bucle. Arranca en `length` porque si NO se rompe no
  // queda nada detrás — y así `emails.slice(corte)` sale vacío sin casos aparte.
  let corte = emails.length

  // Indexado para saber POR DÓNDE se cortó: sin el índice no hay forma de
  // guardar lo que queda detrás, y lo que queda detrás se pierde para siempre.
  for (const [indice, email] of emails.entries()) {
    if (personalKnown.has(email.gmail_id)) continue
    // Igual que el del buzon compartido, con el tope personal: son SIETE dentro
    // de la misma ejecucion del cron.
    // ¿Le pagamos un análisis? NO decide si se guarda: se guarda siempre.
    const { analizar, motivo } = triar(email, DOMINIOS, CONOCIDOS, profile.analizar_correo !== false)

    let analysis: EmailAnalysis | null = null
    let estado: 'ok' | 'omitido' | 'pendiente' | 'fallo' = 'omitido'

    if (analizar) {
      // La guarda de tiempo va DESPUÉS de la criba: un correo omitido cuesta cero
      // milisegundos, así que no debe gastar plaza del presupuesto ni quedarse
      // fuera por falta de tiempo.
      const plazo = Math.min(plazoRestante(T0, 60), TOPE_PERSONAL_MS - (Date.now() - T0))
      if (plazo < MINIMO_UTIL_MS) { truncado = true; corte = indice; break }
      try {
        analysis = await analyzeEmail(email.subject || '', (email.body_preview || '').slice(0, 800), email.from_name, knownClients, plazo)
      } catch { aiFailures++ }
      estado = !analysis || analysis.degraded ? 'fallo' : 'ok'
    } else {
      omitidos++
    }
    if (analysis?.degraded) aiFailures++

    const { error: insertError } = await insertarEnInbox(admin, {
      user_id: profile.id,
      source: 'gmail',
      gmail_id: email.gmail_id,
      from_name: email.from_name,
      from_email: email.from_email,
      subject: email.subject,
      body_preview: email.body_preview,
      // NULL, no un resumen inventado: el fallback sacaba el correo del filtro
      // de Clientes y del contador de Prioridad, y encima hacía que la pantalla
      // pintara un panel «BRUTAL.IA — ANÁLISIS» sobre algo que la IA no vio.
      ai_summary: analysis?.summary ?? null,
      ai_action: analysis?.action ?? null,
      ai_client: analysis?.client ?? null,
      ai_urgency: analysis?.urgency ?? null,
      ai_estado: estado,
      ai_motivo: analizar ? null : motivo,
      is_read: !email.is_unread,
      is_unread: email.is_unread,
      received_at: email.received_at,
      shared: false,
      cuenta: correoCuenta || null,
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

      // Tarea de reunión, IGUAL que en el buzón compartido.
      //
      // Esto faltaba aquí y no en la ruta manual, así que un enlace de Meet en tu
      // Gmail personal creaba tarea SOLO si pulsabas el botón a mano: el cron
      // horario se la saltaba. Dos caminos que hacen lo mismo con distinto
      // resultado — el gemelo clásico, y de los silenciosos, porque nadie echa de
      // menos una tarea que no sabe que debería existir.
      //
      // Con la guarda de `analizar`, como en colabs y a diferencia de la ruta
      // manual: un boletín promocional con un enlace de Zoom no es una reunión
      // tuya, y crear esa tarea es peor que no crearla.
      const meetingText = `${email.subject || ''} ${email.body_preview || ''}`
      if (analizar && MEETING_RE.test(meetingText)) {
        // localDayKey, no slice: `received_at` viene en UTC y cortarlo da el día
        // UTC. Un email recibido a las 00:30 de Madrid generaba la tarea con la
        // fecha de AYER, o sea vencida en el momento de crearse.
        const day = localDayKey(email.received_at || Date.now())
        const { error: reunionErr } = await admin.from('tasks').insert({
          created_by: profile.id,
          // `assigned_to`: es TU buzón personal, así que la reunión es tuya. En
          // colabs va sin asignar porque ese correo es de los siete.
          assigned_to: profile.id,
          text: `Reunión: ${email.subject || email.from_name || 'sin asunto'}`,
          level: 'high',
          due_date: day,
          source: 'gmail',
        })
        if (reunionErr) console.error('[sync personal] no se pudo crear la tarea de reunión:', reunionErr.message)
      }

      if (email.is_unread) newUnread.push({ from_name: email.from_name || '?', subject: email.subject || '(sin asunto)', urgent: analysis?.urgency === 'urgent' })
    }
  }

  // Igual que en el buzón compartido y en /api/gmail/sync: lo que quedó detrás del
  // corte se aplaza en vez de perderse. Ver aplazarCorreos.ts.
  if (truncado) {
    const aplazados = await aplazarResto(
      admin,
      emails.slice(corte).filter(e => !personalKnown.has(e.gmail_id)),
      { userId: profile.id, shared: false, etiqueta: 'sync personal', cuenta: correoCuenta || null },
    )
    if (aplazados) console.log('[sync personal] aplazados', aplazados, 'correos para la siguiente pasada')
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
          categoria: 'correo',
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
