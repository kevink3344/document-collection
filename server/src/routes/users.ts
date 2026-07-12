import { Router, type Request, type Response } from 'express'
import { getDbAsync } from '../database/db'
import { authenticateToken } from '../middleware/auth'
import { loadRequestUserContext, type RequestUserContext } from '../middleware/organizationAccess'
import { loadUserAccessProfile, toApiUser, type MembershipRole, type UserAccessProfile, type UserRole, type UserOrganizationMembership } from '../lib/userAccess'

const router = Router()

interface MembershipInput {
  organizationId: number
  role: MembershipRole
  isDefault: boolean
}

function isMembershipRole(value: unknown): value is MembershipRole {
  return value === 'administrator' || value === 'team_manager' || value === 'reviewer' || value === 'user'
}

function normalizeMemberships(inputs: MembershipInput[]): MembershipInput[] {
  if (inputs.length === 0) {
    return []
  }

  const byOrg = new Map<number, MembershipInput>()
  inputs.forEach((input, index) => {
    byOrg.set(input.organizationId, {
      organizationId: input.organizationId,
      role: input.role,
      isDefault: input.isDefault || index === 0,
    })
  })

  const normalized = Array.from(byOrg.values())
  if (!normalized.some(item => item.isDefault)) {
    normalized[0].isDefault = true
  }

  let defaultAssigned = false
  return normalized.map(item => {
    if (item.isDefault && !defaultAssigned) {
      defaultAssigned = true
      return item
    }
    return { ...item, isDefault: false }
  })
}

function sanitizeProfileForContext(profile: UserAccessProfile, viewer: RequestUserContext | null): UserAccessProfile | null {
  if (!viewer) {
    return null
  }

  if (viewer.role === 'super_admin') {
    return profile
  }

  const visibleMemberships = profile.organizations.filter(org => org.organizationId === viewer.organizationId)
  if (visibleMemberships.length === 0) {
    return null
  }

  const activeMembership = visibleMemberships.find(org => org.organizationId === viewer.organizationId) ?? visibleMemberships[0]
  return {
    ...profile,
    role: activeMembership.role,
    activeOrganizationId: activeMembership.organizationId,
    activeOrganizationName: activeMembership.organizationName,
    activeOrganizationSlug: activeMembership.organizationSlug,
    activeOrganizationDescription: activeMembership.organizationDescription,
    organizationId: activeMembership.organizationId,
    organizationName: activeMembership.organizationName,
    organizationSlug: activeMembership.organizationSlug,
    organizationDescription: activeMembership.organizationDescription,
    organization: activeMembership.organizationName,
    organizations: visibleMemberships,
  }
}

function parseMembershipPayload(
  body: { role?: unknown; organizationId?: unknown; memberships?: unknown },
  currentUser: RequestUserContext,
): { systemRole: UserRole; memberships: MembershipInput[] } | { error: string } {
  const requestedRole = typeof body.role === 'string' ? body.role : 'user'
  const validRoles: UserRole[] = ['super_admin', 'administrator', 'team_manager', 'reviewer', 'user']
  if (!validRoles.includes(requestedRole as UserRole)) {
    return { error: 'Invalid role' }
  }

  const rawMemberships = Array.isArray(body.memberships)
    ? body.memberships
        .map(item => {
          if (!item || typeof item !== 'object') return null
          const value = item as { organizationId?: unknown; role?: unknown; isDefault?: unknown }
          if (typeof value.organizationId !== 'number' || !Number.isInteger(value.organizationId) || value.organizationId < 1) {
            return null
          }
          if (!isMembershipRole(value.role)) {
            return null
          }
          return {
            organizationId: value.organizationId,
            role: value.role,
            isDefault: value.isDefault === true,
          }
        })
        .filter((item): item is MembershipInput => Boolean(item))
    : []

  const legacyOrganizationId = typeof body.organizationId === 'number' && Number.isInteger(body.organizationId) && body.organizationId > 0
    ? body.organizationId
    : null

  const memberships = normalizeMemberships(
    rawMemberships.length > 0
      ? rawMemberships
      : legacyOrganizationId && isMembershipRole(requestedRole)
        ? [{ organizationId: legacyOrganizationId, role: requestedRole, isDefault: true }]
        : []
  )

  if (currentUser.role !== 'super_admin' && requestedRole === 'super_admin') {
    return { error: 'You cannot assign the super_admin role' }
  }

  if (currentUser.role !== 'super_admin') {
    const viewerOrgId = currentUser.organizationId
    if (!viewerOrgId) {
      return { error: 'Your account does not have an active organization' }
    }

    const scopedRole = isMembershipRole(requestedRole) ? requestedRole : 'user'
    return {
      systemRole: scopedRole,
      memberships: [{ organizationId: viewerOrgId, role: scopedRole, isDefault: true }],
    }
  }

  if (requestedRole !== 'super_admin' && memberships.length === 0) {
    return { error: 'At least one organization membership is required' }
  }

  return {
    systemRole: requestedRole as UserRole,
    memberships,
  }
}

