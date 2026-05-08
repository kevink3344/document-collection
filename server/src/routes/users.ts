import { Router, type Request, type Response } from 'express'
import { getDb } from '../database/db'
import { authenticateToken } from '../middleware/auth'

const router = Router()

interface DbUser {
  id: number
  name: string
  email: string
  role: 'administrator' | 'team_manager' | 'user'
  organization: string | null
  created_at: string
}

function toApiUser(u: DbUser) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    ...(u.organization ? { organization: u.organization } : {}),
    createdAt: u.created_at,
  }
}

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: List all users
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of user objects
 *       401:
 *         description: Unauthorized
 */
router.get('/', authenticateToken, (_req: Request, res: Response) => {
  const db = getDb()
  const users = db
    .prepare(
      'SELECT id, name, email, role, organization, created_at FROM users ORDER BY id'
    )
    .all() as unknown as DbUser[]

  res.json(users.map(toApiUser))
})

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Get a single user by ID
 *     tags: [Users]
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
 *         description: User object
 *       400:
 *         description: Invalid ID
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 */
router.get('/:id', authenticateToken, (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid user ID' })
    return
  }

  const db = getDb()
  const user = db
    .prepare(
      'SELECT id, name, email, role, organization, created_at FROM users WHERE id = ?'
    )
    .get(id) as unknown as DbUser | undefined

  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  res.json(toApiUser(user))
})

router.patch('/:id', authenticateToken, (req: Request, res: Response) => {
  if (req.user?.role !== 'administrator') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid user ID' })
    return
  }

  const { name, email, role, organization } = req.body as {
    name: unknown
    email: unknown
    role: unknown
    organization: unknown
  }

  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  if (typeof email !== 'string' || !email.trim()) {
    res.status(400).json({ error: 'email is required' })
    return
  }

  const VALID_ROLES = ['administrator', 'team_manager', 'user'] as const
  if (typeof role !== 'string' || !(VALID_ROLES as readonly string[]).includes(role)) {
    res.status(400).json({ error: 'Invalid role' })
    return
  }

  const db = getDb()

  const existingUser = db.prepare('SELECT id FROM users WHERE id = ?').get(id) as unknown as { id: number } | undefined
  if (!existingUser) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  const existingEmail = db
    .prepare('SELECT id FROM users WHERE email = ? AND id != ?')
    .get(email.trim(), id) as unknown as { id: number } | undefined

  if (existingEmail) {
    res.status(409).json({ error: 'Email already registered' })
    return
  }

  const org = typeof organization === 'string' && organization.trim() ? organization.trim() : null

  db.prepare('UPDATE users SET name = ?, email = ?, role = ?, organization = ? WHERE id = ?').run(
    name.trim(),
    email.trim(),
    role,
    org,
    id
  )

  const updated = db
    .prepare('SELECT id, name, email, role, organization, created_at FROM users WHERE id = ?')
    .get(id) as unknown as DbUser

  res.json(toApiUser(updated))
})

router.delete('/:id', authenticateToken, (req: Request, res: Response) => {
  if (req.user?.role !== 'administrator') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid user ID' })
    return
  }

  // Prevent self-deletion
  if (req.user.sub === id) {
    res.status(400).json({ error: 'You cannot delete your own account.' })
    return
  }

  const db = getDb()
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id) as unknown as { id: number; role: string } | undefined
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(id)
  res.status(204).end()
})

export default router
