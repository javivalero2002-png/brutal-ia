const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID
const TOKEN = process.env.WHATSAPP_TOKEN

export async function sendWhatsAppMessage(to: string, message: string) {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      }),
    }
  )
  return res.json()
}

export async function sendWhatsAppTemplate(to: string, templateName: string, params: string[]) {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'es' },
          components: params.length ? [{
            type: 'body',
            parameters: params.map(p => ({ type: 'text', text: p })),
          }] : [],
        },
      }),
    }
  )
  return res.json()
}

export async function downloadWhatsAppMedia(mediaId: string): Promise<string> {
  const urlRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  const { url } = await urlRes.json()

  const mediaRes = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  const buffer = await mediaRes.arrayBuffer()
  return Buffer.from(buffer).toString('base64')
}

export function parseWebhookMessage(body: any) {
  try {
    const entry = body.entry?.[0]
    const change = entry?.changes?.[0]
    const value = change?.value
    const message = value?.messages?.[0]
    if (!message) return null

    const from = message.from
    const type = message.type

    let text = ''
    let mediaId: string | undefined

    if (type === 'text') {
      text = message.text?.body || ''
    } else if (type === 'image') {
      mediaId = message.image?.id
      text = message.image?.caption || '[Imagen enviada]'
    } else if (type === 'document') {
      mediaId = message.document?.id
      text = message.document?.caption || '[Documento enviado]'
    } else if (type === 'audio') {
      text = '[Nota de voz]'
    }

    const contact = value?.contacts?.[0]
    const fromName = contact?.profile?.name || from

    return { from, fromName, text, type, mediaId }
  } catch {
    return null
  }
}