async function loadAccessibleUserProfile(
  id: number,
  currentUser: RequestUserContext,
): Promise<UserAccessProfile | null> {
  const profile = await loadUserAccessProfile(id)
  if (!profile) {
    return null
  }

  return sanitizeProfileForContext(profile, currentUser)
}

async function persistMemberships(
  userId: number,
  systemRole: UserRole,
  memberships: MembershipInput[],
): Promise<void> {
  const db = await getDbAsync()
  const defaultMembership = memberships.find(item => item.isDefault) ?? memberships[0] ?? null

  const defaultOrganization = defaultMembership
    ? await db.queryOne<{ id: number; name: string }>('SELECT id, name FROM organizations WHERE id = ? AND is_active = 1', [defaultMembership.organizationId])
    : undefined

  await db.transaction(async (tx) => {
    await tx.execute(
      `UPDATE users SET role = ?, organization = ?, organization_id = ? WHERE id = ?`,
      [
        systemRole === 'super_admin' ? 'super_admin' : (defaultMembership?.role ?? 'user'),
        defaultOrganization?.name ?? null,
        defaultOrganization?.id ?? null,
        userId,
      ]
    )

    await tx.execute('DELETE FROM user_organizations WHERE user_id = ?', [userId])
    for (const membership of memberships) {
      await tx.execute(
        `INSERT INTO user_organizations (user_id, organization_id, role, is_default, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
        [userId, membership.organizationId, membership.role, membership.isDefault ? 1 : 0]
      )
    }
  })
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
router.get('/', authenticateToken, async (_req: Request, res: Response) => {
  const currentUser = await loadRequestUserContext(_req)
  if (!currentUser || (currentUser.role !== 'administrator' && currentUser.role !== 'super_admin')) {
    res.status(403).json({ error: 'Administrator access required' })
    return
  }

  const db = await getDbAsync()
  const userIds = currentUser.role === 'super_admin'
    ? await db.queryAll<{ id: number }>('SELECT id FROM users ORDER BY id')
    : await db.queryAll<{ id: number }>(
        `SELECT DISTINCT user_id AS id
           FROM user_organizations
           WHERE organization_id = ?
           ORDER BY user_id`,
        [currentUser.organizationId]
      )

  const users = (await Promise.all(userIds.map(row => loadAccessibleUserProfile(row.id, currentUser))))
    .filter((user): user is UserAccessProfile => Boolean(user))

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
router.get('/:id', authenticateToken, async (req: Request, res: Response) => {
  const currentUser = await loadRequestUserContext(req)
  if (!currentUser || (currentUser.role !== 'administrator' && currentUser.role !== 'super_admin')) {
    res.status(403).json({ error: 'Administrator access required' })
    return
  }

  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid user ID' })
    return
  }

  const user = await loadAccessibleUserProfile(id, currentUser)

  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  res.json(toApiUser(user))
})

router.post('/', authenticateToken, async (req: Request, res: Response) => {
  const currentUser = await loadRequestUserContext(req)
  if (!currentUser || (currentUser.role !== 'administrator' && currentUser.role !== 'super_admin')) {
    res.status(403).json({ error: 'Administrator access required' })
    return
  }

  const { name, email } = req.body as {
    name: unknown
    email: unknown
  }

  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  if (typeof email !== 'string' || !email.trim()) {
    res.status(400).json({ error: 'email is required' })
    return
  }

  const parsedPayload = parseMembershipPayload(req.body as {
    role?: unknown
    organizationId?: unknown
    memberships?: unknown
  }, currentUser)
  if ('error' in parsedPayload) {
    res.status(400).json({ error: parsedPayload.error })
    return
  }

  const db = await getDbAsync()
  const existingEmail = await db.queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email.trim()])

  if (existingEmail) {
    res.status(409).json({ error: 'Email already registered' })
    return
  }

  for (const membership of parsedPayload.memberships) {
    const organization = await db.queryOne<{ id: number }>('SELECT id FROM organizations WHERE id = ? AND is_active = 1', [membership.organizationId])
    if (!organization) {
      res.status(400).json({ error: 'Selected organization does not exist' })
      return
    }
  }

  const inserted = await db.execute('INSERT INTO users (name, email, role) VALUES (?, ?, ?)', [name.trim(), email.trim(), parsedPayload.systemRole === 'super_admin' ? 'super_admin' : 'user'])

  const createdUserId = Number(inserted.lastInsertRowid)
  await persistMemberships(createdUserId, parsedPayload.systemRole, parsedPayload.memberships)

  const created = await loadAccessibleUserProfile(createdUserId, currentUser)
  if (!created) {
    res.status(500).json({ error: 'Failed to load created user' })
    return
  }

  res.status(201).json(toApiUser(created))
})

router.patch('/:id', authenticateToken, async (req: Request, res: Response) => {
  const currentUser = await loadRequestUserContext(req)
  if (!currentUser || (currentUser.role !== 'administrator' && currentUser.role !== 'super_admin')) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid user ID' })
    return
  }

  const { name, email } = req.body as {
    name: unknown
    email: unknown
  }

  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  if (typeof email !== 'string' || !email.trim()) {
    res.status(400).json({ error: 'email is required' })
    return
  }

  const parsedPayload = parseMembershipPayload(req.body as {
    role?: unknown
    organizationId?: unknown
    memberships?: unknown
  }, currentUser)
  if ('error' in parsedPayload) {
    res.status(400).json({ error: parsedPayload.error })
    return
  }

  const db = await getDbAsync()

  const existingUser = await loadUserAccessProfile(id)
  if (!existingUser) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  if (currentUser.role !== 'super_admin' && !existingUser.organizations.some(org => org.organizationId === currentUser.organizationId)) {
    res.status(403).json({ error: 'You can only edit users within your own organization' })
    return
  }

  const existingEmail = await db.queryOne<{ id: number }>('SELECT id FROM users WHERE email = ? AND id != ?', [email.trim(), id])

  if (existingEmail) {
    res.status(409).json({ error: 'Email already registered' })
    return
  }

  for (const membership of parsedPayload.memberships) {
    const organization = await db.queryOne<{ id: number }>('SELECT id FROM organizations WHERE id = ? AND is_active = 1', [membership.organizationId])
    if (!organization) {
      res.status(400).json({ error: 'Selected organization does not exist' })
      return
    }
  }

  await db.execute('UPDATE users SET name = ?, email = ? WHERE id = ?', [name.trim(), email.trim(), id])
  await persistMemberships(id, parsedPayload.systemRole, parsedPayload.memberships)

  const updated = await loadAccessibleUserProfile(id, currentUser)
  if (!updated) {
    res.status(500).json({ error: 'Failed to load updated user' })
    return
  }

  res.json(toApiUser(updated))
})

/**
 * POST /api/users/:id/reset-password
 * Admin resets a user's password back to DEFAULT_USER_PASSWORD and flags must_change_password.
 */
router.post('/:id/reset-password', authenticateToken, async (req: Request, res: Response) => {
  const currentUser = await loadRequestUserContext(req)
  if (!currentUser || (currentUser.role !== 'administrator' && currentUser.role !== 'super_admin')) {
    res.status(403).json({ error: 'Administrator access required' })
    return
  }

  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid user ID' })
    return
  }

  const defaultPw = process.env.DEFAULT_USER_PASSWORD
  if (!defaultPw) {
    res.status(500).json({ error: 'DEFAULT_USER_PASSWORD is not set in environment variables' })
    return
  }

  const { hashPassword } = await import('./invitations')
  const db = await getDbAsync()

  const target = await loadUserAccessProfile(id)
  if (!target) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  if (currentUser.role === 'administrator' && !target.organizations.some(org => org.organizationId === currentUser.organizationId)) {
    res.status(403).json({ error: 'You can only reset passwords for users within your own organization' })
    return
  }

  const newHash = hashPassword(defaultPw)
  await db.execute(
    'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
    [newHash, id]
  )

  res.json({ message: 'Password reset to default. User will be prompted to change it on next login.' })
})

router.delete('/:id', authenticateToken, async (req: Request, res: Response) => {
  const currentUser = await loadRequestUserContext(req)
  if (!currentUser || (currentUser.role !== 'administrator' && currentUser.role !== 'super_admin')) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid user ID' })
    return
  }

  // Prevent self-deletion
  if (currentUser.id === id) {
    res.status(400).json({ error: 'You cannot delete your own account.' })
    return
  }

  const db = await getDbAsync()
  const user = await loadUserAccessProfile(id)
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  if (currentUser.role === 'administrator' && !user.organizations.some(org => org.organizationId === currentUser.organizationId)) {
    res.status(403).json({ error: 'You can only delete users within your own organization' })
    return
  }

  await db.execute('DELETE FROM users WHERE id = ?', [id])
  res.status(204).end()
})

// ── User location assignment ────────────────────────────────────────────

router.get('/:id/locations', authenticateToken, async (req: Request, res: Response) => {
  const currentUser = await loadRequestUserContext(req)
  if (!currentUser || (currentUser.role !== 'administrator' && currentUser.role !== 'super_admin')) {
    res.status(403).json({ error: 'Administrator access required' })
    return
  }

  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid user ID' })
    return
  }

  const db = await getDbAsync()
  const locations = await db.queryAll<{ id: number; name: string }>(
      `SELECT l.id, l.name FROM user_locations ul
       JOIN locations l ON l.id = ul.location_id
       WHERE ul.user_id = ?
       ORDER BY lower(l.name)`,
      [id]
    )

  res.json(locations)
})

router.put('/:id/locations', authenticateToken, async (req: Request, res: Response) => {
  const currentUser = await loadRequestUserContext(req)
  if (!currentUser || (currentUser.role !== 'administrator' && currentUser.role !== 'super_admin')) {
    res.status(403).json({ error: 'Administrator access required' })
    return
  }

  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid user ID' })
    return
  }

  const { locationIds } = req.body as { locationIds: unknown }
  if (!Array.isArray(locationIds) || locationIds.some(x => typeof x !== 'number')) {
    res.status(400).json({ error: 'locationIds must be an array of numbers' })
    return
  }

  const db = await getDbAsync()
  const user = await loadUserAccessProfile(id)
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  if (currentUser.role === 'administrator' && !user.organizations.some(org => org.organizationId === currentUser.organizationId)) {
    res.status(403).json({ error: 'You can only manage users within your own organization' })
    return
  }

  try {
    await db.execute('DELETE FROM user_locations WHERE user_id = ?', [id])
    for (const locId of locationIds as number[]) {
      await db.execute('INSERT OR IGNORE INTO user_locations (user_id, location_id) VALUES (?, ?)', [id, locId])
    }
    res.status(204).end()
  } catch (err) {
    console.error('[users] update locations error:', err)
    res.status(500).json({ error: (err as Error).message ?? 'Failed to update user locations' })
  }
})

export default router
