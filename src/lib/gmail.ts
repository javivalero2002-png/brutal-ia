import { google } from 'googleapis'
import { ventanaCalendario } from '@/lib/ventanaCalendario'
import type { calendar_v3 } from 'googleapis'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!
const REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/gmail/callback`

export function getOAuthClient() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)
}

export function getAuthUrl(userId: string, account: 'personal' | 'colabs' = 'personal', nonce: string) {
  const oauth2Client = getOAuthClient()
  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/calendar.readonly',  // list all calendars
    'https://www.googleapis.com/auth/calendar.events',    // create/edit events
  ]
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
    // El nonce es lo que hace este `state` un anti-CSRF real. Antes era solo
    // `${userId}:${account}`, es decir, adivinable: bastaba con que la víctima
    // (ya logueada) abriese un callback preparado con el `code` del atacante para
    // que el refresh token del ATACANTE quedara guardado en su perfil. Con
    // account=colabs eso convierte el buzón del atacante en el buzón compartido
    // de la empresa. El nonce viaja también en una cookie httpOnly y el callback
    // exige que coincidan.
    state: `${userId}:${account}:${nonce}`,
  })
}

export const OAUTH_STATE_COOKIE = 'gmail_oauth_nonce'

export async function getGmailAccountEmail(refreshToken: string): Promise<string> {
  const oauth2Client = getOAuthClient()
  oauth2Client.setCredentials({ refresh_token: refreshToken })
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
  const { data } = await oauth2.userinfo.get()
  return data.email || ''
}

/**
 * Los correos más recientes de la bandeja.
 *
 * OJO CON EL TOPE, que es lo único que separa a Nexus de un buzón: esta llamada
 * NO pagina. Lo que no entre en esta ventana no existe para la app, y no hay
 * ningún proceso que lo vaya a buscar después. En un buzón con veinte mil
 * promociones, una ventana estrecha significa que el correo de un cliente se cae
 * fuera y no entra jamás — que era el problema de verdad, no el coste del modelo.
 *
 * El tope está en 40 y no más alto: cada `messages.get` son 5 unidades de cuota y
 * Gmail permite 250 por usuario y segundo, así que 40 en paralelo son 200 y queda
 * margen. A 50 se roza el 429, y los mensajes rechazados se pierden en esa pasada
 * (se registran arriba, pero se pierden).
 */
export async function getEmailsWithRefreshToken(refreshToken: string, maxResults = 40) {
  const oauth2Client = getOAuthClient()
  oauth2Client.setCredentials({ refresh_token: refreshToken })

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    maxResults,
    q: 'in:inbox',
  })

  const messages = listRes.data.messages || []

  const results = await Promise.allSettled(
    messages.map(async (msg) => {
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'full',
      })

      const headers = full.data.payload?.headers || []
      const getHeader = (name: string) =>
        headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || ''

      const subject = getHeader('Subject')
      const from = getHeader('From')
      const date = getHeader('Date')

      const fromMatch = from.match(/^(.*?)\s*<(.+)>$/)
      const fromName = fromMatch ? fromMatch[1].replace(/"/g, '').trim() : from
      const fromEmail = fromMatch ? fromMatch[2] : from

      const body = extractBody(full.data.payload)
      const attachments = extractAttachments(full.data.payload)

      return {
        gmail_id: msg.id!,
        from_name: fromName,
        from_email: fromEmail,
        subject,
        body_preview: body.slice(0, 500),
        received_at: (date && !isNaN(new Date(date).getTime()) ? new Date(date) : new Date()).toISOString(),
        is_unread: (full.data.labelIds || []).includes('UNREAD'),
        // Las etiquetas ENTERAS, no solo si está sin leer.
        //
        // Ya venían en la respuesta y se tiraban. Dentro está `CATEGORY_PROMOTIONS`
        // y `CATEGORY_SOCIAL`, que es la clasificación que Gmail ya ha hecho —y
        // pagado— por nosotros: la mejor señal disponible para decidir a qué correo
        // merece la pena pagarle un análisis con el modelo, y gratis.
        labelIds: full.data.labelIds || [],
        attachments,
      }
    })
  )

  // Los que fallan se descartaban en SILENCIO. Con la ventana estrecha casi nunca
  // pasaba; al ensancharla, un 429 de Gmail puede hacer desaparecer correos de una
  // pasada sin dejar rastro — y un correo que no llega no se echa de menos.
  const fallidos = results.filter(r => r.status === 'rejected').length
  if (fallidos) {
    console.error(`[gmail] ${fallidos} de ${results.length} mensajes no se pudieron leer y se han perdido en esta pasada`)
  }
  return results.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<any>).value)
}

/**
 * CUÁNDO ESTÁ OCUPADA UNA PERSONA — sin decir en qué.
 *
 * Javi: «cuando en el calendario le das a "todo el equipo" no se ven las reuniones
 * que tiene todo el equipo». Era verdad: el interruptor solo filtraba TAREAS y los
 * eventos eran siempre los de quien mira.
 *
 * Se pregunta con `freeBusy`, que es la primitiva que Google ofrece justo para
 * esto, y NO leyendo el calendario ajeno. La diferencia no es de esfuerzo, es de
 * qué sale: `freeBusy` devuelve intervalos y nada más — ni título, ni asistentes,
 * ni sitio. Leer el calendario entero de un compañero pondría su médico y su
 * entrevista de trabajo en la pantalla de los demás y, peor, en el contexto que se
 * le manda a Harvey, que pega los títulos literales.
 *
 * Elegido por Javi teniendo las tres opciones delante. Para cuadrar una hora
 * —que es la pregunta de verdad— «ocupado» basta.
 *
 * Solo el calendario `primary` de cada uno: los secundarios que alguien tenga
 * suscritos (festivos, el calendario de su pareja) no son su jornada.
 */
export async function getFreeBusy(refreshToken: string, timeMin: string, timeMax: string) {
  const oauth2Client = getOAuthClient()
  oauth2Client.setCredentials({ refresh_token: refreshToken })
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })
  const { data } = await calendar.freebusy.query({
    requestBody: { timeMin, timeMax, items: [{ id: 'primary' }] },
  })
  const cal = data.calendars?.primary
  // Google devuelve `errors` por calendario en vez de fallar la petición. Sin
  // mirarlo, un token caducado sale como «libre todo el día», que es la respuesta
  // más dañina posible: se le convoca una reunión encima de otra.
  if (cal?.errors?.length) {
    throw new Error(cal.errors.map(e => e.reason).join(', ') || 'freeBusy error')
  }
  return (cal?.busy || [])
    .filter(b => b.start && b.end)
    .map(b => ({ start: b.start as string, end: b.end as string }))
}

export async function getCalendarEvents(refreshToken: string, monthsAhead = 2) {
  const oauth2Client = getOAuthClient()
  oauth2Client.setCredentials({ refresh_token: refreshToken })
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

  // La ventana sale de `ventanaCalendario()`, compartida con la seccion: la
  // sección deja navegar a cualquier mes con las flechas y aquí se traían tres,
  // así que julio salía vacío y diciembre salía vacío SIN UN AVISO. Medido: un
  // evento creado para el 30 de diciembre se guardó en Google con 200 y la app no
  // lo enseñaba nunca.
  //
  // `monthsAhead` se conserva en la firma por los llamantes, pero ya no manda: la
  // ventana es una decisión de producto, no de cada sitio que llame.
  const { timeMin, timeMax } = ventanaCalendario()
  void monthsAhead

  // Get all selected calendars — requires calendar.readonly scope.
  // Falls back to ['primary'] if token only has calendar.events (older tokens).
  let calendarIds: string[] = []
  const escribibles: Record<string, boolean> = {}
  try {
    const { data: calList } = await calendar.calendarList.list({ minAccessRole: 'reader' })
    calendarIds = (calList.items || [])
      .filter((c: any) => c.selected !== false)
      .map((c: any) => c.id as string)
    // Quien puede ESCRIBIR en cada uno. Un calendario compartido en modo lectura
    // —el de un cliente, el de festivos— se lista igual que el propio, y sus
    // eventos salían con los mismos botones de EDITAR y ELIMINAR. Google
    // devuelve 403 y el usuario ve "Error eliminando evento" sin saber por qué.
    for (const c of calList.items || []) {
      if (c.id) escribibles[c.id] = c.accessRole === 'owner' || c.accessRole === 'writer'
    }
  } catch {}
  if (!calendarIds.length) calendarIds.push('primary')

  // Se pagina, y no es celo: `maxResults: 100` truncaba en silencio.
  //
  // La ventana es de ~92 dias (el caller pide 3 meses) y con `singleEvents: true`
  // cada serie se EXPANDE en instancias: un daily de dias laborables ya son ~65 el
  // solo. Pasar de 100 en un calendario pide 1,1 eventos/dia, que no es un caso
  // raro — es una agenda normal con reuniones de cliente. Google devolvia entonces
  // la pagina 1 con `nextPageToken`, nadie lo leia (cero apariciones en todo src),
  // y el Promise.allSettled quedaba en `fulfilled`: el resto se tiraba sin un solo
  // error.
  //
  // Lo que se veia: nada. El corte es POR calendario y luego se fusiona, asi que un
  // mes lejano podia salir a medias —los eventos de un calendario hasta el dia 20 y
  // los de otro hasta el 30— y leerse como completo. Un mes medio poblado engana
  // mas que uno vacio.
  //
  // Y el numero era peor que no escribir nada: el default de events.list son 250.
  //
  // Se pagina en vez de subir el tope a 2500 porque Google documenta que una pagina
  // puede venir con MENOS elementos de los pedidos y aun asi traer nextPageToken:
  // un tope mas alto aleja el acantilado, no lo quita. El tope de vueltas es un
  // seguro contra un bucle infinito, no un limite esperado.
  const MAX_PAGINAS = 10
  const listarTodo = async (calId: string) => {
    const items: calendar_v3.Schema$Event[] = []
    let pageToken: string | undefined
    for (let i = 0; i < MAX_PAGINAS; i++) {
      const { data } = await calendar.events.list({
        calendarId: calId,
        timeMin,
        timeMax,
        maxResults: 250,
        singleEvents: true,
        orderBy: 'startTime',
        pageToken,
      })
      items.push(...(data.items || []))
      pageToken = data.nextPageToken || undefined
      if (!pageToken) return items
    }
    // Se avisa en vez de callarse: si esto sale, el horizonte vuelve a estar
    // recortado y hay que subir el tope o acortar la ventana.
    console.warn(`[calendar] ${calId} sigue teniendo paginas tras ${MAX_PAGINAS}: se corta el listado`)
    return items
  }

  const results = await Promise.allSettled(calendarIds.map(listarTodo))

  // De qué calendario sale cada evento. Sin esto, editar o borrar iba SIEMPRE
  // contra 'primary': los eventos de cualquier otro calendario daban 404 al
  // intentar tocarlos, con los botones perfectamente visibles.
  const mapEvent = (e: any, calId: string) => ({
    id: e.id,
    calendarId: calId,
    editable: escribibles[calId] ?? (calId === 'primary'),
    title: e.summary || '(sin título)',
    start: e.start?.dateTime || e.start?.date || '',
    end: e.end?.dateTime || e.end?.date || '',
    allDay: !e.start?.dateTime,
    location: e.location || '',
    description: e.description || '',
    colorId: e.colorId || '',
    htmlLink: e.htmlLink || '',
    hangoutLink: e.hangoutLink || e.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === 'video')?.uri || '',
  })

  // Merge, deduplicate and sort
  const seen = new Set<string>()
  const allEvents: ReturnType<typeof mapEvent>[] = []
  for (const [i, result] of results.entries()) {
    if (result.status !== 'fulfilled') continue
    for (const e of result.value) {
      if (!e.id || seen.has(e.id)) continue
      seen.add(e.id)
      allEvents.push(mapEvent(e, calendarIds[i]))
    }
  }

  return allEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
}

// Calcula el tramo `start`/`end` que espera la API de Google.
//
// Existe como función porque este cálculo estaba escrito DOS veces —una al crear
// y otra al editar— y solo se arregló una. El resultado fue que crear un evento a
// las 10:00 funcionaba y editarle el título lo movía a las 12:00, sumando otras
// dos horas en cada edición. Un cálculo escrito dos veces se arregla una vez.
//
// Las dos trampas, que son distintas y se dan a la vez:
//
// 1. `toISOString()` añade la 'Z'. Google respeta el offset explícito e IGNORA el
//    campo `timeZone`, así que las 10:00 se guardan como 10:00 UTC = 12:00 en
//    Madrid. Por eso el dateTime va SIN zona y la zona va aparte.
// 2. `new Date('2026-08-20T10:00:00')` se interpreta en la zona del SERVIDOR, que
//    en Vercel es UTC. Por eso las horas se manejan como minutos desde medianoche
//    y nunca se construye un Date con la hora local dentro.
export function tramoHorario(date: string, time: string, durationMinutes: number) {
  const [h, m] = time.split(':').map(Number)
  const pad = (n: number) => String(n).padStart(2, '0')
  const inicioMin = h * 60 + m
  const finMin = inicioMin + durationMinutes
  // El fin puede caer al día siguiente (p. ej. 23:30 + 60 min).
  const salto = Math.floor(finMin / 1440)
  const diaFin = new Date(`${date}T00:00:00Z`)
  diaFin.setUTCDate(diaFin.getUTCDate() + salto)
  return {
    start: { dateTime: `${date}T${pad(h)}:${pad(m)}:00`, timeZone: 'Europe/Madrid' },
    end: {
      dateTime: `${diaFin.toISOString().slice(0, 10)}T${pad(Math.floor((finMin % 1440) / 60))}:${pad(finMin % 60)}:00`,
      timeZone: 'Europe/Madrid',
    },
  }
}

/** Tramo de día completo. La 'Z' es obligatoria por el mismo motivo que arriba. */
export function tramoDiaCompleto(date: string) {
  const siguiente = new Date(`${date}T00:00:00Z`)
  siguiente.setUTCDate(siguiente.getUTCDate() + 1)
  return { start: { date }, end: { date: siguiente.toISOString().slice(0, 10) } }
}

export async function createCalendarEvent(refreshToken: string, opts: {
  title: string
  date: string        // YYYY-MM-DD
  time?: string       // HH:MM, optional
  durationMinutes?: number
  description?: string
  attendees?: string[] // emails — reciben invitación y el evento aparece en su Calendar
}) {
  const oauth2Client = getOAuthClient()
  oauth2Client.setCredentials({ refresh_token: refreshToken })
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

  const tramo = opts.time
    ? tramoHorario(opts.date, opts.time, opts.durationMinutes ?? 60)
    : tramoDiaCompleto(opts.date)
  const { start, end } = tramo

  const { data } = await calendar.events.insert({
    calendarId: 'primary',
    sendUpdates: opts.attendees?.length ? 'all' : 'none',
    requestBody: {
      summary: opts.title,
      description: opts.description ?? 'Creado por Harvey · Brutal Studios',
      start,
      end,
      ...(opts.attendees?.length ? { attendees: opts.attendees.map(email => ({ email })) } : {}),
    },
  })

  return {
    id: data.id ?? '',
    htmlLink: data.htmlLink ?? '',
    title: data.summary ?? opts.title,
    start: data.start?.dateTime ?? data.start?.date ?? opts.date,
  }
}

export async function deleteCalendarEvent(refreshToken: string, eventId: string, calendarId = 'primary') {
  const oauth2Client = getOAuthClient()
  oauth2Client.setCredentials({ refresh_token: refreshToken })
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })
  await calendar.events.delete({ calendarId, eventId })
}

export async function updateCalendarEvent(refreshToken: string, eventId: string, opts: {
  title?: string
  date?: string
  time?: string
  calendarId?: string
}) {
  const calendarId = opts.calendarId || 'primary'
  const oauth2Client = getOAuthClient()
  oauth2Client.setCredentials({ refresh_token: refreshToken })
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

  const { data: existing } = await calendar.events.get({ calendarId, eventId })
  const patchBody: any = {}
  if (opts.title) patchBody.summary = opts.title
  if (opts.date) {
    if (opts.time) {
      // La duración se conserva de lo que ya había. Es una RESTA de dos instantes,
      // así que no le afecta la zona horaria: los dos extremos se interpretan con
      // el mismo offset y este se cancela. Lo que sí importaba era no reconstruir
      // el inicio a partir de un Date, y de eso se encarga tramoHorario().
      const duracionMin = existing.end?.dateTime && existing.start?.dateTime
        ? Math.round((new Date(existing.end.dateTime).getTime() - new Date(existing.start.dateTime).getTime()) / 60000)
        : 60
      const tramo = tramoHorario(opts.date, opts.time, duracionMin)
      patchBody.start = tramo.start
      patchBody.end = tramo.end
    } else {
      const tramo = tramoDiaCompleto(opts.date)
      patchBody.start = tramo.start
      patchBody.end = tramo.end
    }
  }
  const { data } = await calendar.events.patch({ calendarId, eventId, requestBody: patchBody })
  return {
    id: data.id ?? eventId,
    title: data.summary ?? opts.title ?? '',
    start: data.start?.dateTime ?? data.start?.date ?? opts.date ?? '',
  }
}

function extractAttachments(payload: any): {attachmentId: string; filename: string; mimeType: string; size: number}[] {
  const results: {attachmentId: string; filename: string; mimeType: string; size: number}[] = []
  if (!payload) return results

  const scan = (parts: any[]) => {
    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        results.push({
          attachmentId: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0,
        })
      }
      if (part.parts) scan(part.parts)
    }
  }

  if (payload.parts) scan(payload.parts)
  return results
}

function extractBody(payload: any): string {
  if (!payload) return ''

  // Direct body data (simple messages)
  if (payload.body?.data) {
    const raw = Buffer.from(payload.body.data, 'base64').toString('utf-8')
    const isHtml = (payload.mimeType || '').includes('html')
    return isHtml ? raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : raw.replace(/\s+/g, ' ').trim()
  }

  if (!payload.parts) return ''

  // First pass: prefer text/plain at any depth
  const plain = findPart(payload.parts, 'text/plain')
  if (plain) return Buffer.from(plain, 'base64').toString('utf-8').replace(/\s+/g, ' ').trim()

  // Second pass: fall back to text/html at any depth
  const html = findPart(payload.parts, 'text/html')
  if (html) return Buffer.from(html, 'base64').toString('utf-8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

  return ''
}

function findPart(parts: any[], mimeType: string): string | null {
  for (const part of parts) {
    if (part.mimeType === mimeType && part.body?.data) return part.body.data
    // Recurse into multipart/* containers
    if (part.mimeType?.startsWith('multipart/') && part.parts) {
      const found = findPart(part.parts, mimeType)
      if (found) return found
    }
  }
  return null
}

/**
 * Los IDENTIFICADORES de los mensajes de un buzón, sin descargar los mensajes.
 *
 * Existe para una cosa muy concreta: hasta el 2026-08-24 `inbox_messages` no
 * guardaba de qué cuenta venía cada correo, así que los 754 anteriores de quien
 * tiene DOS cuentas personales se quedaron sin atribuir — y adivinarlo habría
 * sido peor que dejar el hueco.
 *
 * Un `gmail_id` es de SU buzón: si la cuenta A lo devuelve en su lista, el correo
 * entró por A. Eso es exacto, no una heurística.
 *
 * `messages.list` sin `format` devuelve solo ids: 500 por llamada y sin coste de
 * cuota apreciable. Se recorre de lo más nuevo a lo más viejo y se PARA en cuanto
 * ya no queda nada por resolver — de ahí `pendientes`, que evita pasear un buzón
 * de 40.000 correos para atribuir 754.
 */
export async function listarIdsDeMensajes(
  refreshToken: string,
  pendientes: Set<string>,
  maxPaginas = 20,
): Promise<Set<string>> {
  const oauth2Client = getOAuthClient()
  oauth2Client.setCredentials({ refresh_token: refreshToken })
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

  const encontrados = new Set<string>()
  let pageToken: string | undefined
  for (let i = 0; i < maxPaginas; i++) {
    const res = await gmail.users.messages.list({ userId: 'me', maxResults: 500, pageToken })
    for (const m of res.data.messages || []) {
      if (m.id && pendientes.has(m.id)) encontrados.add(m.id)
    }
    // Ya está todo resuelto, o no hay más páginas.
    if (encontrados.size >= pendientes.size) break
    pageToken = res.data.nextPageToken || undefined
    if (!pageToken) break
  }
  return encontrados
}
