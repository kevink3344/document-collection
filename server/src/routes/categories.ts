import { Router, type Request, type Response } from 'express'
import { getDbAsync } from '../database/db'
import { authenticateToken } from '../middleware/auth'

const router = Router()

interface DbCategory {
  id: number
  name: string
  sort_order: number
  organization_id: number | null
  organization_name?: string | null
}

interface CategoryBody {
  name?: string
  organizationId?: number
}

function requireAdministrator(req: Request, res: Response): boolean {
  if (req.user?.role !== 'administrator' && req.user?.role !== 'super_admin') {
    res.status(403).json({ error: 'Administrator access required' })
    return false
  }
  return true
}

function normalizeName(name: string | undefined): string {
  return (name ?? '').trim()
}

/** true if this admin has no org assigned — can manage all orgs */
function isGlobalAdmin(req: Request): boolean {
  return req.user?.role === 'super_admin'
}

function toResponse(row: DbCategory) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    organizationId: row.organization_id,
    organizationName: row.organization_name ?? null,
  }
}

/**
 * @swagger
 * /api/categories:
 *   get:
 *     summary: List categories (scoped to the caller's organization; global admins see all or filter by ?organizationId)
 *     tags: [Categories]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: organizationId
 *         schema:
 *           type: integer
 *         description: Filter by organization (global admin only)
 *     responses:
 *       200:
 *         description: Array of categories
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Category'
 *       401:
 *         description: Unauthorized
 */
router.get('/', authenticateToken, async (req: Request, res: Response) => {
  const db = await getDbAsync()
  const global = isGlobalAdmin(req)
  const userOrgId = req.user?.organizationId ?? null

  let orgFilter: number | null = null
  if (global) {
    const q = req.query.organizationId
    const parsed = q != null ? parseInt(q as string, 10) : NaN
    // If an explicit org is requested use it, otherwise default to the super_admin's own org
    orgFilter = Number.isFinite(parsed) ? parsed : userOrgId
  } else {
    orgFilter = userOrgId
  }

  let rows: DbCategory[]
  if (orgFilter !== null) {
    rows = await db.queryAll<DbCategory>(`
        SELECT c.id, c.name, c.sort_order, c.organization_id, o.name AS organization_name
        FROM categories c
        LEFT JOIN organizations o ON o.id = c.organization_id
        WHERE c.organization_id = ?
        ORDER BY c.sort_order, c.name COLLATE NOCASE
      `, [orgFilter])
  } else {
    rows = []
  }

  res.json(rows.map(toResponse))
})

/**
 * @swagger
 * /api/categories:
 *   post:
 *     summary: Create a new category (admin only)
 *     tags: [Categories]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Finance
 *               organizationId:
 *                 type: integer
 *                 description: Required for global admins; ignored for org-scoped admins
 *     responses:
 *       201:
 *         description: Category created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Administrator access required
 *       409:
 *         description: Category already exists in this organization
 */
