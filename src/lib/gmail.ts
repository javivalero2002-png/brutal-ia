import { google } from 'googleapis'

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

export async function getEmailsWithRefreshToken(refreshToken: string, maxResults = 15) {
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
        attachments,
      }
    })
  )

  return results.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<any>).value)
}

export async function getCalendarEvents(refreshToken: string, monthsAhead = 2) {
  const oauth2Client = getOAuthClient()
  oauth2Client.setCredentials({ refresh_token: refreshToken })
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

  const now = new Date()
  const timeMin = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const timeMax = new Date(now.getFullYear(), now.getMonth() + monthsAhead, 1).toISOString()

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

  // Fetch events from all calendars in parallel
  const results = await Promise.allSettled(
    calendarIds.map(calId =>
      calendar.events.list({
        calendarId: calId,
        timeMin,
        timeMax,
        maxResults: 100,
        singleEvents: true,
        orderBy: 'startTime',
      })
    )
  )

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
    for (const e of result.value.data.items || []) {
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
