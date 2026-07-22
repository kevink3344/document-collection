import { Router, type Request, type Response } from 'express'
import { getDbAsync } from '../database/db'
import { authenticateToken } from '../middleware/auth'
import {
  isAdminOrSuperAdmin,
  loadRequestUserContext,
  resolveManagedOrganizationId,
} from '../middleware/organizationAccess'

const router = Router()

const MENU_LABEL_KEYS = ['dashboard', 'collections', 'records', 'reports', 'settings', 'tickets'] as const
type MenuLabelKey = typeof MENU_LABEL_KEYS[number]

const DEFAULT_MENU_LABELS: Record<MenuLabelKey, string> = {
  dashboard: 'Dashboard',
  collections: 'Collections',
  records: 'Records',
  reports: 'Reports',
  settings: 'Settings',
  tickets: 'Tickets',
}

const MENU_LABEL_MAX_LENGTH = 40

function mergeWithDefaults(labels: Partial<Record<MenuLabelKey, string>> | null | undefined): Record<MenuLabelKey, string> {
  const merged = { ...DEFAULT_MENU_LABELS }
  if (!labels || typeof labels !== 'object') return merged
  for (const key of MENU_LABEL_KEYS) {
    const value = labels[key]
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) merged[key] = trimmed
    }
  }
  return merged
}

function parseStoredLabels(raw: string | null | undefined): Partial<Record<MenuLabelKey, string>> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Partial<Record<MenuLabelKey, string>> = {}
    for (const key of MENU_LABEL_KEYS) {
      const value = (parsed as Record<string, unknown>)[key]
      if (typeof value === 'string' && value.trim()) {
        result[key] = value.trim()
      }
    }
    return result
  } catch {
    return {}
  }
}

function sanitizeIncomingLabels(input: unknown): { ok: true; labels: Partial<Record<MenuLabelKey, string>> } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'labels must be an object' }
  }

  const record = input as Record<string, unknown>
  const unknownKeys = Object.keys(record).filter(
    key => !(MENU_LABEL_KEYS as readonly string[]).includes(key),
  )
  if (unknownKeys.length > 0) {
    return { ok: false, error: `Unknown label keys: ${unknownKeys.join(', ')}` }
  }

  const labels: Partial<Record<MenuLabelKey, string>> = {}
  for (const key of MENU_LABEL_KEYS) {
    if (!(key in record)) continue
    const value = record[key]
    if (value === null || value === undefined) continue
    if (typeof value !== 'string') {
      return { ok: false, error: `Label for "${key}" must be a string` }
    }
    const trimmed = value.trim()
    if (!trimmed) continue
    if (trimmed.length > MENU_LABEL_MAX_LENGTH) {
      return { ok: false, error: `Label for "${key}" must be ${MENU_LABEL_MAX_LENGTH} characters or fewer` }
    }
    labels[key] = trimmed
  }

  return { ok: true, labels }
}


interface DbOrganization {
  id: number
  name: string
  slug: string | null
  description: string | null
  is_active: number
  created_at: string
  updated_at: string
  user_count?: number
  collection_count?: number
}

function toApiOrganization(row: DbOrganization) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    userCount: row.user_count ?? 0,
    collectionCount: row.collection_count ?? 0,
  }
}

function requireAdministrator(req: Request, res: Response): boolean {
  if (req.user?.role !== 'super_admin') {
    res.status(403).json({ error: 'Super admin access required' })
    return false
  }

  return true
}

router.get('/', authenticateToken, async (req: Request, res: Response) => {
  const role = req.user?.role
  if (role !== 'super_admin' && role !== 'administrator') {
    res.status(403).json({ error: 'Administrator access required' })
    return
  }

  const db = await getDbAsync()

  if (role === 'administrator') {
    // Return only the orgs the administrator belongs to
    const rows = await db.queryAll<DbOrganization>(
        `SELECT o.*,
                (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id) AS user_count,
                (SELECT COUNT(*) FROM collections c WHERE c.organization_id = o.id) AS collection_count
         FROM organizations o
         JOIN user_organizations uo ON uo.organization_id = o.id AND uo.user_id = ?
         ORDER BY lower(o.name) ASC`,
        [req.user!.sub]
      )
    res.json(rows.map(toApiOrganization))
    return
  }

  const rows = await db.queryAll<DbOrganization>(
      `SELECT o.*, 
              (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id) AS user_count,
              (SELECT COUNT(*) FROM collections c WHERE c.organization_id = o.id) AS collection_count
       FROM organizations o
       ORDER BY lower(o.name) ASC`
    )

  res.json(rows.map(toApiOrganization))
})

