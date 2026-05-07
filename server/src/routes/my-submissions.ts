import { Router, type Request, type Response } from 'express'
import { getDb } from '../database/db'
import { authenticateToken } from '../middleware/auth'

const router = Router()

// All routes require authentication
router.use(authenticateToken)

interface DbUser {
  email: string
}

interface DbSubmissionRow {
  response_id: number
  collection_id: number
  collection_version_id: number | null
  collection_title: string
  collection_slug: string
  category: string | null
  version_number: number | null
  editable_until: string | null
  last_edited_at: string | null
  submitted_at: string
}

interface DbValueRow {
  field_id: number
  field_label: string
  field_type: string
  field_options: string | null
  value: string | null
}

interface IncomingValue {
  fieldId: number
  value: string
}

function toIsoUtc(timestamp: string): string {
  // SQLite datetime('now') is stored like "YYYY-MM-DD HH:MM:SS" in UTC.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp)) {
    return `${timestamp.replace(' ', 'T')}Z`
  }
  return timestamp
}

function isEditableNow(editableUntil: string | null): boolean {
  if (!editableUntil) return false
  const untilMs = new Date(toIsoUtc(editableUntil)).getTime()
  return Number.isFinite(untilMs) && Date.now() <= untilMs
}

/**
 * GET /api/my-submissions
 * Returns all submissions made by the authenticated user (matched by email).
 */
