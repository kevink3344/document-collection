import { Router, type Request, type Response } from 'express'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { getDb } from '../database/db'
import { authenticateToken, JWT_SECRET } from '../middleware/auth'

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

type ColType = 'text' | 'number' | 'date' | 'checkbox' | 'list'

interface DbCollection {
  id: number
  slug: string
  title: string
  status: 'draft' | 'published'
  description: string | null
  category: string | null
  created_by: number
  date_due: string | null
  cover_photo_url: string | null
  instructions: string | null
  instructions_doc_url: string | null
  active_version_id: number | null
  active_version_number?: number | null
  active_version_status?: 'draft' | 'published' | null
  anonymous: number
  allow_submission_edits: number
  submission_edit_window_hours: number | null
  created_at: string
  updated_at: string
  creator_name?: string
}

interface DbField {
  id: number
  collection_id: number
  version_id: number | null
  type: FieldType
  label: string
  page_number: number
  required: number
  options: string | null
  display_style: string
  sort_order: number
}

interface DbTableColumn {
  id: number
  field_id: number
  name: string
  col_type: ColType
  list_options: string | null
  sort_order: number
}

interface DbCollectionVersion {
  id: number
  collection_id: number
  version_number: number
  status: 'draft' | 'published'
  created_by: number
  created_at: string
  published_at: string | null
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
  listOptions?: string[]
  sortOrder?: number
}

interface FieldInput {
  type: FieldType
  label: string
  page?: number
  required?: boolean
  options?: string[]
  displayStyle?: string
  tableColumns?: TableColumnInput[]
  sortOrder?: number
}

interface CollectionBody {
  title: string
  status?: 'draft' | 'published'
  description?: string
  category?: string
  dateDue?: string
  coverPhotoUrl?: string
  instructions?: string
  instructionsDocUrl?: string
  anonymous?: boolean
  allowSubmissionEdits?: boolean
  submissionEditWindowHours?: number
  fields?: FieldInput[]
}

function resolveSubmissionEditSettings(body: CollectionBody): {
  allowSubmissionEdits: boolean
  submissionEditWindowHours: number | null
} {
  const allowSubmissionEdits = body.allowSubmissionEdits === true
  if (!allowSubmissionEdits) {
    return { allowSubmissionEdits: false, submissionEditWindowHours: null }
  }

  const hoursRaw = body.submissionEditWindowHours
  const hours = typeof hoursRaw === 'number' ? hoursRaw : Number(hoursRaw)
  if (!Number.isFinite(hours) || !Number.isInteger(hours) || hours < 1 || hours > 168) {
    throw new Error('submissionEditWindowHours must be an integer between 1 and 168')
  }

  return { allowSubmissionEdits: true, submissionEditWindowHours: hours }
}

function normalizeCategory(category: string | undefined): string | null {
  const normalized = category?.trim() ?? ''
  return normalized ? normalized : null
}

function ensureCategoryExists(category: string | null): string | null {
  if (!category) return null

  const db = getDb()
  const existing = db
    .prepare('SELECT name FROM categories WHERE lower(name) = lower(?)')
    .get(category) as unknown as { name: string } | undefined

  if (!existing) {
    throw new Error('Selected category does not exist')
  }

  return existing.name
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
    status: c.status,
    description: c.description,
    category: c.category,
    createdBy: c.created_by,
    createdByName: c.creator_name ?? null,
    dateDue: c.date_due,
    coverPhotoUrl: c.cover_photo_url,
    instructions: c.instructions,
    instructionsDocUrl: c.instructions_doc_url,
    activeVersionId: c.active_version_id,
    currentVersionNumber: c.active_version_number ?? null,
    currentVersionStatus: c.active_version_status ?? null,
    anonymous: c.anonymous === 1,
    allowSubmissionEdits: c.allow_submission_edits === 1,
    submissionEditWindowHours: c.submission_edit_window_hours,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    fields: fields.map(f => ({
      id: f.id,
      type: f.type,
      label: f.label,
      page: Number(f.page_number) || 1,
      required: f.required === 1,
      options: f.options ? (JSON.parse(f.options) as string[]) : null,
      displayStyle: f.display_style === 'dropdown' ? 'dropdown' : 'radio',
      sortOrder: f.sort_order,
      tableColumns:
        f.type === 'custom_table'
          ? (colsByField.get(f.id) ?? []).map(col => ({
              id: col.id,
              name: col.name,
              colType: col.col_type,
              listOptions:
                col.col_type === 'list' && col.list_options
                  ? (JSON.parse(col.list_options) as string[])
                  : null,
              sortOrder: col.sort_order,
            }))
          : null,
    })),
  }
}

