import { authHeaders, handleUnauthorizedResponse } from './authEvents'
import type {
  Webhook,
  WebhookDelivery,
  WebhookInput,
  WebhookKey,
  WebhookTestResult,
} from '../types'

const BASE = '/api/webhooks'

async function getErrorMessage(res: Response, fallback: string): Promise<string> {
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const data = await res.json().catch(() => ({})) as { error?: string; message?: string }
    if (typeof data.error === 'string' && data.error.trim()) return data.error
    if (typeof data.message === 'string' && data.message.trim()) return data.message
  } else {
    const text = await res.text().catch(() => '')
    if (text.trim()) return text.trim()
  }
  return `${fallback} (HTTP ${res.status})`
}

export async function listWebhooks(): Promise<Webhook[]> {
  const res = await fetch(BASE, { headers: authHeaders() })
  handleUnauthorizedResponse(res)
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to load webhooks'))
  return res.json() as Promise<Webhook[]>
}

export async function saveWebhook(key: WebhookKey, data: WebhookInput): Promise<Webhook> {
  const res = await fetch(`${BASE}/${key}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data),
  })
  handleUnauthorizedResponse(res)
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to save webhook'))
  return res.json() as Promise<Webhook>
}

export async function deleteWebhook(key: WebhookKey): Promise<void> {
  const res = await fetch(`${BASE}/${key}`, { method: 'DELETE', headers: authHeaders() })
  handleUnauthorizedResponse(res)
  if (!res.ok && res.status !== 204) {
    throw new Error(await getErrorMessage(res, 'Failed to delete webhook'))
  }
}

export async function testWebhook(key: WebhookKey): Promise<WebhookTestResult> {
  const res = await fetch(`${BASE}/${key}/test`, { method: 'POST', headers: authHeaders() })
  handleUnauthorizedResponse(res)
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to test webhook'))
  return res.json() as Promise<WebhookTestResult>
}

export async function listWebhookDeliveries(key: WebhookKey): Promise<WebhookDelivery[]> {
  const res = await fetch(`${BASE}/${key}/deliveries`, { headers: authHeaders() })
  handleUnauthorizedResponse(res)
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to load deliveries'))
  return res.json() as Promise<WebhookDelivery[]>
}
