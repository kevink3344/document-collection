import { Router, type Request, type Response } from 'express'
import { getDb } from '../database/db'
import { authenticateToken } from '../middleware/auth'

const router = Router()

const ALLOWED_KEYS = new Set([
  'login_message',
  'login_subtitle',
  'notification_reminder_days',
  'notification_late_days',
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
 *           enum: [login_message, login_subtitle, notification_reminder_days, notification_late_days]
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
 *           enum: [login_message, login_subtitle, notification_reminder_days, notification_late_days]
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
  if (req.user?.role !== 'administrator') {
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

  const db = getDb()
  db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)

  res.json({ key, value })
})

export default router
