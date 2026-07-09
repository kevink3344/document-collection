import { Router, type Request, type Response } from 'express'
import { getDb, setConfiguredDatabaseMode } from '../database/db'
import { authenticateToken } from '../middleware/auth'

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
router.get('/:key', (req: Request, res: Response) => {
  const { key } = req.params
  if (!ALLOWED_KEYS.has(key)) {
    res.status(404).json({ error: 'Setting not found' })
    return
  }

  const db = getDb()
  const row = db
    .prepare('SELECT key, value FROM app_settings WHERE key = ?')
    .get(key) as unknown as DbSetting | undefined

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
router.put('/:key', authenticateToken, (req: Request, res: Response) => {
  if (req.user?.role !== 'administrator' && req.user?.role !== 'super_admin') {
    res.status(403).json({ error: 'Administrator access required' })
    return
  }

  const { key } = req.params
  if (!ALLOWED_KEYS.has(key)) {
    res.status(404).json({ error: 'Setting not found' })
    return
  }

  const value = ((req.body as { value?: unknown }).value ?? '').toString().trim()
  if (!value) {
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

  const db = getDb()
  db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)

  res.json({ key, value })
})

export default router
