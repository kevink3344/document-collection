import { Router, type Request, type Response } from 'express'
import { getDb } from '../database/db'
import { authenticateToken } from '../middleware/auth'

const router = Router()

interface DbCategory {
  id: number
  name: string
  sort_order: number
}

interface CategoryBody {
  name?: string
}

function requireAdministrator(req: Request, res: Response): boolean {
  if (req.user?.role !== 'administrator') {
    res.status(403).json({ error: 'Administrator access required' })
    return false
  }
  return true
}

function normalizeName(name: string | undefined): string {
  return (name ?? '').trim()
}

function listCategories() {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, name, sort_order FROM categories ORDER BY sort_order, name COLLATE NOCASE')
    .all() as unknown as DbCategory[]

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
  }))
}

router.get('/', authenticateToken, (_req: Request, res: Response) => {
  res.json(listCategories())
})

router.post('/', authenticateToken, (req: Request, res: Response) => {
  if (!requireAdministrator(req, res)) return

  const name = normalizeName((req.body as CategoryBody).name)
  if (!name) {
    res.status(400).json({ error: 'Category name is required' })
    return
  }

  const db = getDb()
  const duplicate = db
    .prepare('SELECT id FROM categories WHERE lower(name) = lower(?)')
    .get(name) as unknown as { id: number } | undefined
  if (duplicate) {
    res.status(409).json({ error: 'Category already exists' })
    return
  }

  const nextSortOrder = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextSortOrder FROM categories')
    .get() as unknown as { nextSortOrder: number }

  const result = db
    .prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)')
    .run(name, nextSortOrder.nextSortOrder)

  res.status(201).json({
    id: result.lastInsertRowid,
    name,
    sortOrder: nextSortOrder.nextSortOrder,
  })
})

router.put('/:id', authenticateToken, (req: Request, res: Response) => {
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

  const db = getDb()
  const existing = db
    .prepare('SELECT id, name, sort_order FROM categories WHERE id = ?')
    .get(id) as unknown as DbCategory | undefined
  if (!existing) {
    res.status(404).json({ error: 'Category not found' })
    return
  }

  const duplicate = db
    .prepare('SELECT id FROM categories WHERE lower(name) = lower(?) AND id <> ?')
    .get(name, id) as unknown as { id: number } | undefined
  if (duplicate) {
    res.status(409).json({ error: 'Category already exists' })
    return
  }

  db.exec('BEGIN')
  try {
    db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id)
    db.prepare('UPDATE collections SET category = ? WHERE category = ?').run(name, existing.name)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  res.json({ id, name, sortOrder: existing.sort_order })
})

router.delete('/:id', authenticateToken, (req: Request, res: Response) => {
  if (!requireAdministrator(req, res)) return

  const id = parseInt(req.params.id, 10)
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid category ID' })
    return
  }

  const db = getDb()
  const existing = db
    .prepare('SELECT id, name FROM categories WHERE id = ?')
    .get(id) as unknown as { id: number; name: string } | undefined
  if (!existing) {
    res.status(404).json({ error: 'Category not found' })
    return
  }

  const usage = db
    .prepare('SELECT COUNT(*) AS n FROM collections WHERE category = ?')
    .get(existing.name) as unknown as { n: number }
  if (usage.n > 0) {
    res.status(409).json({ error: 'Category is in use by one or more collections' })
    return
  }

  db.prepare('DELETE FROM categories WHERE id = ?').run(id)
  res.status(204).send()
})

export default router