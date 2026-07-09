import { Router, type Request, type Response } from 'express'
import { getDbAsync } from '../database/db'
import { authenticateToken } from '../middleware/auth'
import { loadRequestUserContext } from '../middleware/organizationAccess'

const router = Router()

// ── Helpers ──────────────────────────────────────────────────────────────────

function canManageGroups(role: string): boolean {
  return role === 'super_admin' || role === 'administrator' || role === 'team_manager'
}

// ── GET /api/groups — list groups for org ────────────────────────────────────
router.get('/', authenticateToken, async (req: Request, res: Response) => {
  const context = await loadRequestUserContext(req)
  if (!context) return void res.status(401).json({ error: 'Authentication required' })

  const db = await getDbAsync()

  let rows: Array<{
    id: number
    organization_id: number
    name: string
    description: string | null
    created_by: number | null
    created_at: string
    updated_at: string
    member_count: number
  }>

  if (context.role === 'super_admin' && !context.organizationId) {
    // super_admin without org scope — return all groups
    rows = await db.queryAll(`
      SELECT g.*, COUNT(gm.user_id) AS member_count
      FROM groups g
      LEFT JOIN group_members gm ON gm.group_id = g.id
      GROUP BY g.id
      ORDER BY lower(g.name)
    `) as typeof rows
  } else {
    const orgId = context.organizationId
    rows = await db.queryAll(`
      SELECT g.*, COUNT(gm.user_id) AS member_count
      FROM groups g
      LEFT JOIN group_members gm ON gm.group_id = g.id
      WHERE g.organization_id = ?
      GROUP BY g.id
      ORDER BY lower(g.name)
    `, [orgId]) as typeof rows
  }

  res.json(rows.map(g => ({
    id: g.id,
    organizationId: g.organization_id,
    name: g.name,
    description: g.description,
    createdBy: g.created_by,
    createdAt: g.created_at,
    updatedAt: g.updated_at,
    memberCount: g.member_count,
  })))
})

// ── POST /api/groups — create group ──────────────────────────────────────────
router.post('/', authenticateToken, async (req: Request, res: Response) => {
  const context = await loadRequestUserContext(req)
  if (!context) return void res.status(401).json({ error: 'Authentication required' })
  if (!canManageGroups(context.role)) return void res.status(403).json({ error: 'Insufficient permissions' })

  const { name, description } = req.body as { name?: string; description?: string }
  if (!name?.trim()) return void res.status(400).json({ error: 'name is required' })

  const orgId = context.organizationId
  if (!orgId) return void res.status(400).json({ error: 'Organization context required' })

  const db = await getDbAsync()
  try {
    const result = await db.execute(`
      INSERT INTO groups (organization_id, name, description, created_by)
      VALUES (?, ?, ?, ?)
    `, [orgId, name.trim(), description?.trim() ?? null, context.id])

    const row = await db.queryOne<{
      id: number; organization_id: number; name: string; description: string | null
      created_by: number | null; created_at: string; updated_at: string; member_count: number
    }>(`
      SELECT g.*, 0 AS member_count
      FROM groups g WHERE g.id = ?
    `, [result.lastInsertRowid])

    if (!row) {
      res.status(500).json({ error: 'Failed to load created group' })
      return
    }

    res.status(201).json({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      description: row.description,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      memberCount: 0,
    })
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).message?.includes('UNIQUE')) {
      return void res.status(409).json({ error: 'A group with that name already exists' })
    }
    throw err
  }
})

// ── PATCH /api/groups/:id — update name/description ──────────────────────────
router.patch('/:id', authenticateToken, async (req: Request, res: Response) => {
  const context = await loadRequestUserContext(req)
  if (!context) return void res.status(401).json({ error: 'Authentication required' })
  if (!canManageGroups(context.role)) return void res.status(403).json({ error: 'Insufficient permissions' })

  const groupId = Number(req.params.id)
  const { name, description } = req.body as { name?: string; description?: string }
  if (!name?.trim()) return void res.status(400).json({ error: 'name is required' })

  const db = await getDbAsync()
  const existing = await db.queryOne<{ id: number; organization_id: number }>('SELECT * FROM groups WHERE id = ?', [groupId])

  if (!existing) return void res.status(404).json({ error: 'Group not found' })

  // Scope check: non-super_admin can only touch their org's groups
  if (context.role !== 'super_admin' && existing.organization_id !== context.organizationId) {
    return void res.status(403).json({ error: 'Forbidden' })
  }

  try {
    await db.execute(`
      UPDATE groups SET name = ?, description = ?, updated_at = datetime('now')
      WHERE id = ?
    `, [name.trim(), description?.trim() ?? null, groupId])

    const row = await db.queryOne<{
      id: number; organization_id: number; name: string; description: string | null
      created_by: number | null; created_at: string; updated_at: string; member_count: number
    }>(`
      SELECT g.*, COUNT(gm.user_id) AS member_count
      FROM groups g LEFT JOIN group_members gm ON gm.group_id = g.id
      WHERE g.id = ?
      GROUP BY g.id
    `, [groupId])

    if (!row) {
      res.status(500).json({ error: 'Failed to load updated group' })
      return
    }

    res.json({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      description: row.description,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      memberCount: row.member_count,
    })
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).message?.includes('UNIQUE')) {
      return void res.status(409).json({ error: 'A group with that name already exists' })
    }
    throw err
  }
})

