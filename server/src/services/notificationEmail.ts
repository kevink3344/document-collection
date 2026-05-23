import nodemailer from 'nodemailer'

interface NotificationEmailPayload {
  to: string
  subject: string
  text: string
}

let cachedTransporter: nodemailer.Transporter | null = null

function parseBooleanEnv(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true'
}

function getTransporter(): nodemailer.Transporter {
  if (cachedTransporter) {
    return cachedTransporter
  }

  const host = process.env.SMTP_HOST?.trim()
  const port = parseInt(process.env.SMTP_PORT?.trim() ?? '587', 10)
  const secure = parseBooleanEnv(process.env.SMTP_SECURE)
  const user = process.env.SMTP_USER?.trim()
  const pass = process.env.SMTP_PASS?.trim()

  if (!host || !Number.isFinite(port)) {
    throw new Error('SMTP is not configured')
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  })

  return cachedTransporter
}

export function isEmailDeliveryConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim())
}

export async function sendNotificationEmail(payload: NotificationEmailPayload): Promise<void> {
  const from = process.env.SMTP_FROM?.trim()
  if (!from) {
    throw new Error('SMTP_FROM is not configured')
  }

  const transporter = getTransporter()
  await transporter.sendMail({
    from,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
  })
}