function resolveRequestedStatus(body: CollectionBody): 'draft' | 'published' {
  return body.status === 'published' ? 'published' : 'draft'
}

function hasValidAuthToken(req: Request): boolean {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return false
  try {
    jwt.verify(token, JWT_SECRET)
    return true
  } catch {
    return false
  }
}

// ── Helpers ───────────────────────────────────────────────────

function fetchFields(
  collectionId: number,
  versionId: number | null
): [DbField[], Map<number, DbTableColumn[]>] {
  const db = getDb()
  const fields = (versionId
    ? db
        .prepare(
          'SELECT * FROM collection_fields WHERE collection_id = ? AND version_id = ? ORDER BY page_number, sort_order'
        )
        .all(collectionId, versionId)
    : db
        .prepare(
          'SELECT * FROM collection_fields WHERE collection_id = ? ORDER BY page_number, sort_order'
        )
        .all(collectionId)) as unknown as DbField[]

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
           (collection_id, version_id, type, label, page_number, required, options, display_style, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        collectionId,
        null,
        field.type,
        field.label,
        Math.max(1, Math.floor(field.page ?? 1)),
        field.required ? 1 : 0,
        field.options?.length ? JSON.stringify(field.options) : null,
        field.type === 'single_choice' ? (field.displayStyle ?? 'radio') : 'radio',
        field.sortOrder ?? idx
      )
    if (field.type === 'custom_table' && field.tableColumns?.length) {
      const fieldId = r.lastInsertRowid as number
      field.tableColumns.forEach((col, ci) => {
        db.prepare(
          `INSERT INTO collection_table_columns (field_id, name, col_type, list_options, sort_order)
           VALUES (?, ?, ?, ?, ?)`
        ).run(
          fieldId,
          col.name,
          col.colType,
          col.colType === 'list'
            ? JSON.stringify((col.listOptions ?? []).map(opt => opt.trim()).filter(Boolean))
            : null,
          col.sortOrder ?? ci
        )
      })
    }
  })
}

