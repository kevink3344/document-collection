import { Router, type Request, type Response } from 'express'
import jwt from 'jsonwebtoken'
import { getDb } from '../database/db'
import { authenticateToken, JWT_SECRET } from '../middleware/auth'

const router = Router()

interface DbUser {
  id: number
  name: string
  email: string
  role: 'administrator' | 'team_manager' | 'user'
  organization: string | null
  organization_id: number | null
  organization_name?: string | null
  created_at: string
}

function toApiUser(u: DbUser) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    organizationId: u.organization_id,
    organizationName: u.organization_name ?? u.organization,
    ...(u.organization ? { organization: u.organization } : {}),
    createdAt: u.created_at,
  }
}

function signUserToken(user: DbUser): string {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      organizationId: user.organization_id,
      organizationName: user.organization_name ?? user.organization,
    },
    JWT_SECRET,
    { expiresIn: '8h' },
  )
}

/**
 * @swagger
 * /api/auth/users:
 *   get:
 *     summary: List users available in the demo/prototype login selector
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: List of users
 */
router.get('/users', (_req: Request, res: Response) => {
  const db = getDb()
  const users = db
    .prepare(
      `SELECT u.*, o.name AS organization_name
       FROM users u
       LEFT JOIN organizations o ON o.id = u.organization_id
       ORDER BY u.name COLLATE NOCASE ASC, u.id ASC`
    )
    .all() as unknown as DbUser[]

  res.json(users.map(toApiUser))
})

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
    .prepare(
      `SELECT u.*, o.name AS organization_name
       FROM users u
       LEFT JOIN organizations o ON o.id = u.organization_id
       WHERE u.id = ?`
    )
    .get(userId) as unknown as DbUser | undefined

  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  const token = signUserToken(user)

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
router.post('/register', authenticateToken, (req: Request, res: Response) => {
  if (req.user?.role !== 'administrator') {
    res.status(403).json({ error: 'Administrator access required' })
    return
  }

  const { name, email, role, organizationId } = req.body as {
    name: unknown
    email: unknown
    role: unknown
    organizationId: unknown
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

  const resolvedOrganizationId =
    typeof organizationId === 'number' && Number.isInteger(organizationId) && organizationId > 0
      ? organizationId
      : null

  const db = getDb()

  const existing = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get(email.trim()) as unknown as { id: number } | undefined

  if (existing) {
    res.status(409).json({ error: 'Email already registered' })
    return
  }

  if (resolvedOrganizationId === null) {
    res.status(400).json({ error: 'organizationId is required' })
    return
  }

  const organization = db
    .prepare('SELECT id, name FROM organizations WHERE id = ? AND is_active = 1')
    .get(resolvedOrganizationId) as unknown as { id: number; name: string } | undefined

  if (!organization) {
    res.status(400).json({ error: 'Selected organization does not exist' })
    return
  }

  const result = db
    .prepare(
      'INSERT INTO users (name, email, role, organization, organization_id) VALUES (?, ?, ?, ?, ?)'
    )
    .run(name.trim(), email.trim(), userRole, organization.name, organization.id)

  const insertedId = Number(result.lastInsertRowid)
  const newUser = db
    .prepare(
      `SELECT u.*, o.name AS organization_name
       FROM users u
       LEFT JOIN organizations o ON o.id = u.organization_id
       WHERE u.id = ?`
    )
    .get(insertedId) as unknown as DbUser

  const token = signUserToken(newUser)

  res.status(201).json({ token, user: toApiUser(newUser) })
})

export default router
