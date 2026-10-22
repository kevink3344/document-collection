import { Router, type Request, type Response } from 'express'
import { getDbAsync } from '../database/db'
import { authenticateToken } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { loadRequestUserContext, isAdminOrSuperAdmin, isAdministrator } from '../middleware/organizationAccess'
import { upsertWebhookSchema, bindWebhookFieldSchema, webhookKeySchema } from '../lib/schemas'
import {
  callValidationWebhook,
  extractResponseValue,
  logDelivery,
  type DbWebhook,
  type WebhookKey,
} from '../services/webhooks'

const router = Router()

interface WebhookRow extends DbWebhook {}

const MISSING_TABLE_MESSAGE =
  'The webhooks tables do not exist in this database. An administrator must run ' +
  'server/scripts/webhooks-sqlserver.sql against it (the app login may lack CREATE TABLE permission).'

function isMissingTableError(err: unknown): boolean {
  const message = (err as Error)?.message ?? ''
  return /Invalid object name|no such table/i.test(message)
}

/**
 * Wraps a handler so a missing webhooks table returns a clear, actionable 503
 * instead of a raw SQL error surfaced as a generic 500.
 */
function withWebhookTableGuard(
  handler: (req: Request, res: Response) => Promise<void>,
) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      await handler(req, res)
    } catch (err) {
      if (isMissingTableError(err)) {
        console.warn('[webhooks] tables missing — apply server/scripts/webhooks-sqlserver.sql')
        res.status(503).json({ error: MISSING_TABLE_MESSAGE, code: 'WEBHOOKS_TABLES_MISSING' })
        return
      }
      throw err
    }
  }
}

function toApiWebhook(row: WebhookRow, boundFieldIds: number[] = []) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    key: row.key,
    name: row.name,
    url: row.url,
    hasSecret: Boolean(row.secret && row.secret.trim()),
    enabled: Boolean(row.enabled),
    timeoutMs: row.timeout_ms,
    responseShape: row.response_shape ?? 'json_boolean',
    responseKey: row.response_key ?? 'valid',
    responseExample: row.response_example ?? null,
    boundFieldIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Resolve which organization the caller is managing.
 * Administrators are pinned to their own org; super admins may target any org.
 */
async function resolveTargetOrgId(req: Request): Promise<number | null> {
  const context = await loadRequestUserContext(req)
  if (!context) return null

  if (isAdministrator(context)) {
    const requested = Number(req.query.organizationId ?? req.body?.organizationId)
    if (Number.isInteger(requested) && requested > 0) return requested
    return context.organizationId
  }

  return context.organizationId
}

async function requireAdmin(req: Request, res: Response): Promise<boolean> {
  const context = await loadRequestUserContext(req)
  if (!context || !isAdminOrSuperAdmin(context)) {
    res.status(403).json({ error: 'Administrator access required' })
    return false
  }
  return true
}

function parseKey(req: Request, res: Response): WebhookKey | null {
  const parsed = webhookKeySchema.safeParse(req.params.key)
  if (!parsed.success) {
    res.status(400).json({ error: "key must be 'webhook-1' or 'webhook-2'" })
    return null
  }
  return parsed.data
}

async function loadBoundFieldIds(webhookId: number): Promise<number[]> {
  const db = await getDbAsync()
  const rows = await db.queryAll<{ field_id: number }>(
    'SELECT field_id FROM webhook_field_bindings WHERE webhook_id = ?',
    [webhookId],
  )
  return rows.map(r => r.field_id)
}

// ── GET /api/webhooks — list webhooks for the managed organization ──────────
router.get('/', authenticateToken, withWebhookTableGuard(async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return

  const organizationId = await resolveTargetOrgId(req)
  if (!organizationId) {
    res.status(400).json({ error: 'No organization context available' })
    return
  }

  const db = await getDbAsync()
  const rows = await db.queryAll<WebhookRow>(
    'SELECT * FROM webhooks WHERE organization_id = ? ORDER BY key',
    [organizationId],
  )

  const result = []
  for (const row of rows) {
    result.push(toApiWebhook(row, await loadBoundFieldIds(row.id)))
  }
  res.json(result)
}))

