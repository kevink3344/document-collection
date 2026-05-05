import { Router, type Request, type Response } from 'express'
import crypto from 'crypto'
import { getDb } from '../database/db'
import { authenticateToken } from '../middleware/auth'

const router = Router()

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function generateUniqueSlug(db: ReturnType<typeof getDb>, title: string): string {
  const base = slugifyTitle(title) || 'collection'
  for (let i = 0; i < 20; i++) {
    const suffix = crypto.randomUUID().slice(0, 8)
    const candidate = `${base}-${suffix}`
    const exists = db
      .prepare('SELECT 1 FROM collections WHERE slug = ? LIMIT 1')
      .get(candidate) as unknown as { 1: number } | undefined
    if (!exists) return candidate
  }
  return `${base}-${crypto.randomUUID()}`
}

// ── DB row types ──────────────────────────────────────────────

type FieldType =
  | 'short_text' | 'long_text' | 'single_choice' | 'multiple_choice'
  | 'attachment' | 'signature' | 'confirmation' | 'custom_table'

type ColType = 'text' | 'number' | 'date' | 'checkbox'

interface DbCollection {
  id: number
  slug: string
  title: string
  description: string | null
  category: string | null
  created_by: number
  date_due: string | null
  cover_photo_url: string | null
  instructions: string | null
  instructions_doc_url: string | null
  anonymous: number
  created_at: string
  updated_at: string
  creator_name?: string
}

interface DbField {
  id: number
  collection_id: number
  type: FieldType
  label: string
  page_number: number
  required: number
  options: string | null
  sort_order: number
}

interface DbTableColumn {
  id: number
  field_id: number
  name: string
  col_type: ColType
  sort_order: number
}

interface DbResponse {
  id: number
  collection_id: number
  respondent_name: string | null
  respondent_email: string | null
  submitted_at: string
}

interface DbResponseValue {
  id: number
  response_id: number
  field_id: number
  value: string | null
}

// ── Request body types ────────────────────────────────────────

interface TableColumnInput {
  name: string
  colType: ColType
  sortOrder?: number
}

interface FieldInput {
  type: FieldType
  label: string
  page?: number
  required?: boolean
  options?: string[]
  tableColumns?: TableColumnInput[]
  sortOrder?: number
}

interface CollectionBody {
  title: string
  description?: string
  category?: string
  dateDue?: string
  coverPhotoUrl?: string
  instructions?: string
  instructionsDocUrl?: string
  anonymous?: boolean
  fields?: FieldInput[]
}

// ── Serialisers ───────────────────────────────────────────────

function toApiCollection(
  c: DbCollection,
  fields: DbField[],
  colsByField: Map<number, DbTableColumn[]>
) {
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    description: c.description,
    category: c.category,
    createdBy: c.created_by,
    createdByName: c.creator_name ?? null,
    dateDue: c.date_due,
    coverPhotoUrl: c.cover_photo_url,
    instructions: c.instructions,
    instructionsDocUrl: c.instructions_doc_url,
    anonymous: c.anonymous === 1,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    fields: fields.map(f => ({
      id: f.id,
      type: f.type,
      label: f.label,
      page: Number(f.page_number) || 1,
      required: f.required === 1,
      options: f.options ? (JSON.parse(f.options) as string[]) : null,
      sortOrder: f.sort_order,
      tableColumns:
        f.type === 'custom_table'
          ? (colsByField.get(f.id) ?? []).map(col => ({
              id: col.id,
              name: col.name,
              colType: col.col_type,
              sortOrder: col.sort_order,
            }))
          : null,
    })),
  }
}

// ── Helpers ───────────────────────────────────────────────────

function fetchFields(
  collectionId: number
): [DbField[], Map<number, DbTableColumn[]>] {
  const db = getDb()
  const fields = db
    .prepare(
      'SELECT * FROM collection_fields WHERE collection_id = ? ORDER BY page_number, sort_order'
    )
    .all(collectionId) as unknown as DbField[]

  const colsByField = new Map<number, DbTableColumn[]>()
  if (fields.length > 0) {
    const ids = fields.map(f => f.id)
    const ph = ids.map(() => '?').join(',')
    const cols = db
      .prepare(
        `SELECT * FROM collection_table_columns WHERE field_id IN (${ph}) ORDER BY sort_order`
      )
      .all(...ids) as unknown as DbTableColumn[]
    for (const col of cols) {
      const arr = colsByField.get(col.field_id) ?? []
      arr.push(col)
      colsByField.set(col.field_id, arr)
    }
  }
  return [fields, colsByField]
}

