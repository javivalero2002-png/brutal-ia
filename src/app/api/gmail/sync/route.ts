import { createClient, createAdminClient } from '@/lib/supabase/server'
import { triar, remitentesConocidos, dominiosPropios } from '@/lib/inboxTriage'
import { checkAiRateLimit } from '@/lib/rate-limit'
import { codigoDeFallo } from '@/lib/gmailAuth'
import { getEmailsWithRefreshToken, getGmailAccountEmail } from '@/lib/gmail'
import { analyzeEmail, EmailAnalysis, plazoRestante, MINIMO_UTIL_MS } from '@/lib/ai'
import { acquireLock, releaseLock } from '@/lib/jobLock'
import { NextResponse } from 'next/server'
import { sendPushToUser, sendPushToAll, canSendPush, type PushPayload } from '@/lib/push'
import { localDayKey } from '@/components/shared/helpers'

// Hasta 20 analisis de email con Claude en secuencia: el default de Vercel se queda corto.
export const maxDuration = 60

const MEETING_RE = /meet\.google\.com\/[a-z-]+|zoom\.us\/j\/\d+|teams\.microsoft\.com\/l\/meetup/i

const COMPANY_EMAIL = 'colaboraciones@brutalstudios.es'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  // Tope: el sync analiza hasta 20 correos con el modelo por llamada, así que
  // pulsarlo en bucle es la forma más cara de gastar el presupuesto del mes. El
  // automático del cliente cae aquí también, y le viene bien: si algo lo dispara
  // en bucle, se frena solo en vez de multiplicar la factura.
  if (await checkAiRateLimit(admin, user.id, 'sync')) {
    return NextResponse.json({ error: 'Demasiadas sincronizaciones seguidas. Espera un momento.' }, { status: 429 })
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('gmail_refresh_token, gmail_connected')
    .eq('id', user.id)
    .single()

  if (!profile?.gmail_connected || !profile.gmail_refresh_token) {
    return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 })
  }

  // MISMA clave que syncPersonalInbox de src/lib/colabsSync.ts, y a proposito.
  //
  // Sincronizar un buzon personal esta escrito DOS veces: aqui (lo que dispara el
  // navegador) y alli (lo que dispara el cron). Fusionarlas es un refactor de 250
  // lineas que no toca hacer hoy; compartir la clave del cerrojo cuesta esto y ya
  // impide lo que importa: que las dos copias corran a la vez sobre el mismo
  // buzon, analicen los mismos correos y los paguen dos veces.
  //
  // El freno de 15 min del cliente es por DISPOSITIVO (localStorage): la misma
  // persona en el portatil y en el movil son dos relojes distintos. En los logs de
  // produccion del 2026-08-13 esta ruta se llamo 4 veces en 12 minutos.
  const claveCerrojo = `sync-personal-${user.id}`
  const cerrojo = await acquireLock(admin, claveCerrojo, 90_000)
  if (!cerrojo.adquirido) {
    // 200 y no un error: el trabajo SE ESTA HACIENDO, solo que en otra instancia.
    return NextResponse.json({ synced: 0, total: 0, account: '', saltado: true })
  }
  try {

  const { data: clientsData } = await admin.from('clients').select('name')
  const knownClients = (clientsData || []).map(c => c.name)

  // T0 arranca AQUI, no junto al bucle: el fetch de Gmail y sus consultas tambien
  // gastan del minuto de la funcion. Medirlo desde despues era contar solo una
  // parte y creer que sobraba tiempo.
  const T0 = Date.now()

  let emails: Awaited<ReturnType<typeof getEmailsWithRefreshToken>>
  let gmailAccount = ''
  try {
    emails = await getEmailsWithRefreshToken(profile.gmail_refresh_token, 40)
    gmailAccount = await getGmailAccountEmail(profile.gmail_refresh_token)
  } catch (err: unknown) {
    const error = err as Error & { code?: number; response?: { data?: { error?: string } } }
    const fallo = codigoDeFallo(error)
    if (fallo === 'token_expired') {
      // Solo aquí se borra el token: `invalid_grant` significa que ESE token ya no
      // vale y no hay nada que recuperar.
      await admin.from('profiles').update({ gmail_connected: false, gmail_refresh_token: null }).eq('id', user.id)
      return NextResponse.json(
        { error: 'token_expired', message: 'El token de Gmail ha caducado. Reconecta tu cuenta desde Operativa → Sincronización.' },
        { status: 401 }
      )
    }
    if (fallo === 'auth_rota') {
      // NO se borra el token: `unauthorized_client` puede venir de la configuración
      // global de Google, y borrarlo dejaría a todo el equipo sin poder recuperarse
      // arreglando la variable. Se marca desconectado para que la UI lo diga, y el
      // token se conserva por si la causa era global.
      console.error('[gmail] conexión rechazada por Google:', error.response?.data?.error, '— perfil', user.id)
      await admin.from('profiles').update({ gmail_connected: false }).eq('id', user.id)
      return NextResponse.json(
        { error: 'auth_rota', message: 'Google ha rechazado la conexión. Vuelve a conectar Gmail desde Operativa → Sincronización.' },
        { status: 401 }
      )
    }

    console.error('Gmail sync error:', error.message, error.code)
    return NextResponse.json(
      { error: 'gmail_error', message: 'Error al conectar con Gmail. Inténtalo de nuevo.' },
      { status: 500 }
    )
  }

  // Messages from the company email are visible to the whole team
  const isCompanyAccount = gmailAccount === COMPANY_EMAIL

  // Count existing undone gmail-sourced tasks for this user
  const { count: existingGmailTasks } = await admin
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', user.id)
    .eq('source', 'gmail')
    .eq('done', false)
  let gmailTasksCreated = existingGmailTasks || 0
  const GMAIL_TASK_LIMIT = 4

  let newCount = 0
  let aiFailures = 0
  let insertFailures = 0
  const newUnread: { from_name: string; subject: string; urgency: string }[] = []

  // Una sola consulta para saber cuáles ya existen (antes: un SELECT por email).
  const gmailIds = emails.map(e => e.gmail_id).filter(Boolean)
  const { data: existingRows, error: existingErr } = await admin
    .from('inbox_messages')
    .select('gmail_id')
    .in('gmail_id', gmailIds)
  // Se corta aquí en vez de seguir con el Set vacío (tercera copia de este corte,
  // con las dos de colabsSync). Como supabase-js no lanza, el error pasaba de
  // largo y el bucle dejaba de saltarse lo ya guardado: una llamada a Claude por
  // CADA uno de los 20 emails, y detrás el insert rebotando contra el unique de
  // gmail_id, o sea pagar el análisis entero para sincronizar cero. Sin la lista
  // de conocidos el bucle no es idempotente, y ejecutarlo a ciegas cuesta más que
  // no ejecutarlo: se pide reintentar.
  if (existingErr) {
    console.error('[sync] no se pudieron leer los gmail_id ya guardados:', existingErr.message)
    return NextResponse.json(
      { error: 'dedup_failed', message: 'No se pudo comprobar qué emails ya estaban guardados. Inténtalo de nuevo.' },
      { status: 503 }
    )
  }
  const known = new Set((existingRows || []).map((r: { gmail_id: string }) => r.gmail_id))

  // Presupuesto de tiempo. Cada email nuevo cuesta una llamada a Claude, y en el
  // plan Hobby la funcion se MATA a los 60s: sin margen, el corte llegaba a mitad
  // del bucle y se perdia todo lo de despues — sobre todo la notificacion push de
  // los emails nuevos, que es justo el aviso por el que existe el cron.
  //
  // Al agotarse se sale limpiamente: lo insertado queda guardado, el push se
  // envia, y los emails que faltan los recoge la ejecucion de la hora siguiente
  // (el bucle salta los gmail_id ya conocidos, asi que no se repite trabajo).
  // 45_000 escrito a mano no cabia: el check se hace ANTES de analyzeEmail, asi
  // que pasar en t=44,9 s y encadenar una llamada de 30,5 s termina en t=75,4 —
  // con maxDuration 60, Vercel mata la funcion y el usuario ve un error en vez de
  // un "truncado, sigo en la proxima". Ahora sale del cliente de Anthropic.
  let truncado = false
  let omitidos = 0

  // La criba. Se prepara UNA vez, fuera del bucle: es una consulta.
  const DOMINIOS = dominiosPropios()
  const CONOCIDOS = await remitentesConocidos(admin)

  // El índice, para saber por dónde se cortó y guardar lo que queda.
  let i = 0
  for (; i < emails.length; i++) {
    const email = emails[i]
    if (known.has(email.gmail_id)) continue

    // ¿Le pagamos un análisis? Esto NO decide si se guarda: se guarda siempre.
    const { analizar, motivo } = triar(email, DOMINIOS, CONOCIDOS)

    let analysis: EmailAnalysis | null = null
    let estado: 'ok' | 'omitido' | 'pendiente' | 'fallo' = 'omitido'

    if (analizar) {
      // La guarda de tiempo va DESPUÉS de la criba, y es deliberado: un correo
      // omitido cuesta cero milisegundos, así que no tiene sentido gastarle una
      // plaza del presupuesto ni dejarlo fuera por falta de tiempo.
      // ¿Cabe la SIGUIENTE, no me he pasado ya. La diferencia importa: la guarda
      // vieja autorizaba una llamada sin saber lo que iba a costar.
      const plazo = plazoRestante(T0, 60)
      if (plazo < MINIMO_UTIL_MS) { truncado = true; break }
      try {
        analysis = await analyzeEmail(
          email.subject || '',
          (email.body_preview || '').slice(0, 800),
          email.from_name,
          knownClients,
          plazo,
        )
      } catch {
        aiFailures++
      }
      // analyzeEmail captura por dentro y no lanza: la señal real de degradación
      // es este flag, no el catch de arriba.
      if (analysis?.degraded) aiFailures++
      estado = !analysis ? 'fallo' : analysis.degraded ? 'fallo' : 'ok'
    } else {
      omitidos++
    }

    const { error: insertErr } = await admin.from('inbox_messages').insert({
      user_id: user.id,
      source: 'gmail',
      gmail_id: email.gmail_id,
      from_name: email.from_name,
      from_email: email.from_email,
      subject: email.subject,
      body_preview: email.body_preview,
      // NULL, no un resumen inventado. El fallback de antes («Revisar email»,
      // cliente «Desconocido») no era neutro: sacaba el correo del filtro de
      // Clientes y del contador de Prioridad, Y hacía que la pantalla pintara el
      // panel «BRUTAL.IA — ANÁLISIS» encima. Un boletín sin analizar enseñaba un
      // análisis de IA falso. Con NULL, la lista cae al texto del correo y ya.
      ai_summary: analysis?.summary ?? null,
      ai_action: analysis?.action ?? null,
      ai_client: analysis?.client ?? null,
      ai_urgency: analysis?.urgency ?? null,
      ai_estado: estado,
      ai_motivo: analizar ? null : motivo,
      is_read: !email.is_unread,
      is_unread: email.is_unread,
      received_at: email.received_at,
      shared: isCompanyAccount,
      attachments: email.attachments?.length ? email.attachments : [],
    })

    if (insertErr) {
      // Antes era un `continue` pelado: el email se perdía sin rastro. Y el
      // análisis con Claude ya está pagado en la línea de arriba, así que como el
      // gmail_id no llega a guardarse el siguiente sync lo vuelve a analizar.
      // Se cuenta además de loguear porque el log no lo ve nadie: con todos los
      // inserts fallando esta ruta respondía { synced: 0, total: 20 } con 200 y
      // Sincronización anunciaba "0 emails nuevos (20 revisados)" como si fuera
      // un buzón sin novedades.
      console.error('[sync] insert falló para gmail_id', email.gmail_id, '—', insertErr.message)
      insertFailures++
      continue
    }

    // Solo el correo de colaboraciones genera tareas — cuentas personales no
    // Sin análisis no hay tarea, obviamente. Y va con `analysis &&` explícito y
    // no con `?.`: aquí se crea trabajo para una persona, y eso no puede depender
    // de un encadenamiento opcional que un día devuelva undefined y nadie note.
    if (analysis && isCompanyAccount && analysis.suggestedTask && analysis.urgency !== 'normal' && gmailTasksCreated < GMAIL_TASK_LIMIT) {
      const { error: taskErr } = await admin.from('tasks').insert({
        created_by: user.id,
        text: analysis.suggestedTask,
        level: analysis.urgency === 'urgent' ? 'urgent' : 'high',
        source: 'gmail',
      })
      if (!taskErr) gmailTasksCreated++
    }

    // Email con enlace de reunión → tarea con fecha (aparece en el Calendario)
    const meetingText = `${email.subject || ''} ${email.body_preview || ''}`
    if (MEETING_RE.test(meetingText)) {
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
        created_by: user.id,
        assigned_to: isCompanyAccount ? null : user.id,
        text: `Reunión: ${email.subject || email.from_name || 'sin asunto'}`,
        level: 'high',
        due_date: day,
        source: 'gmail',
      })
      if (reunionErr) console.error('[sync] no se pudo crear la tarea de reunión:', reunionErr.message)
    }

    if (email.is_unread) newUnread.push({ from_name: email.from_name || '?', subject: email.subject || '(sin asunto)', urgency: analysis?.urgency ?? 'normal' })
    newCount++
  }

  // Lo que quedó detrás del corte SE GUARDA, marcado como pendiente.
  //
  // Antes el `break` estaba antes del insert, así que esos correos no se
  // guardaban — y como la ventana de Gmail no pagina ni hay backfill, en la
  // siguiente pasada ya no estaban entre los más recientes. Se perdían, en
  // silencio. Quedarse sin tiempo pasa de perder correo a aplazarlo.
  if (truncado) {
    const cola = emails.slice(i).filter(e => !known.has(e.gmail_id)).map(e => ({
      user_id: user.id, source: 'gmail', gmail_id: e.gmail_id,
      from_name: e.from_name, from_email: e.from_email, subject: e.subject,
      body_preview: e.body_preview, is_read: !e.is_unread, is_unread: e.is_unread,
      received_at: e.received_at, shared: isCompanyAccount,
      attachments: e.attachments?.length ? e.attachments : [],
      ai_estado: 'pendiente',
    }))
    if (cola.length) {
      // `gmail_id` es UNIQUE, así que esto es idempotente: si la siguiente pasada
      // los vuelve a traer, el insert rebota y no duplica.
      const { error } = await admin.from('inbox_messages').insert(cola)
      if (error) console.error('[sync] no se pudo aplazar el resto de correos:', error.message)
    }
    console.warn(`[sync] presupuesto agotado: ${cola.length} correos guardados como pendientes de analizar`)
  }
  if (omitidos) console.log(`[sync] ${omitidos} correos guardados sin analizar (promoción o red social)`)

  // Notificación push por los emails nuevos sin leer (con rate-limit de 90s para evitar duplicados)
  if (newUnread.length > 0) {
    const first = newUnread[0]
    const payload: PushPayload = {
      title: newUnread.length === 1 ? `📩 ${first.from_name}` : `📩 ${newUnread.length} emails nuevos`,
      body: newUnread.length === 1 ? first.subject : `${first.from_name}: ${first.subject} y ${newUnread.length - 1} más`,
      url: '/dashboard',
      tag: 'gmail-sync',
      categoria: 'correo',
    }
    const lockKey = isCompanyAccount ? 'company' : user.id
    if (await canSendPush(admin, lockKey)) {
      // CON await. Sin el, el envio quedaba pendiente al devolver la respuesta y en
      // serverless eso es una loteria: la instancia se congela o se recicla en
      // cuanto responde, y a sendPushToAll aun le quedaban una consulta a `reglas`,
      // un insert en notification_log y las llamadas a web-push.
      //
      // El detalle que lo hace grave: canSendPush() YA ha escrito last_sent, o sea
      // que la ventana de 90 segundos se ha consumido igual. Si el envio se corta,
      // ese aviso no se reintenta — se pierde del todo, en silencio.
      //
      // El coste es la latencia del push sumada a la respuesta del sync. Aqui
      // sobra: el bucle de emails ya se acota con PRESUPUESTO_MS muy por debajo
      // del corte de 60s de Hobby.
      try {
        if (isCompanyAccount) await sendPushToAll(admin, payload)
        else await sendPushToUser(admin, user.id, payload)
      } catch (err) {
        console.error('[sync] el push fallo:', err)
      }
    }
  }

  if (aiFailures) console.error(`[sync] analyzeEmail falló en ${aiFailures} de ${emails.length} emails`)
  if (insertFailures) console.error(`[sync] ${insertFailures} de ${emails.length} emails analizados no se pudieron guardar`)
  // `insertFailures` viaja en el JSON para que Sincronización pueda decir la
  // verdad ("revisados 20, guardados 0") en vez de dar por bueno un synced: 0 que
  // es indistinguible de "no había emails nuevos".
  return NextResponse.json({ synced: newCount, total: emails.length, account: gmailAccount, shared: isCompanyAccount, aiFailures, insertFailures })
  } finally {
    if (!cerrojo.degradado) await releaseLock(admin, claveCerrojo, cerrojo.holder)
  }
}