router.get('/:id', authenticateToken, async (req: Request, res: Response) => {
  if (!requireAdministrator(req, res)) {
    return
  }

  const id = parseInt(req.params.id, 10)
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid organization ID' })
    return
  }

  const db = await getDbAsync()
  const row = await db.queryOne<DbOrganization>(
      `SELECT o.*, 
              (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id) AS user_count,
              (SELECT COUNT(*) FROM collections c WHERE c.organization_id = o.id) AS collection_count
       FROM organizations o
       WHERE o.id = ?`,
      [id]
    )

  if (!row) {
    res.status(404).json({ error: 'Organization not found' })
    return
  }

  res.json(toApiOrganization(row))
})

router.post('/', authenticateToken, async (req: Request, res: Response) => {
  if (!requireAdministrator(req, res)) {
    return
  }

  const body = req.body as {
    name?: unknown
    slug?: unknown
    description?: unknown
    isActive?: unknown
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const slug = typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : null
  const description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null
  const isActive = body.isActive === false ? 0 : 1

  const db = await getDbAsync()

  const duplicate = await db.queryOne<{ id: number }>('SELECT id FROM organizations WHERE lower(name) = lower(?)', [name])
  if (duplicate) {
    res.status(409).json({ error: 'Organization name already exists' })
    return
  }

  if (slug) {
    const slugDuplicate = await db.queryOne<{ id: number }>('SELECT id FROM organizations WHERE slug = ?', [slug])
    if (slugDuplicate) {
      res.status(409).json({ error: 'Organization slug already exists' })
      return
    }
  }

  const inserted = await db.execute(
      `INSERT INTO organizations (name, slug, description, is_active)
       VALUES (?, ?, ?, ?)`,
      [name, slug, description, isActive]
    )

  const created = await db.queryOne<DbOrganization>('SELECT * FROM organizations WHERE id = ?', [Number(inserted.lastInsertRowid)])
  if (!created) {
    res.status(500).json({ error: 'Failed to load created organization' })
    return
  }

  res.status(201).json(toApiOrganization(created))
})

router.patch('/:id', authenticateToken, async (req: Request, res: Response) => {
  if (!requireAdministrator(req, res)) {
    return
  }

  const id = parseInt(req.params.id, 10)
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid organization ID' })
    return
  }

  const body = req.body as {
    name?: unknown
    slug?: unknown
    description?: unknown
    isActive?: unknown
  }

  const db = await getDbAsync()
  const existing = await db.queryOne<DbOrganization>('SELECT * FROM organizations WHERE id = ?', [id])

  if (!existing) {
    res.status(404).json({ error: 'Organization not found' })
    return
  }

  const name = typeof body.name === 'string' ? body.name.trim() : existing.name
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const slug = typeof body.slug === 'string'
    ? (body.slug.trim() || null)
    : existing.slug
  const description = typeof body.description === 'string'
    ? (body.description.trim() || null)
    : existing.description
  const isActive = typeof body.isActive === 'boolean'
    ? (body.isActive ? 1 : 0)
    : existing.is_active

  const duplicate = await db.queryOne<{ id: number }>('SELECT id FROM organizations WHERE lower(name) = lower(?) AND id != ?', [name, id])
  if (duplicate) {
    res.status(409).json({ error: 'Organization name already exists' })
    return
  }

  if (slug) {
    const slugDuplicate = await db.queryOne<{ id: number }>('SELECT id FROM organizations WHERE slug = ? AND id != ?', [slug, id])
    if (slugDuplicate) {
      res.status(409).json({ error: 'Organization slug already exists' })
      return
    }
  }

  await db.execute(
    `UPDATE organizations
     SET name = ?, slug = ?, description = ?, is_active = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [name, slug, description, isActive, id]
  )

  const updated = await db.queryOne<DbOrganization>('SELECT * FROM organizations WHERE id = ?', [id])
  if (!updated) {
    res.status(500).json({ error: 'Failed to load updated organization' })
    return
  }

  res.json(toApiOrganization(updated))
})

router.delete('/:id', authenticateToken, async (req: Request, res: Response) => {
  if (!requireAdministrator(req, res)) {
    return
  }

  const body = req.body as { confirmationText?: unknown }
  const confirmationText = typeof body.confirmationText === 'string' ? body.confirmationText.trim() : ''
  if (confirmationText !== 'DELETE') {
    res.status(400).json({ error: 'Type DELETE to confirm organization removal' })
    return
  }

  const id = parseInt(req.params.id, 10)
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid organization ID' })
    return
  }

  const db = await getDbAsync()
  const existing = await db.queryOne<{ id: number }>('SELECT id FROM organizations WHERE id = ?', [id])

  if (!existing) {
    res.status(404).json({ error: 'Organization not found' })
    return
  }

  const userRef = await db.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM users WHERE organization_id = ?', [id])
  const collectionRef = await db.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM collections WHERE organization_id = ?', [id])

  const categoryRef = await db.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM categories WHERE organization_id = ?', [id])

  if ((userRef?.count ?? 0) > 0 || (collectionRef?.count ?? 0) > 0) {
    res.status(409).json({ error: 'Organization cannot be deleted while users or collections are assigned to it' })
    return
  }

  try {
    await db.transaction(async (tx) => {
      if ((categoryRef?.count ?? 0) > 0) {
        await tx.execute('DELETE FROM categories WHERE organization_id = ?', [id])
      }
      await tx.execute('DELETE FROM organizations WHERE id = ?', [id])
    })
    res.status(204).end()
  } catch (err) {
    console.error('[organizations] delete:', err)
    res.status(500).json({ error: 'Failed to delete organization' })
  }
})

// ── Menu Labels ──────────────────────────────────────────────────────────────

router.get('/:id/menu-labels', authenticateToken, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10)
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid organization ID' })
    return
  }

  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const db = await getDbAsync()

  const org = await db.queryOne<{ id: number }>('SELECT id FROM organizations WHERE id = ?', [id])
  if (!org) {
    res.status(404).json({ error: 'Organization not found' })
    return
  }

  // super_admin can read any org; everyone else must be a member of the org
  if (context.role !== 'super_admin') {
    const membership = await db.queryOne<{ user_id: number }>(
      'SELECT user_id FROM user_organizations WHERE user_id = ? AND organization_id = ?',
      [context.id, id],
    )
    if (!membership) {
      res.status(403).json({ error: 'Access denied' })
      return
    }
  }

  const row = await db.queryOne<{ labels: string }>(
    'SELECT labels FROM organization_menu_labels WHERE organization_id = ?',
    [id],
  )

  res.json({
    organizationId: id,
    labels: mergeWithDefaults(parseStoredLabels(row?.labels)),
  })
})

router.put('/:id/menu-labels', authenticateToken, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10)
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid organization ID' })
    return
  }

  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  if (!isAdminOrSuperAdmin(context)) {
    res.status(403).json({ error: 'Administrator access required' })
    return
  }

  // Administrators may only edit their active org; super_admin may edit any
  const managedId = resolveManagedOrganizationId(context, id)
  if (managedId == null || managedId !== id) {
    res.status(403).json({ error: 'Access denied for this organization' })
    return
  }

  const body = req.body as { labels?: unknown }
  const sanitized = sanitizeIncomingLabels(body.labels)
  if (!sanitized.ok) {
    res.status(400).json({ error: sanitized.error })
    return
  }

  const db = await getDbAsync()

  const org = await db.queryOne<{ id: number }>('SELECT id FROM organizations WHERE id = ?', [id])
  if (!org) {
    res.status(404).json({ error: 'Organization not found' })
    return
  }

  const labelsJson = JSON.stringify(sanitized.labels)

  await db.execute(
    `INSERT INTO organization_menu_labels (organization_id, labels, updated_by_user_id, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(organization_id) DO UPDATE SET
       labels = excluded.labels,
       updated_by_user_id = excluded.updated_by_user_id,
       updated_at = datetime('now')`,
    [id, labelsJson, context.id],
  )

  res.json({
    organizationId: id,
    labels: mergeWithDefaults(sanitized.labels),
  })
})

export default router


