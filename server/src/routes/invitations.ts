import { Router, type Request, type Response } from 'express'
import crypto from 'crypto'
import { getDbAsync } from '../database/db'
import { authenticateToken } from '../middleware/auth'
import { loadRequestUserContext } from '../middleware/organizationAccess'

const router = Router()

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

function getDefaultPasswordHash(): string {
  const defaultPw = process.env.DEFAULT_USER_PASSWORD
  if (!defaultPw) {
    throw new Error('DEFAULT_USER_PASSWORD is not set in environment variables')
  }
  return hashPassword(defaultPw)
}

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = crypto.scryptSync(plain, salt, 32).toString('hex')
  return `${salt}:${derived}`
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  try {
    const derived = crypto.scryptSync(plain, salt, 32).toString('hex')
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'))
  } catch {
    return false
  }
}

/**
 * POST /api/invitations
 * Admin or super_admin sends an invite to an email address.
 */
router.post('/', authenticateToken, async (req: Request, res: Response) => {
  const context = await loadRequestUserContext(req)
  if (!context || (context.role !== 'administrator' && context.role !== 'super_admin')) {
    res.status(403).json({ error: 'Administrator access required' })
    return
  }

  const { email, name, role } = req.body as { email: unknown; name: unknown; role: unknown }

  if (typeof email !== 'string' || !email.trim()) {
    res.status(400).json({ error: 'email is required' })
    return
  }
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const VALID_ROLES = ['administrator', 'team_manager', 'reviewer', 'user'] as const
  const userRole =
    typeof role === 'string' && (VALID_ROLES as readonly string[]).includes(role)
      ? (role as typeof VALID_ROLES[number])
      : 'user'

  const organizationId = context.organizationId
  if (!organizationId) {
    res.status(400).json({ error: 'Inviting user has no organization assigned' })
    return
  }

  const db = await getDbAsync()

  interface PendingUser { id: number; invite_token: string | null; password_hash: string | null; must_change_password: number }
  const existing = await db.queryOne<PendingUser>('SELECT id, invite_token, password_hash, must_change_password FROM users WHERE email = ?', [email.trim()])

  if (existing && existing.password_hash && !existing.must_change_password) {
    // Fully active user with a set password — cannot re-invite without an admin reset first
    res.status(409).json({ error: 'A user with this email is already active. Use Reset Password to grant them access.' })
    return
  }

  let passwordHash: string
  try {
    passwordHash = getDefaultPasswordHash()
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
    return
  }

  if (existing) {
    // Re-invite: reset to default password and force change on next login
    await db.transaction(async (tx) => {
      await tx.execute(
        `UPDATE users
         SET name = ?, role = ?, organization_id = ?, password_hash = ?,
             must_change_password = 1, invite_token = NULL, invite_token_expires_at = NULL
         WHERE id = ?`,
        [name.trim(), userRole, organizationId, passwordHash, existing.id]
      )
      await tx.execute('DELETE FROM user_organizations WHERE user_id = ?', [existing.id])
      await tx.execute(
        `INSERT INTO user_organizations (user_id, organization_id, role, is_default)
         VALUES (?, ?, ?, 1)`,
        [existing.id, organizationId, userRole]
      )
    })
  } else {
    // Create new user with default password — must change on first login
    await db.transaction(async (tx) => {
      const inserted = await tx.execute(
        `INSERT INTO users (name, email, role, organization_id, password_hash, must_change_password, invite_token, invite_token_expires_at)
         VALUES (?, ?, ?, ?, ?, 1, NULL, NULL)`,
        [name.trim(), email.trim(), userRole, organizationId, passwordHash]
      )
      await tx.execute(
        `INSERT INTO user_organizations (user_id, organization_id, role, is_default)
         VALUES (?, ?, ?, 1)`,
        [Number(inserted.lastInsertRowid), organizationId, userRole]
      )
    })
  }

  res.status(201).json({
    message: `User created. They can log in with the default password and will be prompted to change it.`,
  })
})

/**
 * POST /api/invitations/accept
 * Public endpoint — user sets their password using the token from the invite email.
 */
router.post('/accept', async (req: Request, res: Response) => {
  const { token, newPassword } = req.body as { token: unknown; newPassword: unknown }

  if (typeof token !== 'string' || !token.trim()) {
    res.status(400).json({ error: 'token is required' })
    return
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' })
    return
  }

  const db = await getDbAsync()
  const tokenHash = hashToken(token.trim())

  interface InviteUser { id: number; invite_token_expires_at: string }
  const user = await db.queryOne<InviteUser>('SELECT id, invite_token_expires_at FROM users WHERE invite_token = ?', [tokenHash])

  if (!user) {
    res.status(400).json({ error: 'Invalid or already-used invite link.' })
    return
  }

  if (new Date(user.invite_token_expires_at) < new Date()) {
    res.status(400).json({ error: 'This invite link has expired. Please ask an admin to resend your invite.' })
    return
  }

  const passwordHash = hashPassword(newPassword)

  await db.execute(
    `UPDATE users
     SET password_hash = ?, must_change_password = 0, invite_token = NULL, invite_token_expires_at = NULL
     WHERE id = ?`,
    [passwordHash, user.id]
  )

  res.json({ message: 'Password set successfully. You can now log in.' })
})

export default router