function insertFields(collectionId: number, fields: FieldInput[]): void {
  const db = getDb()
  fields.forEach((field, idx) => {
    const r = db
      .prepare(
        `INSERT INTO collection_fields
           (collection_id, type, label, page_number, required, options, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        collectionId,
        field.type,
        field.label,
        Math.max(1, Math.floor(field.page ?? 1)),
        field.required ? 1 : 0,
        field.options?.length ? JSON.stringify(field.options) : null,
        field.sortOrder ?? idx
      )
    if (field.type === 'custom_table' && field.tableColumns?.length) {
      const fieldId = r.lastInsertRowid as number
      field.tableColumns.forEach((col, ci) => {
        db.prepare(
          `INSERT INTO collection_table_columns (field_id, name, col_type, sort_order)
           VALUES (?, ?, ?, ?)`
        ).run(fieldId, col.name, col.colType, col.sortOrder ?? ci)
      })
    }
  })
}

const COL_SELECT = `
  SELECT c.*, u.name AS creator_name
  FROM collections c
  LEFT JOIN users u ON u.id = c.created_by
`

// ── Public routes (MUST come before /:id) ────────────────────

/**
 * GET /api/collections/public/:slug
 * Returns the full collection (fields, columns) for the fill page — no auth.
 */
router.get('/public/:slug', (req: Request, res: Response) => {
  const db = getDb()
  const c = db
    .prepare(`${COL_SELECT} WHERE c.slug = ?`)
    .get(req.params.slug) as unknown as DbCollection | undefined

  if (!c) {
    res.status(404).json({ error: 'Collection not found' })
    return
  }
  const [fields, colsByField] = fetchFields(c.id)
  res.json(toApiCollection(c, fields, colsByField))
})

/**
 * POST /api/collections/public/:slug/responses
 * Submit a response — no auth required.
 */
router.post('/public/:slug/responses', (req: Request, res: Response) => {
  const db = getDb()
  const col = db
    .prepare('SELECT id, anonymous FROM collections WHERE slug = ?')
    .get(req.params.slug) as unknown as { id: number; anonymous: number } | undefined

  if (!col) {
    res.status(404).json({ error: 'Collection not found' })
    return
  }

  const body = req.body as {
    respondentName?: string
    respondentEmail?: string
    values?: { fieldId: number; value: string }[]
  }

  if (
    !col.anonymous &&
    (!body.respondentName?.trim() || !body.respondentEmail?.trim())
  ) {
    res
      .status(400)
      .json({ error: 'Name and email are required for this collection' })
    return
  }

  db.exec('BEGIN')
  try {
    const r = db
      .prepare(
        `INSERT INTO collection_responses
           (collection_id, respondent_name, respondent_email)
         VALUES (?, ?, ?)`
      )
      .run(
        col.id,
        body.respondentName?.trim() ?? null,
        body.respondentEmail?.trim() ?? null
      )

    const responseId = r.lastInsertRowid as number

    if (body.values?.length) {
      for (const val of body.values) {
        db.prepare(
          `INSERT INTO collection_response_values (response_id, field_id, value)
           VALUES (?, ?, ?)`
        ).run(responseId, val.fieldId, val.value ?? null)
      }
    }

    db.exec('COMMIT')
    res.status(201).json({ id: responseId, submitted: true })
  } catch (err) {
    db.exec('ROLLBACK')
    console.error('[collections] submit response:', err)
    res.status(500).json({ error: 'Failed to submit response' })
  }
})

// ── Authenticated routes ──────────────────────────────────────

/**
 * GET /api/collections
 * List all collections (summary, with response count).
 */
router.get('/', authenticateToken, (_req: Request, res: Response) => {
  const db = getDb()
  const cols = db
    .prepare(
      `${COL_SELECT} ORDER BY c.created_at DESC`
    )
    .all() as unknown as DbCollection[]

  const result = cols.map(c => {
    const { n } = db
      .prepare(
        'SELECT COUNT(*) AS n FROM collection_responses WHERE collection_id = ?'
      )
      .get(c.id) as { n: number }
    return { ...toApiCollection(c, [], new Map()), responseCount: n }
  })
  res.json(result)
})

/**
 * POST /api/collections
 * Create a new collection with its fields.
 */
router.post('/', authenticateToken, (req: Request, res: Response) => {
  const body = req.body as CollectionBody
  if (!body.title?.trim()) {
    res.status(400).json({ error: 'title is required' })
    return
  }

  const db = getDb()
  const slug = generateUniqueSlug(db, body.title)

  db.exec('BEGIN')
  try {
    const r = db
      .prepare(
        `INSERT INTO collections
           (slug, title, description, category, created_by, date_due, cover_photo_url,
            instructions, instructions_doc_url, anonymous)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        slug,
        body.title.trim(),
        body.description?.trim() ?? null,
        body.category ?? null,
        req.user!.sub,
        body.dateDue ?? null,
        body.coverPhotoUrl ?? null,
        body.instructions ?? null,
        body.instructionsDocUrl ?? null,
        body.anonymous ? 1 : 0
      )

    const id = r.lastInsertRowid as number
    if (body.fields?.length) insertFields(id, body.fields)

    db.exec('COMMIT')

    const c = db
      .prepare(`${COL_SELECT} WHERE c.id = ?`)
      .get(id) as unknown as DbCollection | undefined
    if (!c) {
      db.exec('ROLLBACK')
      res.status(500).json({ error: 'Failed to load created collection' })
      return
    }
    const [fields, colsByField] = fetchFields(id)
    res.status(201).json(toApiCollection(c, fields, colsByField))
  } catch (err) {
    db.exec('ROLLBACK')
    console.error('[collections] create:', err)
    res.status(500).json({ error: 'Failed to create collection' })
  }
})