function insertFieldsForVersion(collectionId: number, versionId: number, fields: FieldInput[]): void {
  const db = getDb()
  fields.forEach((field, idx) => {
    const r = db
      .prepare(
        `INSERT INTO collection_fields
           (collection_id, version_id, type, label, page_number, required, options, display_style, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        collectionId,
        versionId,
        field.type,
        field.label,
        Math.max(1, Math.floor(field.page ?? 1)),
        field.required ? 1 : 0,
        field.options?.length ? JSON.stringify(field.options) : null,
        field.type === 'single_choice' ? (field.displayStyle ?? 'radio') : 'radio',
        field.sortOrder ?? idx
      )
    if (field.type === 'custom_table' && field.tableColumns?.length) {
      const fieldId = r.lastInsertRowid as number
      field.tableColumns.forEach((col, ci) => {
        db.prepare(
          `INSERT INTO collection_table_columns (field_id, name, col_type, list_options, sort_order)
           VALUES (?, ?, ?, ?, ?)`
        ).run(
          fieldId,
          col.name,
          col.colType,
          col.colType === 'list'
            ? JSON.stringify((col.listOptions ?? []).map(opt => opt.trim()).filter(Boolean))
            : null,
          col.sortOrder ?? ci
        )
      })
    }
  })
}

function createCollectionVersion(
  collectionId: number,
  createdBy: number,
  status: 'draft' | 'published',
  fields: FieldInput[]
): { versionId: number; versionNumber: number } {
  const db = getDb()
  const row = db
    .prepare('SELECT COALESCE(MAX(version_number), 0) AS maxVersion FROM collection_versions WHERE collection_id = ?')
    .get(collectionId) as { maxVersion: number }
  const versionNumber = row.maxVersion + 1
  const inserted = db
    .prepare(
      `INSERT INTO collection_versions (collection_id, version_number, status, created_by, published_at)
       VALUES (?, ?, ?, ?, CASE WHEN ? = 'published' THEN datetime('now') ELSE NULL END)`
    )
    .run(collectionId, versionNumber, status, createdBy, status)
  const versionId = inserted.lastInsertRowid as number
  insertFieldsForVersion(collectionId, versionId, fields)
  return { versionId, versionNumber }
}

function normaliseIncomingFields(fields: FieldInput[]): string {
  return JSON.stringify(
    fields.map((f, i) => ({
      type: f.type,
      label: (f.label ?? '').trim(),
      page: Math.max(1, Math.floor(f.page ?? 1)),
      required: !!f.required,
      options: (f.options ?? []).map(o => o.trim()).filter(Boolean),
      tableColumns: (f.tableColumns ?? []).map((c, ci) => ({
        name: (c.name ?? '').trim(),
        colType: c.colType,
        listOptions:
          c.colType === 'list'
            ? (c.listOptions ?? []).map(opt => opt.trim()).filter(Boolean)
            : [],
        sortOrder: c.sortOrder ?? ci,
      })),
      sortOrder: f.sortOrder ?? i,
    }))
  )
}

function normaliseDbFields(fields: DbField[], colsByField: Map<number, DbTableColumn[]>): string {
  return JSON.stringify(
    fields.map((f, i) => ({
      type: f.type,
      label: f.label,
      page: f.page_number,
      required: f.required === 1,
      options: (() => {
        try {
          const parsed = f.options ? JSON.parse(f.options) as unknown : []
          return Array.isArray(parsed)
            ? parsed.map(v => String(v).trim()).filter(Boolean)
            : []
        } catch {
          return []
        }
      })(),
      tableColumns: (colsByField.get(f.id) ?? []).map(col => ({
        name: col.name,
        colType: col.col_type,
        listOptions: (() => {
          if (col.col_type !== 'list') return []
          try {
            const parsed = col.list_options ? (JSON.parse(col.list_options) as unknown) : []
            return Array.isArray(parsed)
              ? parsed.map(v => String(v).trim()).filter(Boolean)
              : []
          } catch {
            return []
          }
        })(),
        sortOrder: col.sort_order,
      })),
      sortOrder: f.sort_order ?? i,
    }))
  )
}

const COL_SELECT = `
  SELECT c.*, u.name AS creator_name,
         cv.version_number AS active_version_number,
         cv.status AS active_version_status
  FROM collections c
  LEFT JOIN users u ON u.id = c.created_by
  LEFT JOIN collection_versions cv ON cv.id = c.active_version_id
`

// ── Public routes (MUST come before /:id) ────────────────────

/**
 * @swagger
 * /api/collections/public/{slug}:
 *   get:
 *     summary: Get a published collection by slug (no auth)
 *     tags: [Public]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: preview
 *         schema:
 *           type: string
 *           enum: ['true']
 *         description: Pass preview=true with a valid bearer token to view draft collections
 *     responses:
 *       200:
 *         description: Collection object with fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Collection'
 *       404:
 *         description: Collection not found or not published
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/public/:slug', (req: Request, res: Response) => {
  const db = getDb()
  const previewRequested = req.query.preview === 'true'
  const isAuthedPreview = previewRequested && hasValidAuthToken(req)
  const c = db
    .prepare(`${COL_SELECT} WHERE c.slug = ?`)
    .get(req.params.slug) as unknown as DbCollection | undefined

  if (!c || (c.status !== 'published' && !isAuthedPreview)) {
    res.status(404).json({ error: 'Collection not found' })
    return
  }
  const [fields, colsByField] = fetchFields(c.id, c.active_version_id)
  res.json(toApiCollection(c, fields, colsByField))
})

/**
 * @swagger
 * /api/collections/public/{slug}/responses:
 *   post:
 *     summary: Submit a response to a published collection (no auth)
 *     tags: [Public]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               respondentName:
 *                 type: string
 *               respondentEmail:
 *                 type: string
 *                 format: email
 *               values:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/ResponseValue'
 *     responses:
 *       201:
 *         description: Response submitted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 submitted:
 *                   type: boolean
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Collection not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: Collection is still a draft
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/public/:slug/responses', (req: Request, res: Response) => {
  const db = getDb()
  const col = db
    .prepare('SELECT id, anonymous, status, active_version_id, allow_submission_edits, submission_edit_window_hours FROM collections WHERE slug = ?')
    .get(req.params.slug) as unknown as {
      id: number
      anonymous: number
      status: 'draft' | 'published'
      active_version_id: number | null
      allow_submission_edits: number
      submission_edit_window_hours: number | null
    } | undefined

  if (!col) {
    res.status(404).json({ error: 'Collection not found' })
    return
  }

  if (col.status !== 'published') {
    res.status(409).json({ error: 'This collection is still a draft and cannot accept responses.' })
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
    const editWindowHours = col.allow_submission_edits === 1
      ? col.submission_edit_window_hours
      : null
    const editableUntil = editWindowHours && col.anonymous !== 1
      ? (db
          .prepare(`SELECT datetime('now', '+' || ? || ' hours') AS ts`)
          .get(editWindowHours) as { ts: string }).ts
      : null

    const r = db
      .prepare(
        `INSERT INTO collection_responses
           (collection_id, collection_version_id, respondent_name, respondent_email, editable_until)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        col.id,
        col.active_version_id,
        body.respondentName?.trim() ?? null,
        body.respondentEmail?.trim() ?? null,
        editableUntil
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
 * @swagger
 * /api/collections:
 *   get:
 *     summary: List all collections with response counts
 *     tags: [Collections]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of collections (fields omitted, responseCount included)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Collection'
 *       401:
 *         description: Unauthorized
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
    const { ct } = db
      .prepare(
        "SELECT COUNT(*) AS ct FROM collection_fields WHERE collection_id = ? AND version_id = ? AND type = 'custom_table'"
      )
      .get(c.id, c.active_version_id) as { ct: number }
    return { ...toApiCollection(c, [], new Map()), responseCount: n, hasCustomTable: ct > 0 }
  })
  res.json(result)
})

