import { Router, type Request, type Response } from 'express'
import { authenticateToken } from '../middleware/auth'
import { loadRequestUserContext, isAdministrator } from '../middleware/organizationAccess'
import {
  addNotificationEmailCc,
  deleteNotificationEmailCc,
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
router.get('/', authenticateToken, (req: Request, res: Response) => {
  const context = loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  generateDueDateNotifications()
  res.json(listInAppNotificationsForUser(context.id, context.organizationId, isAdministrator(context)))
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
router.get('/unread-count', authenticateToken, (req: Request, res: Response) => {
  const context = loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  generateDueDateNotifications()
  res.json({ count: getUnreadInAppNotificationCount(context.id, context.organizationId, isAdministrator(context)) })
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
router.patch('/:id/read', authenticateToken, (req: Request, res: Response) => {
  const context = loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const id = parseInt(req.params.id, 10)
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid notification ID' })
    return
  }

  const updated = markInAppNotificationRead(id, context.id, context.organizationId, isAdministrator(context))
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
router.patch('/read-all', authenticateToken, (req: Request, res: Response) => {
  const context = loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  res.json({ updated: markAllInAppNotificationsRead(context.id, context.organizationId, isAdministrator(context)) })
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
router.get('/preferences', authenticateToken, (req: Request, res: Response) => {
  const userId = req.user?.sub
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  res.json(getNotificationPreferences(userId))
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
router.put('/preferences', authenticateToken, (req: Request, res: Response) => {
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

  res.json(updateNotificationPreferences(userId, updates))
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
router.get('/email-ccs', authenticateToken, (req: Request, res: Response) => {
  const userId = req.user?.sub
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  res.json(listNotificationEmailCcs(userId))
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
router.post('/email-ccs', authenticateToken, (req: Request, res: Response) => {
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
    res.json(addNotificationEmailCc(userId, email, (notificationTypes ?? null) as NotificationType[] | null))
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
router.delete('/email-ccs/:id', authenticateToken, (req: Request, res: Response) => {
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

  if (!deleteNotificationEmailCc(userId, id)) {
    res.status(404).json({ error: 'Email CC recipient not found' })
    return
  }

  res.json({ deleted: true })
})

export default router
