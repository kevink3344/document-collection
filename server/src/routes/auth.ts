import { Router, type Request, type Response } from 'express'
import jwt from 'jsonwebtoken'
import { getDb } from '../database/db'
import { JWT_SECRET } from '../middleware/auth'

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
 * /api/auth/login:
 *   post:
 *     summary: Sign in as an existing user (by userId — demo/prototype flow)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId]
 *             properties:
 *               userId:
 *                 type: integer
 *                 example: 1
 *     responses:
 *       200:
 *         description: Login successful, returns JWT and user object
 *       400:
 *         description: Bad request
 *       404:
 *         description: User not found
 */
router.post('/login', (req: Request, res: Response) => {
  const { userId } = req.body as { userId: unknown }

  if (typeof userId !== 'number' || !Number.isInteger(userId) || userId < 1) {
    res.status(400).json({ error: 'userId must be a positive integer' })
    return
  }

  const db = getDb()
  const user = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(userId) as unknown as DbUser | undefined

  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  const token = jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, {
    expiresIn: '8h',
  })

  res.json({ token, user: toApiUser(user) })
})

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user account
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Jane Doe
 *               email:
 *                 type: string
 *                 format: email
 *                 example: jane@example.com
 *               role:
 *                 type: string
 *                 enum: [administrator, team_manager, user]
 *                 default: user
 *               organization:
 *                 type: string
 *                 example: Alpha Team
 *     responses:
 *       201:
 *         description: User created; returns JWT and user object
 *       400:
 *         description: Validation error
 *       409:
 *         description: Email already registered
 */
router.post('/register', (req: Request, res: Response) => {
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
  const userRole =
    typeof role === 'string' && (VALID_ROLES as readonly string[]).includes(role)
      ? (role as typeof VALID_ROLES[number])
      : 'user'

  const db = getDb()

  const existing = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get(email.trim()) as unknown as { id: number } | undefined

  if (existing) {
    res.status(409).json({ error: 'Email already registered' })
    return
  }

  const org =
    typeof organization === 'string' && organization.trim()
      ? organization.trim()
      : null

  const result = db
    .prepare(
      'INSERT INTO users (name, email, role, organization) VALUES (?, ?, ?, ?)'
    )
    .run(name.trim(), email.trim(), userRole, org)

  const insertedId = Number(result.lastInsertRowid)
  const newUser = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(insertedId) as unknown as DbUser

  const token = jwt.sign({ sub: newUser.id, role: newUser.role }, JWT_SECRET, {
    expiresIn: '8h',
  })

  res.status(201).json({ token, user: toApiUser(newUser) })
})

export default router
