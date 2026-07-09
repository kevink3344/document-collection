import { Router, type Request, type Response } from 'express'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { getDbAsync } from '../database/db'
import { authenticateToken, JWT_SECRET } from '../middleware/auth'
import { loadRequestUserContext } from '../middleware/organizationAccess'
import { loadUserAccessProfile, toApiUser, type MembershipRole, type UserAccessProfile, type UserRole } from '../lib/userAccess'
import { verifyPassword, hashPassword } from './invitations'
import { sendNotificationEmail, isEmailDeliveryConfigured } from '../services/notificationEmail'

const router = Router()

const COOKIE_MAX_AGE_MS = 8 * 60 * 60 * 1000 // 8 hours
const RESET_EXPIRY_MS = 60 * 60 * 1000 // 1 hour

function setAuthCookie(res: Response, token: string): void {
  res.cookie('dcp-token', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE_MS,
  })
}

function signUserToken(user: UserAccessProfile): string {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      organizationId: user.activeOrganizationId,
      organizationName: user.activeOrganizationName,
      activeOrganizationId: user.activeOrganizationId,
    },
    JWT_SECRET,
    { expiresIn: '8h' },
  )
}

function isMembershipRole(value: unknown): value is MembershipRole {
  return value === 'administrator' || value === 'team_manager' || value === 'reviewer' || value === 'user'
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

router.get('/organizations', async (_req: Request, res: Response) => {
  const db = await getDbAsync()
  // Only return orgs that have at least one user (for the login picker)
  const orgs = await db.queryAll<{ id: number; name: string; description: string | null }>(
      `SELECT DISTINCT o.id, o.name, o.description
       FROM organizations o
       INNER JOIN user_organizations uo ON uo.organization_id = o.id
       ORDER BY o.name COLLATE NOCASE ASC`
    )

  res.json(orgs)
})

router.get('/users', async (req: Request, res: Response) => {
  const db = await getDbAsync()
  const { organizationId } = req.query as { organizationId?: string }

  let userIds: Array<{ id: number }>

  if (organizationId !== undefined) {
    const orgId = parseInt(organizationId, 10)
    if (!Number.isInteger(orgId) || orgId < 1) {
      res.status(400).json({ error: 'organizationId must be a positive integer' })
      return
    }
    userIds = await db.queryAll<{ id: number }>(
        `SELECT u.id FROM users u
         INNER JOIN user_organizations uo ON uo.user_id = u.id AND uo.organization_id = ?
         ORDER BY u.name COLLATE NOCASE ASC, u.id ASC`,
        [orgId]
      )
  } else {
    userIds = await db.queryAll<{ id: number }>('SELECT id FROM users ORDER BY name COLLATE NOCASE ASC, id ASC')
  }

  const profiles = await Promise.all(userIds.map(row => loadUserAccessProfile(row.id, null, db)))
  const users = profiles.filter((user): user is UserAccessProfile => Boolean(user))

  res.json(users.map(toApiUser))
})

router.post('/login', async (req: Request, res: Response) => {
  const { userId } = req.body as { userId: unknown }

  if (typeof userId !== 'number' || !Number.isInteger(userId) || userId < 1) {
    res.status(400).json({ error: 'userId must be a positive integer' })
    return
  }

  const user = await loadUserAccessProfile(userId)
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  const token = signUserToken(user)
  setAuthCookie(res, token)
  res.json({ token, user: toApiUser(user) })
})

router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('dcp-token', { path: '/' })
  res.json({ message: 'Logged out' })
})

router.post('/register', authenticateToken, async (req: Request, res: Response) => {
  const currentUser = await loadRequestUserContext(req)
  if (!currentUser || (currentUser.role !== 'administrator' && currentUser.role !== 'super_admin')) {
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

  const VALID_ROLES = ['super_admin', 'administrator', 'team_manager', 'reviewer', 'user'] as const
  const userRole =
    typeof role === 'string' && (VALID_ROLES as readonly string[]).includes(role)
      ? (role as UserRole)
      : 'user'

  if (currentUser.role !== 'super_admin' && userRole === 'super_admin') {
    res.status(403).json({ error: 'Only a super admin can create another super admin' })
    return
  }

  const resolvedOrganizationId =
    currentUser.role === 'super_admin'
      ? (typeof organizationId === 'number' && Number.isInteger(organizationId) && organizationId > 0 ? organizationId : null)
      : currentUser.organizationId

  if (userRole !== 'super_admin' && resolvedOrganizationId === null) {
    res.status(400).json({ error: 'organizationId is required' })
    return
  }

  const db = await getDbAsync()
  const existing = await db.queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email.trim()])

  if (existing) {
    res.status(409).json({ error: 'Email already registered' })
    return
  }

  let organization: { id: number; name: string } | undefined
  if (resolvedOrganizationId !== null) {
    organization = await db.queryOne<{ id: number; name: string }>('SELECT id, name FROM organizations WHERE id = ? AND is_active = 1', [resolvedOrganizationId])
    if (!organization) {
      res.status(400).json({ error: 'Selected organization does not exist' })
      return
    }
  }

  const insertedId = await db.transaction(async (tx) => {
    const inserted = await tx.execute(
      'INSERT INTO users (name, email, role, organization, organization_id) VALUES (?, ?, ?, ?, ?)',
      [name.trim(), email.trim(), userRole, organization?.name ?? null, organization?.id ?? null]
    )

    const id = Number(inserted.lastInsertRowid)
    if (organization && isMembershipRole(userRole)) {
      await tx.execute(
        `INSERT INTO user_organizations (user_id, organization_id, role, is_default) VALUES (?, ?, ?, 1)`,
        [id, organization.id, userRole]
      )
    }
    return id
  })

  const newUser = await loadUserAccessProfile(insertedId)
  if (!newUser) {
    res.status(500).json({ error: 'Failed to load created user' })
    return
  }

  const token = signUserToken(newUser)
  setAuthCookie(res, token)
  res.status(201).json({ token, user: toApiUser(newUser) })
})

