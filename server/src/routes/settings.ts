import { Router, type Request, type Response } from 'express'
import { getDbAsync, setConfiguredDatabaseMode } from '../database/db'
import { authenticateToken } from '../middleware/auth'
import { getDocumentStorageMode, isStorageBackendAvailable, getFileCounts, type DocumentStorageMode } from '../services/documentStorage'

const router = Router()

const ALLOWED_KEYS = new Set([
  'login_message',
  'login_subtitle',
  'notification_reminder_days',
  'notification_late_days',
  'qr_code_enabled',
  'submission_confirmation_emails',
  'image_logo_padding_top',
  'image_logo_padding_right',
  'image_logo_padding_bottom',
  'image_logo_padding_left',
  'copy_answers_disclaimer',
  'ai_summary_enabled',
  'about_message',
  'database_mode',
  'login_mode',
  'maintenance_message',
  'document_storage_mode',
])

interface DbSetting {
  key: string
  value: string
}

/**
 * @swagger
 * /api/settings/{key}:
 *   get:
 *     summary: Get an app setting by key (public, no auth)
 *     tags: [Settings]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *           enum: [login_message, login_subtitle, notification_reminder_days, notification_late_days, qr_code_enabled, image_logo_padding_top, image_logo_padding_right, image_logo_padding_bottom, image_logo_padding_left, about_message]
 *         description: The setting key to retrieve
 *     responses:
 *       200:
 *         description: Setting value
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AppSetting'
 *       404:
 *         description: Setting not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:key', async (req: Request, res: Response) => {
  const { key } = req.params
  if (!ALLOWED_KEYS.has(key)) {
    res.status(404).json({ error: 'Setting not found' })
    return
  }

  // LOGIN_MODE env var overrides the database value when set to a valid mode
  if (key === 'login_mode') {
    const envOverride = process.env.LOGIN_MODE?.trim().toLowerCase()
    if (envOverride === 'maintenance' || envOverride === 'select' || envOverride === 'password') {
      res.json({ key: 'login_mode', value: envOverride })
      return
    }
  }

  const db = await getDbAsync()
  const row = await db.queryOne<DbSetting>('SELECT key, value FROM app_settings WHERE key = ?', [key])

  if (!row) {
    // Return sensible defaults for keys that haven't been persisted yet
    const defaults: Record<string, string> = { login_mode: 'select' }
    const defaultValue = defaults[key]
    if (defaultValue !== undefined) {
      res.json({ key, value: defaultValue })
      return
    }
    res.status(404).json({ error: 'Setting not found' })
    return
  }

  res.json({ key: row.key, value: row.value })
})

/**
 * @swagger
 * /api/settings/{key}:
 *   put:
 *     summary: Update an app setting (admin only)
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *           enum: [login_message, login_subtitle, notification_reminder_days, notification_late_days, qr_code_enabled, image_logo_padding_top, image_logo_padding_right, image_logo_padding_bottom, image_logo_padding_left, about_message]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [value]
 *             properties:
 *               value:
 *                 type: string
 *                 example: Welcome to Data Collection Pro.
 *     responses:
 *       200:
 *         description: Updated setting
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AppSetting'
 *       400:
 *         description: Value is required
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Administrator access required
 *       404:
 *         description: Setting key not found
 */
router.put('/:key', authenticateToken, async (req: Request, res: Response) => {
  if (req.user?.role !== 'administrator' && req.user?.role !== 'super_admin') {
    res.status(403).json({ error: 'Administrator access required' })
    return
  }

  const { key } = req.params
  if (!ALLOWED_KEYS.has(key)) {
    res.status(404).json({ error: 'Setting not found' })
    return
  }

  const value = ((req.body as { value?: unknown }).value ?? '').toString()
  if (!value.trim() && key !== 'maintenance_message') {
    res.status(400).json({ error: 'value is required' })
    return
  }

  if (key === 'database_mode') {
    const normalized = value.toLowerCase()
    if (normalized !== 'turso' && normalized !== 'sqlserver' && normalized !== 'sqlite') {
      res.status(400).json({ error: 'database_mode must be one of: turso, sqlserver, sqlite' })
      return
    }
    setConfiguredDatabaseMode(normalized as 'turso' | 'sqlserver' | 'sqlite')
  }

  if (key === 'document_storage_mode') {
    const normalized = value.toLowerCase()
    if (normalized !== 'turso_db' && normalized !== 'sql_server' && normalized !== 'google_drive') {
      res.status(400).json({ error: 'document_storage_mode must be one of: turso_db, sql_server, google_drive' })
      return
    }
  }

  const db = await getDbAsync()
  await db.execute(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  )

  res.json({ key, value })
})

/**
 * GET /api/settings/document-storage/status
 *
 * Returns the current document storage mode, availability of each backend,
 * and per-organization file counts.
 *
 * Query parameters:
 *   organizationId (optional) — scope file counts to a specific organization
 */
router.get('/document-storage/status', authenticateToken, async (req: Request, res: Response) => {
  if (req.user?.role !== 'administrator' && req.user?.role !== 'super_admin') {
    res.status(403).json({ error: 'Administrator access required' })
    return
  }

  const organizationId = req.query.organizationId
    ? Number.parseInt(String(req.query.organizationId), 10)
    : undefined

  const currentMode = await getDocumentStorageMode()

  const backends: Record<DocumentStorageMode, { available: boolean }> = {
    google_drive: { available: isStorageBackendAvailable('google_drive') },
    turso_db: { available: isStorageBackendAvailable('turso_db') },
    sql_server: { available: isStorageBackendAvailable('sql_server') },
  }

  const fileCounts = await getFileCounts(organizationId)

  res.json({
    currentMode,
    backends,
    fileCounts,
  })
})

export default router