/**
 * @swagger
 * /api/collections:
 *   post:
 *     summary: Create a new collection
 *     tags: [Collections]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CollectionInput'
 *     responses:
 *       201:
 *         description: Collection created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Collection'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 */
router.post('/', authenticateToken, (req: Request, res: Response) => {
  const body = req.body as CollectionBody
  if (!body.title?.trim()) {
    res.status(400).json({ error: 'title is required' })
    return
  }

  const db = getDb()
  const slug = generateUniqueSlug(db, body.title)
  let category: string | null
  let editSettings: { allowSubmissionEdits: boolean; submissionEditWindowHours: number | null }

  try {
    category = ensureCategoryExists(normalizeCategory(body.category))
    editSettings = resolveSubmissionEditSettings(body)
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
    return
  }

  db.exec('BEGIN')
  try {
    const requestedStatus = resolveRequestedStatus(body)
    const r = db
      .prepare(
        `INSERT INTO collections
           (slug, title, status, description, category, created_by, date_due, cover_photo_url,
            instructions, instructions_doc_url, anonymous, allow_submission_edits,
            submission_edit_window_hours, active_version_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(
        slug,
        body.title.trim(),
        requestedStatus,
        body.description?.trim() ?? null,
        category,
        req.user!.sub,
        body.dateDue ?? null,
        body.coverPhotoUrl ?? null,
        body.instructions ?? null,
        body.instructionsDocUrl ?? null,
        body.anonymous ? 1 : 0,
        editSettings.allowSubmissionEdits ? 1 : 0,
        editSettings.submissionEditWindowHours
      )

    const id = r.lastInsertRowid as number
    const { versionId } = createCollectionVersion(id, req.user!.sub, requestedStatus, body.fields ?? [])
    db.prepare('UPDATE collections SET active_version_id = ? WHERE id = ?').run(versionId, id)

    db.exec('COMMIT')

    const c = db
      .prepare(`${COL_SELECT} WHERE c.id = ?`)
      .get(id) as unknown as DbCollection | undefined
    if (!c) {
      db.exec('ROLLBACK')
      res.status(500).json({ error: 'Failed to load created collection' })
      return
    }
    const [fields, colsByField] = fetchFields(id, c.active_version_id)
    res.status(201).json(toApiCollection(c, fields, colsByField))
  } catch (err) {
    db.exec('ROLLBACK')
    console.error('[collections] create:', err)
    res.status(500).json({ error: 'Failed to create collection' })
  }
})

/**
 * @swagger
 * /api/collections/{id}:
 *   get:
 *     summary: Get a single collection with full field details
 *     tags: [Collections]
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
 *         description: Collection object with fields and table columns
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Collection'
 *       400:
 *         description: Invalid ID
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Collection not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
  const [fields, colsByField] = fetchFields(id, c.active_version_id)
  res.json(toApiCollection(c, fields, colsByField))
})

/**
 * @swagger
 * /api/collections/{id}:
 *   put:
 *     summary: Update a collection's metadata and fields
 *     description: Fields cannot be modified if responses have already been submitted.
 *     tags: [Collections]
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
 *             $ref: '#/components/schemas/CollectionInput'
 *     responses:
 *       200:
 *         description: Updated collection
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Collection'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Collection not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: Cannot modify fields after responses have been submitted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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

  let category: string | null
  let editSettings: { allowSubmissionEdits: boolean; submissionEditWindowHours: number | null }

  try {
    category = ensureCategoryExists(normalizeCategory(body.category))
    editSettings = resolveSubmissionEditSettings(body)
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
    return
  }

  const db = getDb()
  const existingCollection = db
    .prepare(`${COL_SELECT} WHERE c.id = ?`)
    .get(id) as unknown as DbCollection | undefined

  if (!existingCollection) {
    res.status(404).json({ error: 'Collection not found' })
    return
  }

  const activeVersionId = existingCollection.active_version_id
  if (!activeVersionId) {
    res.status(500).json({ error: 'Collection version metadata is missing' })
    return
  }

  const requestedStatus = resolveRequestedStatus(body)

  db.exec('BEGIN')
  try {
    const { n: responseCount } = db
      .prepare('SELECT COUNT(*) AS n FROM collection_responses WHERE collection_id = ? AND collection_version_id = ?')
      .get(id, activeVersionId) as { n: number }

    const [existingFields, existingColsByField] = fetchFields(id, activeVersionId)
    const incomingFields = body.fields ?? []
    const sameStructure =
      normaliseDbFields(existingFields, existingColsByField)
      === normaliseIncomingFields(incomingFields)

    let targetVersionId = activeVersionId
    if (responseCount > 0 && !sameStructure) {
      const { versionId } = createCollectionVersion(id, req.user!.sub, requestedStatus, incomingFields)
      targetVersionId = versionId
    } else if (responseCount === 0) {
      db.prepare('DELETE FROM collection_fields WHERE collection_id = ? AND version_id = ?').run(id, activeVersionId)
      if (incomingFields.length) {
        insertFieldsForVersion(id, activeVersionId, incomingFields)
      }
    }

    db.prepare(
      `UPDATE collections
       SET title = ?, status = ?, description = ?, category = ?, date_due = ?, cover_photo_url = ?,
           instructions = ?, instructions_doc_url = ?, anonymous = ?, allow_submission_edits = ?,
           submission_edit_window_hours = ?, active_version_id = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      body.title.trim(),
      requestedStatus,
      body.description?.trim() ?? null,
      category,
      body.dateDue ?? null,
      body.coverPhotoUrl ?? null,
      body.instructions ?? null,
      body.instructionsDocUrl ?? null,
      body.anonymous ? 1 : 0,
      editSettings.allowSubmissionEdits ? 1 : 0,
      editSettings.submissionEditWindowHours,
      targetVersionId,
      id
    )

    db.prepare(
      `UPDATE collection_versions
       SET status = ?, published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, datetime('now')) ELSE NULL END
       WHERE id = ?`
    ).run(requestedStatus, requestedStatus, targetVersionId)

    db.exec('COMMIT')

    const c = db
      .prepare(`${COL_SELECT} WHERE c.id = ?`)
      .get(id) as unknown as DbCollection | undefined
    if (!c) {
      res.status(500).json({ error: 'Failed to load updated collection' })
      return
    }
    const [fields, colsByField] = fetchFields(id, c.active_version_id)
    res.json(toApiCollection(c, fields, colsByField))
  } catch (err) {
    try { db.exec('ROLLBACK') } catch { /* ignore if already committed */ }
    console.error('[collections] update:', err)
    res.status(500).json({ error: 'Failed to update collection' })
  }
})

