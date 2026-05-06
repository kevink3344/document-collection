import { Router, type Request, type Response } from 'express'
import { getDb } from '../database/db'
import { authenticateToken } from '../middleware/auth'
import { generateDueDateNotifications } from '../services/notifications'

const router = Router()

interface DbNotification {
  id: number
  user_id: number
  collection_id: number
  collection_slug: string
  type: 'due_soon' | 'overdue'
  title: string
  message: string
  due_date: string
  is_read: number
  created_at: string
  read_at: string | null
}

function toApiNotification(n: DbNotification) {
  return {
    id: n.id,
    userId: n.user_id,
    collectionId: n.collection_id,
    collectionSlug: n.collection_slug,
    type: n.type,
    title: n.title,
    message: n.message,
    dueDate: n.due_date,
    isRead: n.is_read === 1,
    createdAt: n.created_at,
    readAt: n.read_at,
  }
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
  const userId = req.user?.sub
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  generateDueDateNotifications()

  const db = getDb()
  const rows = db
    .prepare(
      `SELECT *
       FROM notifications
       WHERE user_id = ?
       ORDER BY is_read ASC, created_at DESC
       LIMIT 100`
    )
    .all(userId) as unknown as DbNotification[]

  res.json(rows.map(toApiNotification))
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
  const userId = req.user?.sub
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  generateDueDateNotifications()

  const db = getDb()
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(userId) as unknown as { count: number }

  res.json({ count: row.count })
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
  const userId = req.user?.sub
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const id = parseInt(req.params.id, 10)
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid notification ID' })
    return
  }

  const db = getDb()
  const existing = db
    .prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?')
    .get(id, userId) as unknown as DbNotification | undefined

  if (!existing) {
    res.status(404).json({ error: 'Notification not found' })
    return
  }

  db.prepare(
    `UPDATE notifications
     SET is_read = 1,
         read_at = COALESCE(read_at, datetime('now'))
     WHERE id = ? AND user_id = ?`
  ).run(id, userId)

  const updated = db
    .prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?')
    .get(id, userId) as unknown as DbNotification

  res.json(toApiNotification(updated))
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
  const userId = req.user?.sub
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const db = getDb()
  const result = db
    .prepare(
      `UPDATE notifications
       SET is_read = 1,
           read_at = COALESCE(read_at, datetime('now'))
       WHERE user_id = ? AND is_read = 0`
    )
    .run(userId)

  res.json({ updated: Number(result.changes ?? 0) })
})

export default router
