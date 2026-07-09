import { Router, type Request, type Response } from 'express'
import { getDbAsync } from '../database/db'
import { authenticateToken } from '../middleware/auth'
import { loadRequestUserContext, isAdministrator } from '../middleware/organizationAccess'

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
  field_display_style: string | null
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
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  try {
    const db = await getDbAsync()

    const userRow = await db.queryOne<DbUser>('SELECT email FROM users WHERE id = ?', [context.id])

    if (!userRow) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const rows = await db.queryAll<DbSubmissionRow>(
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
        WHERE cr.respondent_email = ? ${!isAdministrator(context) && context.organizationId ? 'AND c.organization_id = ?' : !isAdministrator(context) ? 'AND 1 = 0' : ''}
         ORDER BY cr.submitted_at DESC`,
        (!isAdministrator(context) && context.organizationId ? [userRow.email, context.organizationId] : [userRow.email])
      )

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
router.get('/:responseId', async (req: Request, res: Response): Promise<void> => {
  const context = await loadRequestUserContext(req)
  const responseId = parseInt(req.params.responseId, 10)

  if (!context || isNaN(responseId)) {
    res.status(400).json({ error: 'Invalid request' })
    return
  }

  try {
    const db = await getDbAsync()

    const userRow = await db.queryOne<DbUser>('SELECT email FROM users WHERE id = ?', [context.id])

    if (!userRow) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    // Verify ownership
    const responseRow = await db.queryOne<DbSubmissionRow>(
      `SELECT cr.id AS response_id, cr.submitted_at, c.id AS collection_id,
                cr.collection_version_id,
                c.title AS collection_title, c.slug AS collection_slug, c.category
                , cv.version_number, cr.editable_until, cr.last_edited_at
         FROM collection_responses cr
         JOIN collections c ON c.id = cr.collection_id
       LEFT JOIN collection_versions cv ON cv.id = cr.collection_version_id
        WHERE cr.id = ? AND cr.respondent_email = ? ${!isAdministrator(context) && context.organizationId ? 'AND c.organization_id = ?' : !isAdministrator(context) ? 'AND 1 = 0' : ''}`,
        (!isAdministrator(context) && context.organizationId ? [responseId, userRow.email, context.organizationId] : [responseId, userRow.email])
      )

    if (!responseRow) {
      res.status(404).json({ error: 'Submission not found' })
      return
    }

    const values = await db.queryAll<DbValueRow>(
        `SELECT crv.field_id, cf.label AS field_label, cf.type AS field_type, cf.options AS field_options,
                cf.display_style AS field_display_style, crv.value
         FROM collection_response_values crv
         JOIN collection_fields cf ON cf.id = crv.field_id
         WHERE crv.response_id = ?
           AND (cf.staff_only IS NULL OR cf.staff_only = 0)
         ORDER BY cf.page_number ASC, cf.sort_order ASC`,
        [responseId]
      )

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
        fieldDisplayStyle: v.field_display_style,
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

router.put('/:responseId', async (req: Request, res: Response): Promise<void> => {
  const context = await loadRequestUserContext(req)
  const responseId = parseInt(req.params.responseId, 10)

  if (!context || isNaN(responseId)) {
    res.status(400).json({ error: 'Invalid request' })
    return
  }

  const body = req.body as { values?: IncomingValue[] }
  if (!Array.isArray(body.values)) {
    res.status(400).json({ error: 'values array is required' })
    return
  }

  try {
    const db = await getDbAsync()
    const userRow = await db.queryOne<DbUser>('SELECT email FROM users WHERE id = ?', [context.id])

    if (!userRow) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const responseRow = await db.queryOne<{
      response_id: number
      collection_id: number
      collection_version_id: number | null
      editable_until: string | null
      respondent_email: string | null
    }>(
        `SELECT cr.id AS response_id, cr.collection_id, cr.collection_version_id,
                cr.editable_until, cr.respondent_email
         FROM collection_responses cr
         JOIN collections c ON c.id = cr.collection_id
         WHERE cr.id = ? AND cr.respondent_email = ? ${!isAdministrator(context) && context.organizationId ? 'AND c.organization_id = ?' : !isAdministrator(context) ? 'AND 1 = 0' : ''}`,
        (!isAdministrator(context) && context.organizationId ? [responseId, userRow.email, context.organizationId] : [responseId, userRow.email])
      )

    if (!responseRow) {
      res.status(404).json({ error: 'Submission not found' })
      return
    }

    if (!isEditableNow(responseRow.editable_until)) {
      res.status(409).json({ error: 'This submission can no longer be edited.' })
      return
    }

    const allowedRows = responseRow.collection_version_id
      ? await db.queryAll<{ id: number }>('SELECT id FROM collection_fields WHERE collection_id = ? AND version_id = ?', [responseRow.collection_id, responseRow.collection_version_id])
      : await db.queryAll<{ id: number }>(
            `SELECT cf.id
             FROM collection_fields cf
             JOIN collection_response_values crv ON crv.field_id = cf.id
             WHERE crv.response_id = ?`,
            [responseId]
          )

    const allowedFieldIds = new Set((allowedRows as Array<{ id: number }>).map(r => r.id))

    const invalid = (body.values as IncomingValue[]).find(
      v => !Number.isInteger(v.fieldId) || v.fieldId <= 0 || !allowedFieldIds.has(v.fieldId)
    )
    if (invalid) {
      res.status(400).json({ error: 'One or more fields cannot be edited for this submission.' })
      return
    }

    await db.transaction(async (tx) => {
      await tx.execute('DELETE FROM collection_response_values WHERE response_id = ?', [responseId])

      for (const v of (body.values as IncomingValue[])) {
        const normalized = typeof v.value === 'string' ? v.value : ''
        if (normalized === '') continue
        await tx.execute(
          `INSERT INTO collection_response_values (response_id, field_id, value)
           VALUES (?, ?, ?)`,
          [responseId, v.fieldId, normalized]
        )
      }

      await tx.execute("UPDATE collection_responses SET last_edited_at = datetime('now') WHERE id = ?", [responseId])
    })

    res.json({ updated: true })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