router.get('/:id/versions', authenticateToken, (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid collection ID' })
    return
  }

  const db = getDb()
  const collection = db
    .prepare('SELECT id, active_version_id FROM collections WHERE id = ?')
    .get(id) as { id: number; active_version_id: number | null } | undefined

  if (!collection) {
    res.status(404).json({ error: 'Collection not found' })
    return
  }

  const versions = db
    .prepare(
      `SELECT *
       FROM collection_versions
       WHERE collection_id = ?
       ORDER BY version_number DESC`
    )
    .all(id) as unknown as DbCollectionVersion[]

  res.json(
    versions.map(v => ({
      id: v.id,
      versionNumber: v.version_number,
      status: v.status,
      createdBy: v.created_by,
      createdAt: v.created_at,
      publishedAt: v.published_at,
      isActive: collection.active_version_id === v.id,
    }))
  )
})

router.get('/:id/versions/:versionId', authenticateToken, (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10)
  const versionId = parseInt(req.params.versionId, 10)
  if (isNaN(id) || isNaN(versionId)) {
    res.status(400).json({ error: 'Invalid collection or version ID' })
    return
  }

  const db = getDb()
  const collection = db
    .prepare(`${COL_SELECT} WHERE c.id = ?`)
    .get(id) as DbCollection | undefined

  if (!collection) {
    res.status(404).json({ error: 'Collection not found' })
    return
  }

  const version = db
    .prepare('SELECT id FROM collection_versions WHERE id = ? AND collection_id = ?')
    .get(versionId, id) as { id: number } | undefined

  if (!version) {
    res.status(404).json({ error: 'Version not found' })
    return
  }

  const [fields, colsByField] = fetchFields(id, versionId)
  res.json(toApiCollection(collection, fields, colsByField))
})

