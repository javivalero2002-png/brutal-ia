import { google } from 'googleapis'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!
const REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/gmail/callback`

export function getOAuthClient() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)
}

export function getAuthUrl(userId: string, includeCalendar = true) {
  const oauth2Client = getOAuthClient()
  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ]
  if (includeCalendar) {
    scopes.push('https://www.googleapis.com/auth/calendar.readonly')
  }
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
    state: userId,
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

  const emails = await Promise.all(
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

      return {
        gmail_id: msg.id!,
        from_name: fromName,
        from_email: fromEmail,
        subject,
        body_preview: body.slice(0, 500),
        received_at: new Date(date).toISOString(),
        is_unread: (full.data.labelIds || []).includes('UNREAD'),
      }
    })
  )

  return emails
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