// ── DELETE /api/groups/:id ────────────────────────────────────────────────────
router.delete('/:id', authenticateToken, async (req: Request, res: Response) => {
  const context = await loadRequestUserContext(req)
  if (!context) return void res.status(401).json({ error: 'Authentication required' })
  if (!canManageGroups(context.role)) return void res.status(403).json({ error: 'Insufficient permissions' })

  const groupId = Number(req.params.id)
  const db = await getDbAsync()
  const existing = await db.queryOne<{ id: number; organization_id: number }>('SELECT * FROM groups WHERE id = ?', [groupId])

  if (!existing) return void res.status(404).json({ error: 'Group not found' })

  if (context.role !== 'super_admin' && existing.organization_id !== context.organizationId) {
    return void res.status(403).json({ error: 'Forbidden' })
  }

  await db.execute('DELETE FROM groups WHERE id = ?', [groupId])
  res.json({ success: true })
})

// ── GET /api/groups/:id/members ─────────────────────────────────────────────
router.get('/:id/members', authenticateToken, async (req: Request, res: Response) => {
  const context = await loadRequestUserContext(req)
  if (!context) return void res.status(401).json({ error: 'Authentication required' })

  const groupId = Number(req.params.id)
  const db = await getDbAsync()
  const existing = await db.queryOne<{ id: number; organization_id: number }>('SELECT * FROM groups WHERE id = ?', [groupId])

  if (!existing) return void res.status(404).json({ error: 'Group not found' })

  if (context.role !== 'super_admin' && existing.organization_id !== context.organizationId) {
    return void res.status(403).json({ error: 'Forbidden' })
  }

  const members = await db.queryAll<{ id: number; name: string; email: string; role: string; added_at: string }>(`
    SELECT u.id, u.name, u.email, u.role, gm.added_at
    FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ?
    ORDER BY lower(u.name)
  `, [groupId])

  res.json(members.map(m => ({
    userId: m.id,
    name: m.name,
    email: m.email,
    role: m.role,
    addedAt: m.added_at,
  })))
})

// ── POST /api/groups/:id/members — add user ───────────────────────────────────
router.post('/:id/members', authenticateToken, async (req: Request, res: Response) => {
  const context = await loadRequestUserContext(req)
  if (!context) return void res.status(401).json({ error: 'Authentication required' })
  if (!canManageGroups(context.role)) return void res.status(403).json({ error: 'Insufficient permissions' })

  const groupId = Number(req.params.id)
  const { userId } = req.body as { userId?: number }
  if (!userId) return void res.status(400).json({ error: 'userId is required' })

  const db = await getDbAsync()
  const existing = await db.queryOne<{ id: number; organization_id: number }>('SELECT * FROM groups WHERE id = ?', [groupId])

  if (!existing) return void res.status(404).json({ error: 'Group not found' })

  if (context.role !== 'super_admin' && existing.organization_id !== context.organizationId) {
    return void res.status(403).json({ error: 'Forbidden' })
  }

  await db.execute(`
    INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)
  `, [groupId, userId])

  res.status(201).json({ success: true })
})

// ── DELETE /api/groups/:id/members/:userId — remove user ─────────────────────
router.delete('/:id/members/:userId', authenticateToken, async (req: Request, res: Response) => {
  const context = await loadRequestUserContext(req)
  if (!context) return void res.status(401).json({ error: 'Authentication required' })
  if (!canManageGroups(context.role)) return void res.status(403).json({ error: 'Insufficient permissions' })

  const groupId = Number(req.params.id)
  const userId = Number(req.params.userId)
  const db = await getDbAsync()
  const existing = await db.queryOne<{ id: number; organization_id: number }>('SELECT * FROM groups WHERE id = ?', [groupId])

  if (!existing) return void res.status(404).json({ error: 'Group not found' })

  if (context.role !== 'super_admin' && existing.organization_id !== context.organizationId) {
    return void res.status(403).json({ error: 'Forbidden' })
  }

  await db.execute('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, userId])
  res.json({ success: true })
})

export default router