/**
 * GET /api/collections/:id
 * Get a single collection with full field details.
 */
router.get('/:id', authenticateToken, (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid collection ID' })
    return
  }

  const db = getDb()
  const c = db
    .prepare(`${COL_SELECT} WHERE c.id = ?`)
    .get(id) as unknown as DbCollection | undefined

  if (!c) {
    res.status(404).json({ error: 'Collection not found' })
    return
  }
  const [fields, colsByField] = fetchFields(id)
  res.json(toApiCollection(c, fields, colsByField))
})

/**
 * PUT /api/collections/:id
 * Replace a collection's metadata and fields.
 */
router.put('/:id', authenticateToken, (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid collection ID' })
    return
  }

  const body = req.body as CollectionBody
  if (!body.title?.trim()) {
    res.status(400).json({ error: 'title is required' })
    return
  }

  const db = getDb()
  const exists = db
    .prepare('SELECT id FROM collections WHERE id = ?')
    .get(id)
  if (!exists) {
    res.status(404).json({ error: 'Collection not found' })
    return
  }

  db.exec('BEGIN')
  try {
    db.prepare(
      `UPDATE collections
       SET title = ?, description = ?, category = ?, date_due = ?, cover_photo_url = ?,
           instructions = ?, instructions_doc_url = ?, anonymous = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      body.title.trim(),
      body.description?.trim() ?? null,
      body.category ?? null,
      body.dateDue ?? null,
      body.coverPhotoUrl ?? null,
      body.instructions ?? null,
      body.instructionsDocUrl ?? null,
      body.anonymous ? 1 : 0,
      id
    )

    // Replace fields (CASCADE deletes columns too)
    db.prepare('DELETE FROM collection_fields WHERE collection_id = ?').run(id)
    if (body.fields?.length) insertFields(id, body.fields)

    db.exec('COMMIT')

    const c = db
      .prepare(`${COL_SELECT} WHERE c.id = ?`)
      .get(id) as unknown as DbCollection | undefined
    if (!c) {
      db.exec('ROLLBACK')
      res.status(500).json({ error: 'Failed to load updated collection' })
      return
    }
    const [fields, colsByField] = fetchFields(id)
    res.json(toApiCollection(c, fields, colsByField))
  } catch (err) {
    db.exec('ROLLBACK')
    console.error('[collections] update:', err)
    res.status(500).json({ error: 'Failed to update collection' })
  }
})

/**
 * DELETE /api/collections/:id
 */
router.delete('/:id', authenticateToken, (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid collection ID' })
    return
  }

  const db = getDb()
  const exists = db
    .prepare('SELECT id FROM collections WHERE id = ?')
    .get(id)
  if (!exists) {
    res.status(404).json({ error: 'Collection not found' })
    return
  }

  db.prepare('DELETE FROM collections WHERE id = ?').run(id)
  res.status(204).send()
})

/**
 * GET /api/collections/:id/responses
 * List all responses for a collection.
 */
router.get('/:id/responses', authenticateToken, (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid collection ID' })
    return
  }

  const db = getDb()
  const exists = db.prepare('SELECT id FROM collections WHERE id = ?').get(id)
  if (!exists) {
    res.status(404).json({ error: 'Collection not found' })
    return
  }

  const responses = db
    .prepare(
      'SELECT * FROM collection_responses WHERE collection_id = ? ORDER BY submitted_at DESC'
    )
    .all(id) as unknown as DbResponse[]

  if (responses.length === 0) {
    res.json([])
    return
  }

  const responseIds = responses.map(r => r.id)
  const ph = responseIds.map(() => '?').join(',')
  const values = db
    .prepare(
      `SELECT * FROM collection_response_values WHERE response_id IN (${ph})`
    )
    .all(...responseIds) as unknown as DbResponseValue[]

  const valsByResponse = new Map<number, DbResponseValue[]>()
  for (const v of values) {
    const arr = valsByResponse.get(v.response_id) ?? []
    arr.push(v)
    valsByResponse.set(v.response_id, arr)
  }

  res.json(
    responses.map(r => ({
      id: r.id,
      respondentName: r.respondent_name,
      respondentEmail: r.respondent_email,
      submittedAt: r.submitted_at,
      values: (valsByResponse.get(r.id) ?? []).map(v => ({
        fieldId: v.field_id,
        value: v.value,
      })),
    }))
  )
})

export default router
