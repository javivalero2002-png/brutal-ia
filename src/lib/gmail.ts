import { google } from 'googleapis'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!
const REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/gmail/callback`

export function getOAuthClient() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)
}

export function getAuthUrl(userId: string, account: 'personal' | 'colabs' = 'personal') {
  const oauth2Client = getOAuthClient()
  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ]
  if (account === 'personal') {
    scopes.push('https://www.googleapis.com/auth/calendar.events')
  }
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
    state: `${userId}:${account}`,
  })
}

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
  const timeMax = new Date(now.getFullYear(), now.getMonth() + monthsAhead, 1)

  const { data } = await calendar.events.list({
    calendarId: 'primary',
    timeMin: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    timeMax: timeMax.toISOString(),
    maxResults: 100,
    singleEvents: true,
    orderBy: 'startTime',
  })

  return (data.items || []).map((e: any) => ({
    id: e.id,
    title: e.summary || '(sin título)',
    start: e.start?.dateTime || e.start?.date || '',
    end: e.end?.dateTime || e.end?.date || '',
    allDay: !e.start?.dateTime,
    location: e.location || '',
    description: e.description || '',
    colorId: e.colorId || '',
    htmlLink: e.htmlLink || '',
  }))
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

  let start: any, end: any
  if (opts.time) {
    const startDT = new Date(`${opts.date}T${opts.time}:00`)
    const endDT = new Date(startDT.getTime() + (opts.durationMinutes ?? 60) * 60000)
    start = { dateTime: startDT.toISOString(), timeZone: 'Europe/Madrid' }
    end   = { dateTime: endDT.toISOString(),   timeZone: 'Europe/Madrid' }
  } else {
    const nextDay = new Date(opts.date + 'T00:00:00')
    nextDay.setDate(nextDay.getDate() + 1)
    const nextDayStr = nextDay.toISOString().slice(0, 10)
    start = { date: opts.date }
    end   = { date: nextDayStr }
  }

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

  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8').replace(/\s+/g, ' ').trim()
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      }
    }
  }

  return ''
}
