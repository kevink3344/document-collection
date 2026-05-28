import { Router, type Request, type Response } from 'express'
import { getDb } from '../database/db'
import { authenticateToken } from '../middleware/auth'
import { loadRequestUserContext } from '../middleware/organizationAccess'

const router = Router()

interface DbLocation {
  id: number
  name: string
  organization_id: number
  created_at: string
}

// ── GET /api/locations — list / typeahead search (public) ────
router.get('/', (req: Request, res: Response) => {
  const db = getDb()
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''

  // If authenticated, scope to the caller's organization; otherwise return all.
  const context = loadRequestUserContext(req)
  const orgId = context?.organizationId ?? null

  let rows: DbLocation[]
  if (orgId !== null) {
    rows = q
      ? db
          .prepare(
            `SELECT id, name, organization_id, created_at
             FROM locations
             WHERE organization_id = ? AND lower(name) LIKE lower(?)
             ORDER BY lower(name)
             LIMIT 20`
          )
          .all(orgId, `%${q}%`) as unknown as DbLocation[]
      : db
          .prepare(
            `SELECT id, name, organization_id, created_at
             FROM locations
             WHERE organization_id = ?
             ORDER BY lower(name)`
          )
          .all(orgId) as unknown as DbLocation[]
  } else {
    rows = q
      ? db
          .prepare(
            `SELECT id, name, organization_id, created_at
             FROM locations
             WHERE lower(name) LIKE lower(?)
             ORDER BY lower(name)
             LIMIT 20`
          )
          .all(`%${q}%`) as unknown as DbLocation[]
      : db
          .prepare(
            `SELECT id, name, organization_id, created_at
             FROM locations
             ORDER BY lower(name)`
          )
          .all() as unknown as DbLocation[]
  }

  res.json(
    rows.map(l => ({
      id: l.id,
      name: l.name,
      organizationId: l.organization_id,
      createdAt: l.created_at,
    }))
  )
})

// ── POST /api/locations — create (admin+) ────────────────────
router.post('/', authenticateToken, (req: Request, res: Response) => {
  const context = loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  if (context.role !== 'administrator' && context.role !== 'super_admin') {
    res.status(403).json({ error: 'Administrator access required' })
    return
  }

  const { name } = req.body as { name?: unknown }
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const db = getDb()

  try {
    const r = db
      .prepare(
        `INSERT INTO locations (name, organization_id)
         VALUES (?, ?)`
      )
      .run(name.trim(), context.organizationId)

    const location = db
      .prepare('SELECT id, name, organization_id, created_at FROM locations WHERE id = ?')
      .get(r.lastInsertRowid) as unknown as DbLocation

    res.status(201).json({
      id: location.id,
      name: location.name,
      organizationId: location.organization_id,
      createdAt: location.created_at,
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).message?.includes('UNIQUE')) {
      res.status(409).json({ error: 'A location with this name already exists in the organization' })
    } else {
      console.error('[locations] create:', err)
      res.status(500).json({ error: 'Failed to create location' })
    }
  }
})

// ── PATCH /api/locations/:id — rename (admin+) ───────────────
router.patch('/:id', authenticateToken, (req: Request, res: Response) => {
  const context = loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  if (context.role !== 'administrator' && context.role !== 'super_admin') {
    res.status(403).json({ error: 'Administrator access required' })
    return
  }

  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid location ID' })
    return
  }

  const { name } = req.body as { name?: unknown }
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const db = getDb()
  const existing = db
    .prepare('SELECT id, organization_id FROM locations WHERE id = ?')
    .get(id) as unknown as { id: number; organization_id: number } | undefined

  if (!existing) {
    res.status(404).json({ error: 'Location not found' })
    return
  }

  if (context.role === 'administrator' && existing.organization_id !== context.organizationId) {
    res.status(403).json({ error: 'You can only update locations within your own organization' })
    return
  }

  try {
    db.prepare('UPDATE locations SET name = ? WHERE id = ?').run(name.trim(), id)
    const updated = db
      .prepare('SELECT id, name, organization_id, created_at FROM locations WHERE id = ?')
      .get(id) as unknown as DbLocation
    res.json({
      id: updated.id,
      name: updated.name,
      organizationId: updated.organization_id,
      createdAt: updated.created_at,
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).message?.includes('UNIQUE')) {
      res.status(409).json({ error: 'A location with this name already exists in the organization' })
    } else {
      console.error('[locations] update:', err)
      res.status(500).json({ error: 'Failed to update location' })
    }
  }
})

// ── DELETE /api/locations/:id — delete (admin+) ──────────────
router.delete('/:id', authenticateToken, (req: Request, res: Response) => {
  const context = loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  if (context.role !== 'administrator' && context.role !== 'super_admin') {
    res.status(403).json({ error: 'Administrator access required' })
    return
  }

  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid location ID' })
    return
  }

  const db = getDb()
  const location = db
    .prepare('SELECT id, organization_id FROM locations WHERE id = ?')
    .get(id) as unknown as { id: number; organization_id: number } | undefined

  if (!location) {
    res.status(404).json({ error: 'Location not found' })
    return
  }

  // org-scoped admins can only delete their own org's locations
  if (context.role === 'administrator' && location.organization_id !== context.organizationId) {
    res.status(403).json({ error: 'You can only delete locations within your own organization' })
    return
  }

  db.prepare('DELETE FROM locations WHERE id = ?').run(id)
  res.status(204).end()
})

export default router
