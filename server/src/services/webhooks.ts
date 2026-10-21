import { getDbAsync } from '../database/db'

export type WebhookKey = 'webhook-1' | 'webhook-2'
export type WebhookResponseShape = 'json_boolean' | 'json_string' | 'plain_text'

export interface DbWebhook {
  id: number
  organization_id: number
  key: WebhookKey
  name: string | null
  url: string
  secret: string | null
  enabled: number | boolean
  timeout_ms: number
  response_shape: WebhookResponseShape
  response_key: string
  created_by: number | null
  created_at: string
  updated_at: string
}

export interface ValidationResult {
  valid: boolean
  reason: 'ok' | 'invalid' | 'error'
  httpStatus: number | null
  durationMs: number
  rawBody: string
  error: string | null
}

const TRUTHY = new Set(['true', '1', 'yes', 'y', 'valid'])
const FALSY = new Set(['false', '0', 'no', 'n', 'invalid'])
const MAX_STORED_BODY = 1000
const MAX_DELIVERIES_PER_WEBHOOK = 200

/**
 * A "Student ID" field is a short-text field distinguished by display_style.
 * Storing it this way avoids adding a value to the collection_fields.type CHECK
 * constraint, which would require a full table rebuild.
 */
export function isStudentIdField(field: {
  type: string
  display_style?: string | null
  displayStyle?: string | null
}): boolean {
  const style = field.display_style ?? field.displayStyle ?? null
  return field.type === 'short_text' && style === 'student_id'
}

function truncate(value: string, max = MAX_STORED_BODY): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/**
 * Interpret a webhook-1 response body using the shape/key configured on the webhook.
 * Returns null when the body cannot be interpreted as a boolean.
 */
export function parseValidationResponse(
  hook: { response_shape?: string | null; response_key?: string | null },
  bodyText: string,
): boolean | null {
  const shape = hook.response_shape ?? 'json_boolean'
  const key = hook.response_key?.trim() || 'valid'

  let raw: unknown = bodyText

  if (shape !== 'plain_text') {
    let parsed: unknown
    try {
      parsed = JSON.parse(bodyText)
    } catch {
      return null
    }

    // A bare `true` / `false` / `"true"` body is still accepted for JSON shapes.
    if (parsed === null || typeof parsed !== 'object') {
      raw = parsed
    } else {
      raw = (parsed as Record<string, unknown>)[key]
    }
  }

  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') {
    if (raw === 1) return true
    if (raw === 0) return false
    return null
  }
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase()
    if (TRUTHY.has(normalized)) return true
    if (FALSY.has(normalized)) return false
  }

  return null
}

export async function getWebhookForOrg(organizationId: number, key: WebhookKey): Promise<DbWebhook | null> {
  const db = await getDbAsync()
  const row = await db.queryOne<DbWebhook>(
    'SELECT * FROM webhooks WHERE organization_id = ? AND key = ?',
    [organizationId, key],
  )
  return row ?? null
}

export async function getWebhookForField(fieldId: number): Promise<DbWebhook | null> {
  const db = await getDbAsync()
  const row = await db.queryOne<DbWebhook>(
    `SELECT w.*
       FROM webhook_field_bindings b
       JOIN webhooks w ON w.id = b.webhook_id
      WHERE b.field_id = ? AND w.key = 'webhook-1'`,
    [fieldId],
  )
  return row ?? null
}

/** Map of fieldId -> webhookId for the given fields (webhook-1 bindings only). */
export async function getBindingsForFields(fieldIds: number[]): Promise<Map<number, number>> {
  const result = new Map<number, number>()
  if (fieldIds.length === 0) return result

  const db = await getDbAsync()
  const placeholders = fieldIds.map(() => '?').join(',')
  const rows = await db.queryAll<{ field_id: number; webhook_id: number }>(
    `SELECT b.field_id, b.webhook_id
       FROM webhook_field_bindings b
       JOIN webhooks w ON w.id = b.webhook_id
      WHERE b.field_id IN (${placeholders}) AND w.key = 'webhook-1'`,
    fieldIds,
  )
  for (const row of rows) result.set(row.field_id, row.webhook_id)
  return result
}