router.post('/', authenticateToken, async (req: Request, res: Response) => {
  if (!requireAdministrator(req, res)) return

  const name = normalizeName((req.body as CategoryBody).name)
  if (!name) {
    res.status(400).json({ error: 'Category name is required' })
    return
  }

  const global = isGlobalAdmin(req)
  let targetOrgId: number | null = null

  if (global) {
    const bodyOrgId = (req.body as CategoryBody).organizationId
    if (!bodyOrgId || !Number.isInteger(bodyOrgId)) {
      res.status(400).json({ error: 'organizationId is required for global administrators' })
      return
    }
    targetOrgId = bodyOrgId
  } else {
    targetOrgId = req.user?.organizationId ?? null
    if (targetOrgId == null) {
      res.status(400).json({ error: 'Your account has no organization assigned' })
      return
    }
  }

  const db = await getDbAsync()
  const duplicate = await db.queryOne<{ id: number }>('SELECT id FROM categories WHERE lower(name) = lower(?) AND organization_id = ?', [name, targetOrgId])
  if (duplicate) {
    res.status(409).json({ error: 'Category already exists in this organization' })
    return
  }

  const nextSortOrderRow = await db.queryOne<{ n: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories WHERE organization_id = ?', [targetOrgId])
  const nextSortOrder = nextSortOrderRow?.n ?? 0

  const result = await db.execute('INSERT INTO categories (name, sort_order, organization_id) VALUES (?, ?, ?)', [name, nextSortOrder, targetOrgId])

  const orgNameRow = await db.queryOne<{ name: string }>('SELECT name FROM organizations WHERE id = ?', [targetOrgId])
  const orgName = orgNameRow?.name ?? null

  res.status(201).json({
    id: result.lastInsertRowid,
    name,
    sortOrder: nextSortOrder,
    organizationId: targetOrgId,
    organizationName: orgName,
  })
})

/**
 * @swagger
 * /api/categories/{id}:
 *   put:
 *     summary: Rename a category (admin only)
 *     description: Also updates the category field on collections within the same organization.
 *     tags: [Categories]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated category
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Administrator access required / not your organization's category
 *       404:
 *         description: Category not found
 *       409:
 *         description: Category name already in use
 */
router.put('/:id', authenticateToken, async (req: Request, res: Response) => {
  if (!requireAdministrator(req, res)) return

  const id = parseInt(req.params.id, 10)
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid category ID' })
    return
  }

  const name = normalizeName((req.body as CategoryBody).name)
  if (!name) {
    res.status(400).json({ error: 'Category name is required' })
    return
  }

  const db = await getDbAsync()
  const existing = await db.queryOne<DbCategory>('SELECT id, name, sort_order, organization_id FROM categories WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Category not found' })
    return
  }

  // Org-scoped admins can only edit their own org's categories
  if (!isGlobalAdmin(req) && existing.organization_id !== (req.user?.organizationId ?? null)) {
    res.status(403).json({ error: 'You can only edit your own organization\'s categories' })
    return
  }

  const duplicate = await db.queryOne<{ id: number }>('SELECT id FROM categories WHERE lower(name) = lower(?) AND organization_id = ? AND id <> ?', [name, existing.organization_id, id])
  if (duplicate) {
    res.status(409).json({ error: 'Category already exists in this organization' })
    return
  }

  await db.transaction(async (tx) => {
    await tx.execute('UPDATE categories SET name = ? WHERE id = ?', [name, id])
    // Only update collections within the same organization
    await tx.execute('UPDATE collections SET category = ? WHERE category = ? AND organization_id = ?',
      [name, existing.name, existing.organization_id])
  })

  const orgNameRow = existing.organization_id
    ? await db.queryOne<{ name: string }>('SELECT name FROM organizations WHERE id = ?', [existing.organization_id])
    : null
  const orgName = orgNameRow?.name ?? null

  res.json({ id, name, sortOrder: existing.sort_order, organizationId: existing.organization_id, organizationName: orgName })
})

/**
 * @swagger
 * /api/categories/{id}:
 *   delete:
 *     summary: Delete a category (admin only)
 *     description: Fails if any collections in this organization are using the category.
 *     tags: [Categories]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       204:
 *         description: Deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Administrator access required / not your organization's category
 *       404:
 *         description: Category not found
 *       409:
 *         description: Category is in use by one or more collections
 */
router.delete('/:id', authenticateToken, async (req: Request, res: Response) => {
  if (!requireAdministrator(req, res)) return

  const id = parseInt(req.params.id, 10)
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid category ID' })
    return
  }

  const db = await getDbAsync()
  const existing = await db.queryOne<{ id: number; name: string; organization_id: number | null }>('SELECT id, name, organization_id FROM categories WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Category not found' })
    return
  }

  // Org-scoped admins can only delete their own org's categories
  if (!isGlobalAdmin(req) && existing.organization_id !== (req.user?.organizationId ?? null)) {
    res.status(403).json({ error: 'You can only delete your own organization\'s categories' })
    return
  }

  const usage = await db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM collections WHERE category = ? AND organization_id = ?', [existing.name, existing.organization_id])
  if ((usage?.n ?? 0) > 0) {
    res.status(409).json({ error: 'Category is in use by one or more collections' })
    return
  }

  await db.execute('DELETE FROM categories WHERE id = ?', [id])
  res.status(204).send()
})

export default router