router.get('/me', authenticateToken, async (req: Request, res: Response) => {
  const user = await loadUserAccessProfile(req.user!.sub, req.user?.activeOrganizationId ?? req.user?.organizationId ?? null)
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  res.json(toApiUser(user))
})

router.post('/switch-organization', authenticateToken, async (req: Request, res: Response) => {
  const { organizationId } = req.body as { organizationId?: unknown }
  if (typeof organizationId !== 'number' || !Number.isInteger(organizationId) || organizationId < 1) {
    res.status(400).json({ error: 'organizationId must be a positive integer' })
    return
  }

  const user = await loadUserAccessProfile(req.user!.sub, organizationId)
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  if (user.role !== 'super_admin' && user.activeOrganizationId !== organizationId) {
    res.status(403).json({ error: 'You do not belong to the selected organization' })
    return
  }

  const token = signUserToken(user)
  setAuthCookie(res, token)
  res.json({ token, user: toApiUser(user) })
})

router.post('/login-with-password', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email: unknown; password: unknown }

  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'email and password are required' })
    return
  }

  const db = await getDbAsync()
  const userRow = await db.queryOne<{ id: number }>('SELECT id FROM users WHERE lower(email) = lower(?)', [email.trim()])

  const INVALID = 'Invalid email or password'
  if (!userRow) {
    res.status(401).json({ error: INVALID })
    return
  }

  const user = await loadUserAccessProfile(userRow.id)
  if (!user) {
    res.status(401).json({ error: INVALID })
    return
  }

  if (user.inviteToken || !user.passwordHash) {
    res.status(401).json({ error: 'Your account is not yet activated. Please use the invite link sent to your email.' })
    return
  }

  if (!verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: INVALID })
    return
  }

  const token = signUserToken(user)
  setAuthCookie(res, token)
  res.json({ token, user: toApiUser(user) })
})

router.post('/forgot-password', async (req: Request, res: Response) => {
  const { email } = req.body as { email: unknown }

  if (typeof email !== 'string' || !email.trim()) {
    res.status(400).json({ error: 'email is required' })
    return
  }

  const db2 = await getDbAsync()
  interface ResetUser { id: number; name: string; password_hash: string | null; invite_token: string | null }
  const user = await db2.queryOne<ResetUser>('SELECT id, name, password_hash, invite_token FROM users WHERE LOWER(email) = LOWER(?)', [email.trim()])

  if (!user || !user.password_hash || user.invite_token) {
    res.json({ message: 'If that email is registered, a reset link has been sent.' })
    return
  }

  const rawToken = crypto.randomBytes(32).toString('hex')
  const tokenHash = hashToken(rawToken)
  const expiresAt = new Date(Date.now() + RESET_EXPIRY_MS).toISOString()

  await db2.execute(
    `UPDATE users SET reset_token = ?, reset_token_expires_at = ? WHERE id = ?`,
    [tokenHash, expiresAt, user.id]
  )

  const appUrl = (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '')
  const resetLink = `${appUrl}/reset-password?token=${rawToken}`

  const responsePayload: { message: string; resetLink?: string } = {
    message: 'If that email is registered, a reset link has been sent.',
  }

  if (isEmailDeliveryConfigured()) {
    try {
      await sendNotificationEmail({
        to: email.trim(),
        subject: 'Reset your Data Collection Pro password',
        text: [
          `Hi ${user.name},`,
          '',
          'We received a request to reset your password for Data Collection Pro.',
          '',
          'Click the link below to choose a new password:',
          '',
          resetLink,
          '',
          'This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.',
        ].join('\n'),
      })
    } catch (err) {
      console.error('[auth] Failed to send reset email:', (err as Error).message)
    }
  }

  if (process.env.NODE_ENV !== 'production' && !isEmailDeliveryConfigured()) {
    responsePayload.resetLink = resetLink
  }

  res.json(responsePayload)
})

router.post('/reset-password', async (req: Request, res: Response) => {
  const { token, newPassword } = req.body as { token: unknown; newPassword: unknown }

  if (typeof token !== 'string' || !token.trim()) {
    res.status(400).json({ error: 'token is required' })
    return
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({ error: 'newPassword must be at least 8 characters' })
    return
  }

  const tokenHash = hashToken(token.trim())
  const db = await getDbAsync()

  interface ResetUser { id: number; reset_token: string | null; reset_token_expires_at: string | null }
  const user = await db.queryOne<ResetUser>('SELECT id, reset_token, reset_token_expires_at FROM users WHERE reset_token = ?', [tokenHash])

  if (!user) {
    res.status(400).json({ error: 'Invalid or expired reset link.' })
    return
  }

  if (!user.reset_token_expires_at || new Date(user.reset_token_expires_at) < new Date()) {
    await db.execute('UPDATE users SET reset_token = NULL, reset_token_expires_at = NULL WHERE id = ?', [user.id])
    res.status(400).json({ error: 'This reset link has expired. Please request a new one.' })
    return
  }

  const passwordHash = hashPassword(newPassword)
  await db.execute(
    `UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires_at = NULL WHERE id = ?`,
    [passwordHash, user.id]
  )

  res.json({ message: 'Password updated successfully.' })
})

export default router