router.post('/:id/versions', authenticateToken, (req: Request, res: Response) => {
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
  const collection = db
    .prepare(`${COL_SELECT} WHERE c.id = ?`)
    .get(id) as DbCollection | undefined

  if (!collection) {
    res.status(404).json({ error: 'Collection not found' })
    return
  }

  const requestedStatus = resolveRequestedStatus(body)
  let category: string | null

  try {
    category = ensureCategoryExists(normalizeCategory(body.category))
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
    return
  }

  db.exec('BEGIN')
  try {
    const { versionId } = createCollectionVersion(id, req.user!.sub, requestedStatus, body.fields ?? [])

    db.prepare(
      `UPDATE collections
       SET title = ?, status = ?, description = ?, category = ?, date_due = ?, cover_photo_url = ?,
           instructions = ?, instructions_doc_url = ?, anonymous = ?, active_version_id = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      body.title.trim(),
      requestedStatus,
      body.description?.trim() ?? null,
      category,
      body.dateDue ?? null,
      body.coverPhotoUrl ?? null,
      body.instructions ?? null,
      body.instructionsDocUrl ?? null,
      body.anonymous ? 1 : 0,
      versionId,
      id
    )

    db.exec('COMMIT')

    const updated = db
      .prepare(`${COL_SELECT} WHERE c.id = ?`)
      .get(id) as DbCollection | undefined

    if (!updated) {
      res.status(500).json({ error: 'Failed to load updated collection' })
      return
    }

    const [fields, colsByField] = fetchFields(id, updated.active_version_id)
    res.status(201).json(toApiCollection(updated, fields, colsByField))
  } catch (err) {
    db.exec('ROLLBACK')
    console.error('[collections] create version:', err)
    res.status(500).json({ error: 'Failed to create collection version' })
  }
})

router.post('/:id/versions/:versionId/publish', authenticateToken, (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10)
  const versionId = parseInt(req.params.versionId, 10)
  if (isNaN(id) || isNaN(versionId)) {
    res.status(400).json({ error: 'Invalid collection or version ID' })
    return
  }

  const db = getDb()
  const version = db
    .prepare('SELECT id, collection_id FROM collection_versions WHERE id = ? AND collection_id = ?')
    .get(versionId, id) as { id: number; collection_id: number } | undefined

  if (!version) {
    res.status(404).json({ error: 'Version not found' })
    return
  }

  db.exec('BEGIN')
  try {
    db.prepare(
      `UPDATE collection_versions
       SET status = 'published', published_at = COALESCE(published_at, datetime('now'))
       WHERE id = ?`
    ).run(versionId)

    db.prepare(
      `UPDATE collections
       SET status = 'published', active_version_id = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(versionId, id)

    db.exec('COMMIT')

    const updated = db
      .prepare(`${COL_SELECT} WHERE c.id = ?`)
      .get(id) as DbCollection | undefined

    if (!updated) {
      res.status(500).json({ error: 'Failed to load updated collection' })
      return
    }

    const [fields, colsByField] = fetchFields(id, updated.active_version_id)
    res.json(toApiCollection(updated, fields, colsByField))
  } catch (err) {
    db.exec('ROLLBACK')
    console.error('[collections] publish version:', err)
    res.status(500).json({ error: 'Failed to publish version' })
  }
})

/**
 * @swagger
 * /api/collections/{id}:
 *   delete:
 *     summary: Delete a collection and all its fields and responses
 *     tags: [Collections]
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
 *       400:
 *         description: Invalid ID
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Collection not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
 * @swagger
 * /api/collections/{id}/responses:
 *   get:
 *     summary: List all responses for a collection
 *     tags: [Responses]
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
 *         description: Array of responses with field values
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/CollectionResponse'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Collection not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