router.get('/', (req: Request, res: Response): void => {
  const userId = req.user?.sub
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  try {
    const db = getDb()

    const userRow = db
      .prepare('SELECT email FROM users WHERE id = ?')
      .get(userId) as DbUser | undefined

    if (!userRow) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const rows = db
      .prepare(
        `SELECT
           cr.id          AS response_id,
           c.id           AS collection_id,
           cr.collection_version_id,
           c.title        AS collection_title,
           c.slug         AS collection_slug,
           c.category,
           cv.version_number,
           cr.editable_until,
           cr.last_edited_at,
           cr.submitted_at
         FROM collection_responses cr
         JOIN collections c ON c.id = cr.collection_id
         LEFT JOIN collection_versions cv ON cv.id = cr.collection_version_id
         WHERE cr.respondent_email = ?
         ORDER BY cr.submitted_at DESC`
      )
      .all(userRow.email) as unknown as DbSubmissionRow[]

    res.json(
      rows.map(r => ({
        responseId: r.response_id,
        collectionId: r.collection_id,
        collectionTitle: r.collection_title,
        collectionSlug: r.collection_slug,
        category: r.category,
        versionNumber: r.version_number,
        editableUntil: r.editable_until ? toIsoUtc(r.editable_until) : null,
        lastEditedAt: r.last_edited_at ? toIsoUtc(r.last_edited_at) : null,
        canEdit: isEditableNow(r.editable_until),
        submittedAt: toIsoUtc(r.submitted_at),
      }))
    )
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * GET /api/my-submissions/:responseId
 * Returns the field values for a specific response, verified to belong to the caller.
 */
router.get('/:responseId', (req: Request, res: Response): void => {
  const userId = req.user?.sub
  const responseId = parseInt(req.params.responseId, 10)

  if (!userId || isNaN(responseId)) {
    res.status(400).json({ error: 'Invalid request' })
    return
  }

  try {
    const db = getDb()

    const userRow = db
      .prepare('SELECT email FROM users WHERE id = ?')
      .get(userId) as DbUser | undefined

    if (!userRow) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    // Verify ownership
    const responseRow = db
      .prepare(
      `SELECT cr.id AS response_id, cr.submitted_at, c.id AS collection_id,
                cr.collection_version_id,
                c.title AS collection_title, c.slug AS collection_slug, c.category
                , cv.version_number, cr.editable_until, cr.last_edited_at
         FROM collection_responses cr
         JOIN collections c ON c.id = cr.collection_id
       LEFT JOIN collection_versions cv ON cv.id = cr.collection_version_id
         WHERE cr.id = ? AND cr.respondent_email = ?`
      )
      .get(responseId, userRow.email) as DbSubmissionRow | undefined

    if (!responseRow) {
      res.status(404).json({ error: 'Submission not found' })
      return
    }

    const values = db
      .prepare(
        `SELECT crv.field_id, cf.label AS field_label, cf.type AS field_type, cf.options AS field_options, crv.value
         FROM collection_response_values crv
         JOIN collection_fields cf ON cf.id = crv.field_id
         WHERE crv.response_id = ?
         ORDER BY cf.page_number ASC, cf.sort_order ASC`
      )
      .all(responseId) as unknown as DbValueRow[]

    res.json({
      responseId: responseRow.response_id,
      collectionId: responseRow.collection_id,
      collectionTitle: responseRow.collection_title,
      collectionSlug: responseRow.collection_slug,
      category: responseRow.category,
      versionNumber: responseRow.version_number,
      editableUntil: responseRow.editable_until ? toIsoUtc(responseRow.editable_until) : null,
      lastEditedAt: responseRow.last_edited_at ? toIsoUtc(responseRow.last_edited_at) : null,
      canEdit: isEditableNow(responseRow.editable_until),
      submittedAt: toIsoUtc(responseRow.submitted_at),
      values: values.map(v => ({
        fieldId: v.field_id,
        fieldLabel: v.field_label,
        fieldType: v.field_type,
        fieldOptions: (() => {
          if (!v.field_options) return null
          try {
            const parsed = JSON.parse(v.field_options) as unknown
            return Array.isArray(parsed)
              ? parsed.map(item => String(item))
              : null
          } catch {
            return null
          }
        })(),
        value: v.value ?? '',
      })),
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.put('/:responseId', (req: Request, res: Response): void => {
  const userId = req.user?.sub
  const responseId = parseInt(req.params.responseId, 10)

  if (!userId || isNaN(responseId)) {
    res.status(400).json({ error: 'Invalid request' })
    return
  }

  const body = req.body as { values?: IncomingValue[] }
  if (!Array.isArray(body.values)) {
    res.status(400).json({ error: 'values array is required' })
    return
  }

  try {
    const db = getDb()
    const userRow = db
      .prepare('SELECT email FROM users WHERE id = ?')
      .get(userId) as DbUser | undefined

    if (!userRow) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const responseRow = db
      .prepare(
        `SELECT cr.id AS response_id, cr.collection_id, cr.collection_version_id,
                cr.editable_until, cr.respondent_email
         FROM collection_responses cr
         WHERE cr.id = ? AND cr.respondent_email = ?`
      )
      .get(responseId, userRow.email) as {
      response_id: number
      collection_id: number
      collection_version_id: number | null
      editable_until: string | null
      respondent_email: string | null
    } | undefined

    if (!responseRow) {
      res.status(404).json({ error: 'Submission not found' })
      return
    }

    if (!isEditableNow(responseRow.editable_until)) {
      res.status(409).json({ error: 'This submission can no longer be edited.' })
      return
    }

    const allowedRows = responseRow.collection_version_id
      ? db
          .prepare('SELECT id FROM collection_fields WHERE collection_id = ? AND version_id = ?')
          .all(responseRow.collection_id, responseRow.collection_version_id)
      : db
          .prepare(
            `SELECT cf.id
             FROM collection_fields cf
             JOIN collection_response_values crv ON crv.field_id = cf.id
             WHERE crv.response_id = ?`
          )
          .all(responseId)

    const allowedFieldIds = new Set((allowedRows as Array<{ id: number }>).map(r => r.id))

    const invalid = body.values.find(
      v => !Number.isInteger(v.fieldId) || v.fieldId <= 0 || !allowedFieldIds.has(v.fieldId)
    )
    if (invalid) {
      res.status(400).json({ error: 'One or more fields cannot be edited for this submission.' })
      return
    }

    db.exec('BEGIN')
    try {
      db.prepare('DELETE FROM collection_response_values WHERE response_id = ?').run(responseId)

      const insertValue = db.prepare(
        `INSERT INTO collection_response_values (response_id, field_id, value)
         VALUES (?, ?, ?)`
      )
      for (const v of body.values) {
        const normalized = typeof v.value === 'string' ? v.value : ''
        if (normalized === '') continue
        insertValue.run(responseId, v.fieldId, normalized)
      }

      db.prepare("UPDATE collection_responses SET last_edited_at = datetime('now') WHERE id = ?").run(responseId)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }

    res.json({ updated: true })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
