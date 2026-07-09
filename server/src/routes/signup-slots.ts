import { Router, type Request, type Response } from 'express'
import { getDbAsync } from '../database/db'
import { authenticateToken, optionalAuthenticateToken } from '../middleware/auth'
import { loadRequestUserContext } from '../middleware/organizationAccess'

const router = Router()

// ── DB row types ──────────────────────────────────────────────

interface DbSignupSlot {
  id: number
  collection_id: number
  slot_date: string
  start_time: string
  end_time: string
  label: string
  max_capacity: number
  sort_order: number
  created_at: string
  filled_count?: number
}

interface DbSignupRegistration {
  id: number
  slot_id: number
  respondent_name: string
  respondent_email: string
  note: string | null
  created_at: string
}

interface SlotBody {
  slotDate: string
  startTime: string
  endTime: string
  label?: string
  maxCapacity?: number
  sortOrder?: number
}

interface RegisterBody {
  respondentName: string
  respondentEmail: string
  note?: string
}

function toApiSlot(row: DbSignupSlot) {
  return {
    id: row.id,
    collectionId: row.collection_id,
    slotDate: row.slot_date,
    startTime: row.start_time,
    endTime: row.end_time,
    label: row.label,
    maxCapacity: row.max_capacity,
    sortOrder: row.sort_order,
    filledCount: row.filled_count ?? 0,
    createdAt: row.created_at,
  }
}

function validateSlotBody(body: SlotBody): string | null {
  if (!body.slotDate?.trim()) return 'slotDate is required'
  if (!body.startTime?.trim()) return 'startTime is required'
  if (!body.endTime?.trim()) return 'endTime is required'
  const cap = body.maxCapacity !== undefined ? Number(body.maxCapacity) : 1
  if (!Number.isInteger(cap) || cap < 1 || cap > 999) {
    return 'maxCapacity must be an integer between 1 and 999'
  }
  return null
}

async function getCollectionBySlug(slug: string) {
  const db = await getDbAsync()
  return db.queryOne<{ id: number; collection_type: string; status: string; organization_id: number }>('SELECT id, collection_type, status, organization_id FROM collections WHERE slug = ?', [slug])
}

async function getSlotsWithCounts(collectionId: number): Promise<DbSignupSlot[]> {
  const db = await getDbAsync()
  return db.queryAll<DbSignupSlot>(`
      SELECT s.*,
             (SELECT COUNT(*) FROM signup_registrations r WHERE r.slot_id = s.id) AS filled_count
      FROM signup_slots s
      WHERE s.collection_id = ?
      ORDER BY s.slot_date, s.start_time, s.sort_order, s.id
    `, [collectionId])
}

// ── Authenticated routes (creator/admin managing slots) ───────

// GET /api/signup-slots/collections/:id/slots
router.get('/collections/:id/slots', authenticateToken, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid collection ID' })
    return
  }
  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }
  const db = await getDbAsync()
  const col = await db.queryOne<{ id: number; collection_type: string; organization_id: number }>('SELECT id, collection_type, organization_id FROM collections WHERE id = ?', [id])
  if (!col) {
    res.status(404).json({ error: 'Collection not found' })
    return
  }
  const slots = await getSlotsWithCounts(id)
  res.json(slots.map(toApiSlot))
})