export async function logDelivery(params: {
  webhookId: number
  responseId?: number | null
  direction: 'validate' | 'submit'
  status: 'success' | 'failed'
  httpStatus?: number | null
  durationMs?: number | null
  error?: string | null
  responseBody?: string | null
}): Promise<void> {
  try {
    const db = await getDbAsync()
    await db.execute(
      `INSERT INTO webhook_deliveries
         (webhook_id, response_id, direction, status, http_status, duration_ms, error, response_body)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.webhookId,
        params.responseId ?? null,
        params.direction,
        params.status,
        params.httpStatus ?? null,
        params.durationMs ?? null,
        params.error ? truncate(params.error) : null,
        params.responseBody ? truncate(params.responseBody) : null,
      ],
    )
    await pruneDeliveries(params.webhookId)
  } catch (err) {
    console.error('[webhooks] failed to log delivery:', (err as Error).message)
  }
}

async function pruneDeliveries(webhookId: number): Promise<void> {
  const db = await getDbAsync()
  await db.execute(
    `DELETE FROM webhook_deliveries
      WHERE webhook_id = ?
        AND id NOT IN (
          SELECT id FROM webhook_deliveries
           WHERE webhook_id = ?
           ORDER BY id DESC
           LIMIT ${MAX_DELIVERIES_PER_WEBHOOK}
        )`,
    [webhookId, webhookId],
  )
}

function buildHeaders(secret: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
  }
  // Only send the secret header when one is configured. Power Automate and other
  // unsigned endpoints should receive no auth header at all (an empty header can
  // trip request validators).
  if (secret && secret.trim()) {
    headers['X-Webhook-Secret'] = secret
  }
  return headers
}

async function postJson(
  url: string,
  secret: string | null,
  timeoutMs: number,
  payload: unknown,
): Promise<{ ok: boolean; status: number | null; body: string; durationMs: number; error: string | null }> {
  const startedAt = Date.now()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(secret),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = await res.text().catch(() => '')
    return {
      ok: res.ok,
      status: res.status,
      body,
      durationMs: Date.now() - startedAt,
      error: res.ok ? null : `HTTP ${res.status}`,
    }
  } catch (err) {
    const e = err as Error & { name?: string }
    const message = e.name === 'TimeoutError' || e.name === 'AbortError'
      ? `Timed out after ${timeoutMs}ms`
      : e.message || 'Request failed'
    return {
      ok: false,
      status: null,
      body: '',
      durationMs: Date.now() - startedAt,
      error: message,
    }
  }
}

/**
 * Call a webhook-1 endpoint and interpret the result. Never throws.
 */
export async function callValidationWebhook(
  hook: DbWebhook,
  payload: Record<string, unknown>,
): Promise<ValidationResult> {
  const result = await postJson(hook.url, hook.secret, hook.timeout_ms || 5000, payload)

  if (!result.ok) {
    return {
      valid: false,
      reason: 'error',
      httpStatus: result.status,
      durationMs: result.durationMs,
      rawBody: result.body,
      error: result.error,
    }
  }

  const parsed = parseValidationResponse(hook, result.body)
  return {
    valid: parsed === true,
    reason: parsed === null ? 'invalid' : parsed ? 'ok' : 'invalid',
    httpStatus: result.status,
    durationMs: result.durationMs,
    rawBody: result.body,
    error: parsed === null ? 'Response could not be interpreted as a boolean' : null,
  }
}

export interface SubmissionWebhookPayload {
  event: 'submission.created'
  responseId: number
  collectionId: number
  collectionSlug: string
  collectionTitle: string
  collectionVersionId: number | null
  organizationId: number | null
  submittedAt: string
  respondent: { name: string | null; email: string | null }
  values: Array<{ fieldKey: string; label: string; type: string; value: string | null }>
}

/**
 * Fire-and-forget submission forwarding. Failures are logged, never thrown.
 */
export async function sendSubmissionWebhook(
  hook: DbWebhook,
  payload: SubmissionWebhookPayload,
  responseId: number,
): Promise<void> {
  const result = await postJson(hook.url, hook.secret, hook.timeout_ms || 5000, payload)
  await logDelivery({
    webhookId: hook.id,
    responseId,
    direction: 'submit',
    status: result.ok ? 'success' : 'failed',
    httpStatus: result.status,
    durationMs: result.durationMs,
    error: result.error,
    responseBody: result.body,
  })
}
