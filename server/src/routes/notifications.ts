import { Router, type Request, type Response } from 'express'
import { getDbAsync } from '../database/db'
import { authenticateToken } from '../middleware/auth'
import { loadRequestUserContext, isAdministrator } from '../middleware/organizationAccess'
import {
  addNotificationEmailCc,
  createNotificationEventWithDeliveries,
  deleteNotificationEmailCc,
  dismissInAppNotification,
  generateDueDateNotifications,
  getNotificationPreferences,
  getUnreadInAppNotificationCount,
  listInAppNotificationsForUser,
  listNotificationEmailCcs,
  markAllInAppNotificationsRead,
  markInAppNotificationRead,
  updateNotificationPreferences,
  type NotificationPreferences,
  type NotificationType,
} from '../services/notifications'

const router = Router()

function parsePreferenceUpdates(body: unknown): Partial<NotificationPreferences> | null {
  if (!body || typeof body !== 'object') {
    return null
  }

  const payload = body as Record<string, unknown>
  const updates: Partial<NotificationPreferences> = {}
  const boolKeys: Array<keyof NotificationPreferences> = [
    'inAppEnabled',
    'emailEnabled',
    'dueSoon',
    'overdue',
    'collectionUpdates',
    'submissionActivity',
    'adminEvents',
  ]

  for (const key of boolKeys) {
    if (key in payload) {
      if (typeof payload[key] !== 'boolean') {
        return null
      }

      updates[key] = payload[key] as boolean
    }
  }

  return updates
}

/**
 * @swagger
 * /api/notifications:
 *   get:
 *     summary: List notifications for the authenticated user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of notifications
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Notification'
 *       401:
 *         description: Unauthorized
 */
router.get('/', authenticateToken, async (req: Request, res: Response) => {
  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  await generateDueDateNotifications()
  res.json(await listInAppNotificationsForUser(context.id, context.organizationId, isAdministrator(context)))
})

/**
 * @swagger
 * /api/notifications/unread-count:
 *   get:
 *     summary: Get unread notification count for authenticated user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unread count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 *                   example: 3
 *       401:
 *         description: Unauthorized
 */
router.get('/unread-count', authenticateToken, async (req: Request, res: Response) => {
  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  await generateDueDateNotifications()
  res.json({ count: await getUnreadInAppNotificationCount(context.id, context.organizationId, isAdministrator(context)) })
})

/**
 * @swagger
 * /api/notifications/{id}/read:
 *   patch:
 *     summary: Mark a notification as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Updated notification
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Notification'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Notification not found
 */
router.patch('/:id/read', authenticateToken, async (req: Request, res: Response) => {
  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const id = parseInt(req.params.id, 10)
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid notification ID' })
    return
  }

  const updated = await markInAppNotificationRead(id, context.id, context.organizationId, isAdministrator(context))
  if (!updated) {
    res.status(404).json({ error: 'Notification not found' })
    return
  }

  res.json(updated)
})

/**
 * @swagger
 * /api/notifications/read-all:
 *   patch:
 *     summary: Mark all notifications as read for authenticated user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Count of updated notifications
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 updated:
 *                   type: integer
 *                   example: 5
 *       401:
 *         description: Unauthorized
 */
router.patch('/read-all', authenticateToken, async (req: Request, res: Response) => {
  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  res.json({ updated: await markAllInAppNotificationsRead(context.id, context.organizationId, isAdministrator(context)) })
})

router.patch('/:id/archive', authenticateToken, async (req: Request, res: Response) => {
  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const id = parseInt(req.params.id, 10)
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid notification ID' })
    return
  }

  const archived = await dismissInAppNotification(id, context.id, context.organizationId, isAdministrator(context))
  if (!archived) {
    res.status(404).json({ error: 'Notification not found' })
    return
  }

  res.json(archived)
})

router.get('/recipients', authenticateToken, async (req: Request, res: Response) => {
  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const db = await getDbAsync()
  const organizationId = context.organizationId ?? (req.user?.activeOrganizationId ?? req.user?.organizationId ?? null)

  const rows = context.role === 'super_admin'
    ? await db.queryAll<{ id: number; name: string; email: string; role: string; organization_id: number | null }>(`
          SELECT u.id, u.name, u.email, uo.role, uo.organization_id
          FROM users u
          JOIN user_organizations uo ON uo.user_id = u.id
          ORDER BY u.name COLLATE NOCASE, u.email
        `)
    : organizationId
      ? await db.queryAll<{ id: number; name: string; email: string; role: string; organization_id: number | null }>(`
            SELECT u.id, u.name, u.email, uo.role, uo.organization_id
            FROM users u
            JOIN user_organizations uo ON uo.user_id = u.id
            WHERE uo.organization_id = ?
            ORDER BY u.name COLLATE NOCASE, u.email
          `, [organizationId])
      : []

  res.json(rows
    .filter(row => row.id !== context.id)
    .map(row => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      organizationId: row.organization_id,
    })))
})