// ── PUT /api/webhooks/:key — create or update ──────────────────────────────
router.put('/:key', authenticateToken, validate(upsertWebhookSchema), withWebhookTableGuard(async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return

  const key = parseKey(req, res)
  if (!key) return

  const organizationId = await resolveTargetOrgId(req)
  if (!organizationId) {
    res.status(400).json({ error: 'No organization context available' })
    return
  }

  const body = req.body as {
    name?: string | null
    url: string
    secret?: string
    enabled?: boolean
    timeoutMs?: number
    responseShape?: 'json_boolean' | 'json_string' | 'plain_text'
    responseKey?: string
    responseExample?: string | null
  }

  const db = await getDbAsync()
  const org = await db.queryOne<{ id: number }>('SELECT id FROM organizations WHERE id = ?', [organizationId])
  if (!org) {
    res.status(404).json({ error: 'Organization not found' })
    return
  }

  const existing = await db.queryOne<WebhookRow>(
    'SELECT * FROM webhooks WHERE organization_id = ? AND key = ?',
    [organizationId, key],
  )

  // secret: undefined = leave unchanged, "" = clear, value = replace
  const nextSecret = body.secret === undefined
    ? existing?.secret ?? null
    : body.secret.trim() === ''
      ? null
      : body.secret

  const nextName = body.name === undefined ? existing?.name ?? null : (body.name?.trim() || null)
  const nextEnabled = body.enabled === undefined ? (existing ? Number(existing.enabled) : 1) : (body.enabled ? 1 : 0)
  const nextTimeout = body.timeoutMs ?? existing?.timeout_ms ?? 5000
  const nextShape = body.responseShape ?? existing?.response_shape ?? 'json_boolean'
  const nextKey = body.responseKey?.trim() || existing?.response_key || 'valid'
  const nextExample = body.responseExample === undefined
    ? existing?.response_example ?? null
    : (body.responseExample?.trim() || null)

  if (existing) {
    await db.execute(
      `UPDATE webhooks
          SET name = ?, url = ?, secret = ?, enabled = ?, timeout_ms = ?,
              response_shape = ?, response_key = ?, response_example = ?, updated_at = datetime('now')
        WHERE id = ?`,
      [nextName, body.url.trim(), nextSecret, nextEnabled, nextTimeout, nextShape, nextKey, nextExample, existing.id],
    )
  } else {
    await db.execute(
      `INSERT INTO webhooks
         (organization_id, key, name, url, secret, enabled, timeout_ms, response_shape, response_key, response_example, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [organizationId, key, nextName, body.url.trim(), nextSecret, nextEnabled, nextTimeout, nextShape, nextKey, nextExample, req.user?.sub ?? null],
    )
  }

  const saved = await db.queryOne<WebhookRow>(
    'SELECT * FROM webhooks WHERE organization_id = ? AND key = ?',
    [organizationId, key],
  )

  if (!saved) {
    res.status(500).json({ error: 'Failed to save webhook' })
    return
  }

  res.json(toApiWebhook(saved, await loadBoundFieldIds(saved.id)))
}))

// ── DELETE /api/webhooks/:key ──────────────────────────────────────────────
router.delete('/:key', authenticateToken, withWebhookTableGuard(async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return

  const key = parseKey(req, res)
  if (!key) return

  const organizationId = await resolveTargetOrgId(req)
  if (!organizationId) {
    res.status(400).json({ error: 'No organization context available' })
    return
  }

  const db = await getDbAsync()
  // Bindings and deliveries cascade via foreign keys.
  await db.execute('DELETE FROM webhooks WHERE organization_id = ? AND key = ?', [organizationId, key])
  res.status(204).send()
}))

// ── POST /api/webhooks/:key/test — send a sample payload ───────────────────
router.post('/:key/test', authenticateToken, withWebhookTableGuard(async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return

  const key = parseKey(req, res)
  if (!key) return

  const organizationId = await resolveTargetOrgId(req)
  if (!organizationId) {
    res.status(400).json({ error: 'No organization context available' })
    return
  }

  const db = await getDbAsync()
  const hook = await db.queryOne<WebhookRow>(
    'SELECT * FROM webhooks WHERE organization_id = ? AND key = ?',
    [organizationId, key],
  )

  if (!hook) {
    res.status(404).json({ error: 'Webhook is not configured for this organization' })
    return
  }

  if (key === 'webhook-1') {
    const result = await callValidationWebhook(hook, {
      value: 'TEST-000',
      fieldKey: 'test-field',
      fieldLabel: 'Test Field',
      collectionSlug: 'webhook-test',
      organizationId,
    })
    await logDelivery({
      webhookId: hook.id,
      direction: 'validate',
      status: result.reason === 'error' ? 'failed' : 'success',
      httpStatus: result.httpStatus,
      durationMs: result.durationMs,
      error: result.error,
      responseBody: result.rawBody,
    })
    res.json({
      ok: result.reason !== 'error',
      httpStatus: result.httpStatus,
      durationMs: result.durationMs,
      parsed: result.reason === 'error' ? null : result.valid,
      rawBody: result.rawBody.slice(0, 1000),
      error: result.error,
    })
    return
  }

  const startedAt = Date.now()
  try {
    const res2 = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(hook.secret && hook.secret.trim() ? { 'X-Webhook-Secret': hook.secret } : {}),
      },
      body: JSON.stringify({ event: 'webhook.test', message: 'This is a test payload from Data Collection Pro.' }),
      signal: AbortSignal.timeout(hook.timeout_ms || 5000),
    })
    const body = await res2.text().catch(() => '')
    await logDelivery({
      webhookId: hook.id,
      direction: 'submit',
      status: res2.ok ? 'success' : 'failed',
      httpStatus: res2.status,
      durationMs: Date.now() - startedAt,
      error: res2.ok ? null : `HTTP ${res2.status}`,
      responseBody: body,
    })
    res.json({
      ok: res2.ok,
      httpStatus: res2.status,
      durationMs: Date.now() - startedAt,
      extracted: res2.ok ? extractResponseValue(hook, body) : null,
      rawBody: body.slice(0, 1000),
      error: res2.ok ? null : `HTTP ${res2.status}`,
    })
  } catch (err) {
    const e = err as Error & { name?: string }
    const message = e.name === 'TimeoutError' || e.name === 'AbortError'
      ? `Timed out after ${hook.timeout_ms}ms`
      : e.message || 'Request failed'
    await logDelivery({
      webhookId: hook.id,
      direction: 'submit',
      status: 'failed',
      httpStatus: null,
      durationMs: Date.now() - startedAt,
      error: message,
    })
    res.json({ ok: false, httpStatus: null, durationMs: Date.now() - startedAt, rawBody: '', error: message })
  }
}))

// ── GET /api/webhooks/:key/deliveries — recent delivery log ────────────────
router.get('/:key/deliveries', authenticateToken, withWebhookTableGuard(async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return

  const key = parseKey(req, res)
  if (!key) return

  const organizationId = await resolveTargetOrgId(req)
  if (!organizationId) {
    res.status(400).json({ error: 'No organization context available' })
    return
  }

  const db = await getDbAsync()
  const hook = await db.queryOne<WebhookRow>(
    'SELECT * FROM webhooks WHERE organization_id = ? AND key = ?',
    [organizationId, key],
  )

  if (!hook) {
    res.json([])
    return
  }

  const rows = await db.queryAll<{
    id: number
    direction: 'validate' | 'submit'
    status: 'success' | 'failed'
    http_status: number | null
    duration_ms: number | null
    error: string | null
    response_body: string | null
    created_at: string
  }>(
    `SELECT id, direction, status, http_status, duration_ms, error, response_body, created_at
       FROM webhook_deliveries
      WHERE webhook_id = ?
      ORDER BY id DESC
      LIMIT 20`,
    [hook.id],
  )

  res.json(rows.map(row => ({
    id: row.id,
    direction: row.direction,
    status: row.status,
    httpStatus: row.http_status,
    durationMs: row.duration_ms,
    error: row.error,
    responseBody: row.response_body,
    createdAt: row.created_at,
  })))
}))

// ── PUT /api/webhooks/:key/bindings — bind/unbind a field ──────────────────
router.put('/:key/bindings', authenticateToken, validate(bindWebhookFieldSchema), withWebhookTableGuard(async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return

  const key = parseKey(req, res)
  if (!key) return

  if (key !== 'webhook-1') {
    res.status(400).json({ error: 'Only webhook-1 can be bound to fields' })
    return
  }

  const organizationId = await resolveTargetOrgId(req)
  if (!organizationId) {
    res.status(400).json({ error: 'No organization context available' })
    return
  }

  const { fieldId, bound } = req.body as { fieldId: number; bound: boolean }

  const db = await getDbAsync()
  const hook = await db.queryOne<WebhookRow>(
    'SELECT * FROM webhooks WHERE organization_id = ? AND key = ?',
    [organizationId, key],
  )
  if (!hook) {
    res.status(404).json({ error: 'Webhook is not configured for this organization' })
    return
  }

  const field = await db.queryOne<{ id: number; collection_id: number }>(
    'SELECT id, collection_id FROM collection_fields WHERE id = ?',
    [fieldId],
  )
  if (!field) {
    res.status(404).json({ error: 'Field not found' })
    return
  }

  const collection = await db.queryOne<{ organization_id: number }>(
    'SELECT organization_id FROM collections WHERE id = ?',
    [field.collection_id],
  )
  if (!collection || collection.organization_id !== organizationId) {
    res.status(403).json({ error: 'Field does not belong to this organization' })
    return
  }

  if (bound) {
    await db.execute(
      'INSERT OR IGNORE INTO webhook_field_bindings (webhook_id, field_id) VALUES (?, ?)',
      [hook.id, fieldId],
    )
  } else {
    await db.execute(
      'DELETE FROM webhook_field_bindings WHERE webhook_id = ? AND field_id = ?',
      [hook.id, fieldId],
    )
  }

  res.json({ fieldId, bound })
}))

export default router
