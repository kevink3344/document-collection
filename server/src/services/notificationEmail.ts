const SMTP2GO_API_URL = 'https://api.smtp2go.com/v3/email/send'

interface NotificationEmailPayload {
  to: string
  subject: string
  text: string
}

export function isEmailDeliveryConfigured(): boolean {
  return Boolean(process.env.SMTP2GO_API_KEY?.trim() && process.env.SMTP2GO_SENDER?.trim())
}

export async function sendNotificationEmail(payload: NotificationEmailPayload): Promise<void> {
  const apiKey = process.env.SMTP2GO_API_KEY?.trim()
  const sender = process.env.SMTP2GO_SENDER?.trim()
  if (!apiKey || !sender) {
    throw new Error('SMTP2GO is not configured')
  }

  const res = await fetch(SMTP2GO_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Smtp2go-Api-Key': apiKey,
    },
    body: JSON.stringify({
      sender,
      to: [payload.to],
      subject: payload.subject,
      text_body: payload.text,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`SMTP2Go API error ${res.status}: ${body}`)
  }
}