// POST /api/signup-slots/collections/:id/slots
router.post('/collections/:id/slots', authenticateToken, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid collection ID' })
    return
  }
  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const body = req.body as SlotBody
  const validationError = validateSlotBody(body)
  if (validationError) {
    res.status(400).json({ error: validationError })
    return
  }

  const db = await getDbAsync()
  const col = await db.queryOne<{ id: number; collection_type: string }>('SELECT id, collection_type FROM collections WHERE id = ?', [id])
  if (!col) {
    res.status(404).json({ error: 'Collection not found' })
    return
  }
  if (col.collection_type !== 'signup_sheet') {
    res.status(400).json({ error: 'Collection is not a sign-up sheet' })
    return
  }

  const maxSortOrderRow = await db.queryOne<{ m: number }>('SELECT COALESCE(MAX(sort_order), -1) AS m FROM signup_slots WHERE collection_id = ?', [id])
  const sortOrder = body.sortOrder !== undefined ? Number(body.sortOrder) : (maxSortOrderRow?.m ?? -1) + 1

  const r = await db.execute(`INSERT INTO signup_slots (collection_id, slot_date, start_time, end_time, label, max_capacity, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, body.slotDate.trim(), body.startTime.trim(), body.endTime.trim(), body.label?.trim() || 'Available Slot', Number(body.maxCapacity ?? 1), sortOrder])

  const row = await db.queryOne<DbSignupSlot>(`
    SELECT s.*, (SELECT COUNT(*) FROM signup_registrations r WHERE r.slot_id = s.id) AS filled_count
    FROM signup_slots s WHERE s.id = ?
  `, [r.lastInsertRowid])

  if (!row) {
    res.status(500).json({ error: 'Failed to load created slot' })
    return
  }

  res.status(201).json(toApiSlot(row))
})

// PUT /api/signup-slots/collections/:id/slots/:slotId
router.put('/collections/:id/slots/:slotId', authenticateToken, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10)
  const slotId = parseInt(req.params.slotId, 10)
  if (isNaN(id) || isNaN(slotId)) {
    res.status(400).json({ error: 'Invalid ID' })
    return
  }
  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const body = req.body as SlotBody
  const validationError = validateSlotBody(body)
  if (validationError) {
    res.status(400).json({ error: validationError })
    return
  }

  const db = await getDbAsync()
  const slot = await db.queryOne<{ id: number; collection_id: number }>('SELECT id, collection_id FROM signup_slots WHERE id = ? AND collection_id = ?', [slotId, id])
  if (!slot) {
    res.status(404).json({ error: 'Slot not found' })
    return
  }

  const sortOrder = body.sortOrder !== undefined ? Number(body.sortOrder) : undefined
  if (sortOrder !== undefined) {
    await db.execute(`UPDATE signup_slots SET slot_date = ?, start_time = ?, end_time = ?, label = ?, max_capacity = ?, sort_order = ? WHERE id = ?`,
      [body.slotDate.trim(), body.startTime.trim(), body.endTime.trim(), body.label?.trim() || 'Available Slot', Number(body.maxCapacity ?? 1), sortOrder, slotId])
  } else {
    await db.execute(`UPDATE signup_slots SET slot_date = ?, start_time = ?, end_time = ?, label = ?, max_capacity = ? WHERE id = ?`,
      [body.slotDate.trim(), body.startTime.trim(), body.endTime.trim(), body.label?.trim() || 'Available Slot', Number(body.maxCapacity ?? 1), slotId])
  }

  const row = await db.queryOne<DbSignupSlot>(`
    SELECT s.*, (SELECT COUNT(*) FROM signup_registrations r WHERE r.slot_id = s.id) AS filled_count
    FROM signup_slots s WHERE s.id = ?
  `, [slotId])

  if (!row) {
    res.status(500).json({ error: 'Failed to load updated slot' })
    return
  }

  res.json(toApiSlot(row))
})

// DELETE /api/signup-slots/collections/:id/slots/:slotId
router.delete('/collections/:id/slots/:slotId', authenticateToken, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10)
  const slotId = parseInt(req.params.slotId, 10)
  if (isNaN(id) || isNaN(slotId)) {
    res.status(400).json({ error: 'Invalid ID' })
    return
  }
  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const db = await getDbAsync()
  const result = await db.execute('DELETE FROM signup_slots WHERE id = ? AND collection_id = ?', [slotId, id])
  if (!result.changes) {
    res.status(404).json({ error: 'Slot not found' })
    return
  }
  res.status(204).send()
})

// GET /api/signup-slots/collections/:id/slots/:slotId/registrations  (admin)
router.get('/collections/:id/slots/:slotId/registrations', authenticateToken, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10)
  const slotId = parseInt(req.params.slotId, 10)
  if (isNaN(id) || isNaN(slotId)) {
    res.status(400).json({ error: 'Invalid ID' })
    return
  }
  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }
  const db = await getDbAsync()
  const slot2 = await db.queryOne<{ id: number }>('SELECT id FROM signup_slots WHERE id = ? AND collection_id = ?', [slotId, id])
  if (!slot2) {
    res.status(404).json({ error: 'Slot not found' })
    return
  }
  const rows = await db.queryAll<DbSignupRegistration>('SELECT * FROM signup_registrations WHERE slot_id = ? ORDER BY created_at', [slotId])
  res.json(rows.map(r => ({
    id: r.id,
    slotId: r.slot_id,
    respondentName: r.respondent_name,
    respondentEmail: r.respondent_email,
    note: r.note,
    createdAt: r.created_at,
  })))
})

// ── Public routes ─────────────────────────────────────────────

// GET /api/signup-slots/public/:slug/slots
router.get('/public/:slug/slots', optionalAuthenticateToken, async (req: Request, res: Response) => {
  const col = await getCollectionBySlug(req.params.slug)
  if (!col || col.collection_type !== 'signup_sheet') {
    res.status(404).json({ error: 'Sign-up sheet not found' })
    return
  }
  if (col.status !== 'published') {
    // Allow preview with auth
    if (!req.user) {
      res.status(404).json({ error: 'Sign-up sheet not found' })
      return
    }
  }
  const slots = await getSlotsWithCounts(col.id)
  res.json(slots.map(toApiSlot))
})

// GET /api/signup-slots/public/:slug
router.get('/public/:slug', optionalAuthenticateToken, async (req: Request, res: Response) => {
  const col = await getCollectionBySlug(req.params.slug)
  if (!col || col.collection_type !== 'signup_sheet') {
    res.status(404).json({ error: 'Sign-up sheet not found' })
    return
  }
  if (col.status !== 'published' && !req.user) {
    res.status(404).json({ error: 'Sign-up sheet not found' })
    return
  }
  const db = await getDbAsync()
  const row = await db.queryOne<Record<string, unknown>>('SELECT c.*, u.name AS creator_name, o.name AS organization_name FROM collections c LEFT JOIN users u ON u.id = c.created_by LEFT JOIN organizations o ON o.id = c.organization_id WHERE c.id = ?', [col.id])
  if (!row) {
    res.status(404).json({ error: 'Sign-up sheet not found' })
    return
  }
  res.json({
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description ?? null,
    status: row.status,
    collectionType: row.collection_type ?? 'signup_sheet',
    organizationName: row.organization_name ?? null,
    instructions: row.instructions ?? null,
    logoUrl: row.logo_url ?? null,
    coverPhotoUrl: row.cover_photo_url ?? null,
  })
})

// POST /api/signup-slots/public/:slug/slots/:slotId/register
router.post('/public/:slug/slots/:slotId/register', async (req: Request, res: Response) => {
  const slotId = parseInt(req.params.slotId, 10)
  if (isNaN(slotId)) {
    res.status(400).json({ error: 'Invalid slot ID' })
    return
  }

  const col2 = await getCollectionBySlug(req.params.slug)
  if (!col2 || col2.collection_type !== 'signup_sheet' || col2.status !== 'published') {
    res.status(404).json({ error: 'Sign-up sheet not found' })
    return
  }

  const body = req.body as RegisterBody
  if (!body.respondentName?.trim()) {
    res.status(400).json({ error: 'respondentName is required' })
    return
  }
  if (!body.respondentEmail?.trim()) {
    res.status(400).json({ error: 'respondentEmail is required' })
    return
  }
  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.respondentEmail.trim())) {
    res.status(400).json({ error: 'respondentEmail is not a valid email address' })
    return
  }

  const db = await getDbAsync()
  const slot = await db.queryOne<{ id: number; collection_id: number; max_capacity: number }>(
    'SELECT id, collection_id, max_capacity FROM signup_slots WHERE id = ? AND collection_id = ?',
    [slotId, col2.id]
  )

  if (!slot) {
    res.status(404).json({ error: 'Slot not found' })
    return
  }

  // Enforce capacity
  const capacityRow = await db.queryOne<{ filled_count: number }>('SELECT COUNT(*) AS filled_count FROM signup_registrations WHERE slot_id = ?', [slotId])
  const filled_count = capacityRow?.filled_count ?? 0

  if (filled_count >= slot.max_capacity) {
    res.status(409).json({ error: 'This slot is full' })
    return
  }

  const r = await db.execute(
    'INSERT INTO signup_registrations (slot_id, respondent_name, respondent_email, note) VALUES (?, ?, ?, ?)',
    [slotId, body.respondentName.trim(), body.respondentEmail.trim().toLowerCase(), body.note?.trim() ?? null]
  )

  res.status(201).json({
    id: r.lastInsertRowid,
    slotId,
    respondentName: body.respondentName.trim(),
    respondentEmail: body.respondentEmail.trim().toLowerCase(),
    note: body.note?.trim() ?? null,
  })
})

export default router