router.post('/send', authenticateToken, async (req: Request, res: Response) => {
  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  if (context.role === 'user') {
    res.status(403).json({ error: 'Administrator access required' })
    return
  }

  const { recipientId, subject, body } = req.body as {
    recipientId?: unknown
    subject?: unknown
    body?: unknown
  }

  const recipientUserId = typeof recipientId === 'number' && Number.isInteger(recipientId) ? recipientId : null
  const normalizedSubject = typeof subject === 'string' ? subject.trim() : ''
  const normalizedBody = typeof body === 'string' ? body.trim() : ''

  if (!recipientUserId || !normalizedSubject || !normalizedBody) {
    res.status(400).json({ error: 'recipientId, subject, and body are required' })
    return
  }

  const db = await getDbAsync()
  const recipient = await db.queryOne<{ id: number; organization_id: number | null; role: string }>(`
      SELECT u.id, uo.organization_id, uo.role
      FROM users u
      JOIN user_organizations uo ON uo.user_id = u.id
      WHERE u.id = ?
      LIMIT 1
    `, [recipientUserId])

  if (!recipient) {
    res.status(404).json({ error: 'Recipient not found' })
    return
  }

  const sameOrganization = context.role === 'super_admin'
    ? true
    : context.organizationId !== null && recipient.organization_id === context.organizationId

  if (!sameOrganization) {
    res.status(403).json({ error: 'You can only send notifications to users in your organization' })
    return
  }

  try {
    await createNotificationEventWithDeliveries(
      {
        organizationId: recipient.organization_id,
        type: 'system',
        title: normalizedSubject,
        message: normalizedBody,
        targetType: 'user',
        targetId: recipient.id,
        priority: 'normal',
      },
      [{ userId: recipient.id, channel: 'in_app', role: 'primary' }],
      db,
    )

    res.json({ ok: true, recipientId: recipient.id, subject: normalizedSubject })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to send notification' })
  }
})

/**
 * @swagger
 * /api/notifications/preferences:
 *   get:
 *     summary: Get notification preferences for the authenticated user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Notification preferences
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/NotificationPreferences'
 */
router.get('/preferences', authenticateToken, async (req: Request, res: Response) => {
  const userId = req.user?.sub
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  res.json(await getNotificationPreferences(userId))
})

/**
 * @swagger
 * /api/notifications/preferences:
 *   put:
 *     summary: Update notification preferences for the authenticated user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NotificationPreferences'
 *     responses:
 *       200:
 *         description: Updated notification preferences
 */
router.put('/preferences', authenticateToken, async (req: Request, res: Response) => {
  const userId = req.user?.sub
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const updates = parsePreferenceUpdates(req.body)
  if (!updates || Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'At least one boolean preference is required' })
    return
  }

  res.json(await updateNotificationPreferences(userId, updates))
})

/**
 * @swagger
 * /api/notifications/email-ccs:
 *   get:
 *     summary: List configured email CC recipients for the authenticated user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Email CC recipients
 */
router.get('/email-ccs', authenticateToken, async (req: Request, res: Response) => {
  const userId = req.user?.sub
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  res.json(await listNotificationEmailCcs(userId))
})

/**
 * @swagger
 * /api/notifications/email-ccs:
 *   post:
 *     summary: Add or update an email CC recipient for the authenticated user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NotificationEmailCcInput'
 *     responses:
 *       200:
 *         description: Stored email CC recipient
 */
router.post('/email-ccs', authenticateToken, async (req: Request, res: Response) => {
  const userId = req.user?.sub
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const { email, notificationTypes } = req.body as {
    email?: unknown
    notificationTypes?: unknown
  }

  if (typeof email !== 'string' || !email.trim()) {
    res.status(400).json({ error: 'email is required' })
    return
  }

  if (
    notificationTypes !== undefined
    && notificationTypes !== null
    && (!Array.isArray(notificationTypes)
      || notificationTypes.some((value) => value !== 'due_soon' && value !== 'overdue' && value !== 'system'))
  ) {
    res.status(400).json({ error: 'notificationTypes must be an array of supported notification types' })
    return
  }

  try {
    res.json(await addNotificationEmailCc(userId, email, (notificationTypes ?? null) as NotificationType[] | null))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to save email CC recipient' })
  }
})

/**
 * @swagger
 * /api/notifications/email-ccs/{id}:
 *   delete:
 *     summary: Delete an email CC recipient for the authenticated user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/email-ccs/:id', authenticateToken, async (req: Request, res: Response) => {
  const userId = req.user?.sub
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const id = parseInt(req.params.id, 10)
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid email CC ID' })
    return
  }

  if (!await deleteNotificationEmailCc(userId, id)) {
    res.status(404).json({ error: 'Email CC recipient not found' })
    return
  }

  res.json({ deleted: true })
})

export default router
