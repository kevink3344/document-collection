import { Router, type Request, type Response } from 'express'
import { getDbAsync } from '../database/db'
import type { DbAdapter } from '../database/types'
import { authenticateToken } from '../middleware/auth'
import {
  loadRequestUserContext,
  canViewResponses,
  canViewAllResponses,
  type RequestUserContext,
} from '../middleware/organizationAccess'

const router = Router()

// ── Types ─────────────────────────────────────────────────────

interface ExportColumn {
  fieldId: number | null
  key: string
  label: string
}

interface ExportTicketTemplate {
  templateId: number
  title: string
  columns: ExportColumn[]
}

interface ExportSchemaResponse {
  submissionColumns: ExportColumn[]
  ticketTemplates: ExportTicketTemplate[]
}

interface DbCollection {
  id: number
  title: string
  anonymous: number
  organization_id: number
  active_version_id: number | null
}

interface DbField {
  id: number
  field_key: string | null
  label: string
  type: string
  sort_order: number
  page_number: number
  staff_only: number
}

interface DbTicketTemplate {
  id: number
  title: string
}

interface DbTicketField {
  id: number
  label: string
  type: string
  sort_order: number
}

interface DbResponse {
  id: number
  respondent_name: string | null
  respondent_email: string | null
  submitted_at: string
}

interface DbResponseValue {
  response_id: number
  field_key: string | null
  value: string | null
}

interface DbTicketResponse {
  id: number
  collection_response_id: number
  ticket_template_id: number | null
  finalized: number
  finalized_at: string | null
  finalized_by_name: string | null
  filled_at: string | null
  created_at: string
}

interface DbTicketResponseValue {
  ticket_response_id: number
  ticket_field_id: number
  value: string | null
}

interface DbPreset {
  id: number
  created_by_user_id: number | null
  organization_id: number
  collection_id: number
  name: string
  all_submission_columns: number
  submission_columns: string
  ticket_template_id: number | null
  all_ticket_columns: number
  ticket_columns: string
  created_at: string
  updated_at: string
}

// ── Helpers ───────────────────────────────────────────────────

async function fetchCollection(db: DbAdapter, id: number, context: RequestUserContext): Promise<DbCollection | undefined> {
  if (context.role === 'super_admin') {
    return db.queryOne<DbCollection>('SELECT id, title, anonymous, organization_id, active_version_id FROM collections WHERE id = ?', [id])
  }

  const byOrg = await db.queryOne<DbCollection>(
    'SELECT id, title, anonymous, organization_id, active_version_id FROM collections WHERE id = ? AND organization_id = ?',
    [id, context.organizationId]
  )
  if (byOrg) return byOrg

  const directShare = await db.queryOne<{ 1: number }>(
    'SELECT 1 FROM collection_shares WHERE collection_id = ? AND share_type = \'user\' AND share_target_id = ?',
    [id, context.id]
  )
  if (directShare) {
    return db.queryOne<DbCollection>('SELECT id, title, anonymous, organization_id, active_version_id FROM collections WHERE id = ?', [id])
  }

  const groupShare = await db.queryOne<{ 1: number }>(
    `SELECT 1 FROM collection_shares cs
     JOIN group_members gm ON gm.group_id = cs.share_target_id
     WHERE cs.collection_id = ? AND cs.share_type = 'group' AND gm.user_id = ?
     LIMIT 1`,
    [id, context.id]
  )
  if (groupShare) {
    return db.queryOne<DbCollection>('SELECT id, title, anonymous, organization_id, active_version_id FROM collections WHERE id = ?', [id])
  }

  return undefined
}

async function fetchSubmissionFields(db: DbAdapter, collectionId: number, activeVersionId: number | null): Promise<DbField[]> {
  const params: (number | null)[] = [collectionId]
  const versionClause = activeVersionId !== null
    ? 'AND version_id = ?'
    : 'AND version_id IS NULL'
  if (activeVersionId !== null) {
    params.push(activeVersionId)
  }

  return db.queryAll<DbField>(
    `SELECT id, field_key, label, type, sort_order, page_number, staff_only
     FROM collection_fields
     WHERE collection_id = ? ${versionClause}
       AND type != 'comment'
     ORDER BY page_number ASC, sort_order ASC, id ASC`,
    params
  )
}

async function fetchTicketTemplatesForCollection(db: DbAdapter, collectionId: number): Promise<DbTicketTemplate[]> {
  return db.queryAll<DbTicketTemplate>(
    `SELECT tt.id, tt.title
     FROM ticket_templates tt
     JOIN collection_ticket_templates ctt ON ctt.ticket_template_id = tt.id
     WHERE ctt.collection_id = ? AND ctt.is_active = 1
     ORDER BY ctt.display_order ASC, tt.title ASC, tt.id ASC`,
    [collectionId]
  )
}

async function fetchTicketFieldsForTemplate(db: DbAdapter, templateId: number): Promise<DbTicketField[]> {
  return db.queryAll<DbTicketField>(
    `SELECT id, label, type, sort_order
     FROM ticket_fields
     WHERE ticket_template_id = ?
     ORDER BY page_number ASC, sort_order ASC, id ASC`,
    [templateId]
  )
}

async function fetchFilteredResponseIds(db: DbAdapter, collectionId: number, context: RequestUserContext): Promise<number[]> {
  if (canViewAllResponses(context)) {
    const rows = await db.queryAll<{ id: number }>(
      'SELECT id FROM collection_responses WHERE collection_id = ? ORDER BY submitted_at DESC',
      [collectionId]
    )
    return rows.map(r => r.id)
  }

  const locationField = await db.queryOne<{ id: number }>(
    `SELECT id FROM collection_fields
     WHERE collection_id = ? AND type = 'location' AND location_filter_enabled = 1
     LIMIT 1`,
    [collectionId]
  )

  if (!locationField) {
    const rows = await db.queryAll<{ id: number }>(
      'SELECT id FROM collection_responses WHERE collection_id = ? ORDER BY submitted_at DESC',
      [collectionId]
    )
    return rows.map(r => r.id)
  }

  const assignedLocations = await db.queryAll<{ name: string }>(
    `SELECT l.name FROM user_locations ul
     JOIN locations l ON l.id = ul.location_id
     WHERE ul.user_id = ?`,
    [context.id]
  )
  const locationNames = assignedLocations.map(l => l.name)

  if (locationNames.length === 0) {
    return []
  }

  const ph = locationNames.map(() => '?').join(',')
  const rows = await db.queryAll<{ id: number }>(
    `SELECT DISTINCT cr.id
     FROM collection_responses cr
     JOIN collection_response_values rv ON rv.response_id = cr.id
     WHERE cr.collection_id = ? AND rv.field_id = ? AND rv.value IN (${ph})
     ORDER BY cr.submitted_at DESC`,
    [collectionId, locationField.id, ...locationNames]
  )
  return rows.map(r => r.id)
}

function toCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function formatFieldValueForCsv(type: string, value: string | null): string {
  const raw = value ?? ''
  if (!raw) return raw
  switch (type) {
    case 'multiple_choice': {
      try {
        const items = JSON.parse(raw) as string[]
        return Array.isArray(items) ? items.join('; ') : raw
      } catch {
        return raw
      }
    }
    case 'confirmation':
      return raw === 'true' ? 'Confirmed' : 'Not confirmed'
    case 'signature':
      return raw.startsWith('data:image') ? '[signature captured]' : raw
    case 'attachment': {
      try {
        const parsed = JSON.parse(raw) as Array<{ fileName?: string }>
        if (Array.isArray(parsed)) {
          return parsed.map(a => a.fileName ?? '').filter(Boolean).join('; ')
        }
      } catch {
        // fall through
      }
      return raw
    }
    case 'custom_table': {
      try {
        const rows = JSON.parse(raw) as Array<Record<string, string>>
        return Array.isArray(rows) ? JSON.stringify(rows) : raw
      } catch {
        return raw
      }
    }
    default:
      return raw
  }
}

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

async function generateNextPresetName(db: DbAdapter, organizationId: number, collectionId: number): Promise<string> {
  const existing = await db.queryAll<{ name: string }>(
    `SELECT name FROM saved_export_presets
     WHERE organization_id = ? AND collection_id = ? AND name LIKE 'Report export #%'`,
    [organizationId, collectionId]
  )

  const usedNumbers = new Set<number>()
  for (const row of existing) {
    const match = row.name.match(/^Report export #(\d+)$/)
    if (match) {
      usedNumbers.add(parseInt(match[1], 10))
    }
  }

  let n = 1
  while (usedNumbers.has(n)) {
    n += 1
  }
  return `Report export #${n}`
}

// ── Schema endpoint ───────────────────────────────────────────

router.get('/collections/:id/schema', authenticateToken, async (req: Request, res: Response): Promise<void> => {
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

  if (!canViewResponses(context)) {
    res.status(403).json({ error: 'You do not have permission to view collection results' })
    return
  }

  const db = await getDbAsync()
  const collection = await fetchCollection(db, id, context)
  if (!collection) {
    res.status(404).json({ error: 'Collection not found' })
    return
  }

  const fields = await fetchSubmissionFields(db, id, collection.active_version_id)
  const submissionColumns: ExportColumn[] = [
    { fieldId: null, key: 'id', label: 'Submission ID' },
    { fieldId: null, key: 'submittedAt', label: 'Submitted At' },
  ]

  if (collection.anonymous !== 1) {
    submissionColumns.push(
      { fieldId: null, key: 'respondentName', label: 'Respondent Name' },
      { fieldId: null, key: 'respondentEmail', label: 'Respondent Email' }
    )
  }

  for (const field of fields) {
    submissionColumns.push({
      fieldId: field.id,
      key: `field-${field.id}`,
      label: field.label,
    })
  }

  const templates = await fetchTicketTemplatesForCollection(db, id)
  const ticketTemplates: ExportTicketTemplate[] = []
  for (const template of templates) {
    const ticketFields = await fetchTicketFieldsForTemplate(db, template.id)
    const columns: ExportColumn[] = [
      { fieldId: null, key: 'status', label: 'Status' },
      { fieldId: null, key: 'finalizedAt', label: 'Closed At' },
      { fieldId: null, key: 'finalizedByName', label: 'Closed By' },
      { fieldId: null, key: 'filledAt', label: 'Filled At' },
    ]
    for (const field of ticketFields) {
      columns.push({
        fieldId: field.id,
        key: `field-${field.id}`,
        label: field.label,
      })
    }
    ticketTemplates.push({ templateId: template.id, title: template.title, columns })
  }

  const response: ExportSchemaResponse = {
    submissionColumns,
    ticketTemplates,
  }

  res.json(response)
})

// ── Export endpoint ───────────────────────────────────────────

router.post('/collections/:id/export', authenticateToken, async (req: Request, res: Response): Promise<void> => {
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

  if (!canViewResponses(context)) {
    res.status(403).json({ error: 'You do not have permission to export collection results' })
    return
  }

  const db = await getDbAsync()
  const collection = await fetchCollection(db, id, context)
  if (!collection) {
    res.status(404).json({ error: 'Collection not found' })
    return
  }

  const body = req.body as {
    submissionColumnKeys?: unknown
    ticketTemplateId?: unknown
    ticketColumnKeys?: unknown
  }

  const submissionColumnKeys = Array.isArray(body.submissionColumnKeys)
    ? body.submissionColumnKeys.filter((k): k is string => typeof k === 'string')
    : []
  const ticketTemplateId = typeof body.ticketTemplateId === 'number' ? body.ticketTemplateId : null
  const ticketColumnKeys = Array.isArray(body.ticketColumnKeys)
    ? body.ticketColumnKeys.filter((k): k is string => typeof k === 'string')
    : []

  if (submissionColumnKeys.length === 0) {
    res.status(400).json({ error: 'At least one submission column is required' })
    return
  }

  if (ticketTemplateId !== null && ticketColumnKeys.length === 0) {
    res.status(400).json({ error: 'At least one ticket column is required when a ticket template is selected' })
    return
  }

  const schema = await buildSchema(db, id, collection.anonymous === 1, collection.active_version_id)
  const validSubmissionKeys = new Set(schema.submissionColumns.map(c => c.key))
  const selectedSubmissionKeys = submissionColumnKeys.filter(k => validSubmissionKeys.has(k))
  if (selectedSubmissionKeys.length === 0) {
    res.status(400).json({ error: 'No valid submission columns selected' })
    return
  }

  let selectedTicketKeys: string[] = []
  let ticketTemplate: ExportTicketTemplate | undefined
  if (ticketTemplateId !== null) {
    ticketTemplate = schema.ticketTemplates.find(t => t.templateId === ticketTemplateId)
    if (!ticketTemplate) {
      res.status(400).json({ error: 'Selected ticket template is not available for this collection' })
      return
    }
    const validTicketKeys = new Set(ticketTemplate.columns.map(c => c.key))
    selectedTicketKeys = ticketColumnKeys.filter(k => validTicketKeys.has(k))
    if (selectedTicketKeys.length === 0) {
      res.status(400).json({ error: 'No valid ticket columns selected' })
      return
    }
  }

  const responseIds = await fetchFilteredResponseIds(db, id, context)
  if (responseIds.length === 0) {
    const headers = [
      ...selectedSubmissionKeys.map(k => schema.submissionColumns.find(c => c.key === k)!.label),
      ...selectedTicketKeys.map(k => ticketTemplate!.columns.find(c => c.key === k)!.label),
    ]
    const csv = headers.map(toCsvCell).join(',')
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="${toSafeFilename(collection.title)}-export.csv"`)
    res.send(csv)
    return
  }

  const responses = await db.queryAll<DbResponse>(
    `SELECT id, respondent_name, respondent_email, submitted_at
     FROM collection_responses
     WHERE id IN (${responseIds.map(() => '?').join(',')})
     ORDER BY submitted_at DESC`,
    responseIds
  )

  // Join collection_fields to get the stable field_key so values from older
  // collection versions (different field IDs, same field_key) are matched correctly.
  const responseValueRows = await db.queryAll<DbResponseValue>(
    `SELECT rv.response_id, cf.field_key, rv.value
     FROM collection_response_values rv
     JOIN collection_fields cf ON cf.id = rv.field_id
     WHERE rv.response_id IN (${responseIds.map(() => '?').join(',')})`,
    responseIds
  )
  const responseValues = new Map<number, Map<string, string | null>>()
  for (const rv of responseValueRows) {
    if (!rv.field_key) continue
    const byResponse = responseValues.get(rv.response_id) ?? new Map<string, string | null>()
    byResponse.set(rv.field_key, rv.value)
    responseValues.set(rv.response_id, byResponse)
  }

  // field_key → type map, built from the active version's fields
  const fieldTypeByKey = new Map<string, string>()
  const fields = await fetchSubmissionFields(db, id, collection.active_version_id)
  for (const field of fields) {
    if (field.field_key) fieldTypeByKey.set(field.field_key, field.type)
  }

  let ticketResponses: DbTicketResponse[] = []
  let ticketValues = new Map<number, Map<number, string | null>>()
  let ticketFieldTypeById = new Map<number, string>()
  if (ticketTemplateId !== null) {
    ticketResponses = await db.queryAll<DbTicketResponse>(
      `SELECT tr.id, tr.collection_response_id, tr.ticket_template_id, tr.finalized, tr.finalized_at, tr.filled_at, tr.created_at,
              u.name AS finalized_by_name
       FROM ticket_responses tr
       LEFT JOIN users u ON u.id = tr.finalized_by
       WHERE tr.collection_id = ? AND tr.ticket_template_id = ? AND tr.collection_response_id IN (${responseIds.map(() => '?').join(',')})`,
      [id, ticketTemplateId, ...responseIds]
    )

    if (ticketResponses.length > 0) {
      const ticketResponseIds = ticketResponses.map(tr => tr.id)
      const ticketValueRows = await db.queryAll<DbTicketResponseValue>(
        `SELECT ticket_response_id, ticket_field_id, value
         FROM ticket_response_values
         WHERE ticket_response_id IN (${ticketResponseIds.map(() => '?').join(',')})`,
        ticketResponseIds
      )
      for (const tv of ticketValueRows) {
        const byTicket = ticketValues.get(tv.ticket_response_id) ?? new Map<number, string | null>()
        byTicket.set(tv.ticket_field_id, tv.value)
        ticketValues.set(tv.ticket_response_id, byTicket)
      }

      const ticketFields = await fetchTicketFieldsForTemplate(db, ticketTemplateId)
      for (const field of ticketFields) {
        ticketFieldTypeById.set(field.id, field.type)
      }
    }
  }

  const ticketsByResponse = new Map<number, DbTicketResponse[]>()
  for (const tr of ticketResponses) {
    const arr = ticketsByResponse.get(tr.collection_response_id) ?? []
    arr.push(tr)
    ticketsByResponse.set(tr.collection_response_id, arr)
  }

  const headers = [
    ...selectedSubmissionKeys.map(k => schema.submissionColumns.find(c => c.key === k)!.label),
    ...selectedTicketKeys.map(k => ticketTemplate!.columns.find(c => c.key === k)!.label),
  ]

  const lines: string[] = [headers.map(toCsvCell).join(',')]

  for (const response of responses) {
    const submissionValues = responseValues.get(response.id) ?? new Map<string, string | null>()
    const baseCells = selectedSubmissionKeys.map(key => {
      switch (key) {
        case 'id': return String(response.id)
        case 'submittedAt': return response.submitted_at ?? ''
        case 'respondentName': return response.respondent_name ?? ''
        case 'respondentEmail': return response.respondent_email ?? ''
        default: {
          // key is field_key (e.g. a UUID or human slug) from buildSchema
          const type = fieldTypeByKey.get(key) ?? 'short_text'
          return formatFieldValueForCsv(type, submissionValues.get(key) ?? null)
        }
      }
    })

    const responseTickets = ticketsByResponse.get(response.id) ?? []
    if (responseTickets.length === 0) {
      const cells = [...baseCells, ...selectedTicketKeys.map(() => '')]
      lines.push(cells.map(toCsvCell).join(','))
      continue
    }

    for (const ticket of responseTickets) {
      const ticketValueMap = ticketValues.get(ticket.id) ?? new Map<number, string | null>()
      const ticketCells = selectedTicketKeys.map(key => {
        switch (key) {
          case 'status': return ticket.finalized ? 'Closed' : 'Open'
          case 'finalizedAt': return ticket.finalized_at ?? ''
          case 'finalizedByName': return ticket.finalized_by_name ?? ''
          case 'filledAt': return ticket.filled_at ?? ''
          default: {
            if (key.startsWith('field-')) {
              const fieldId = parseInt(key.slice(6), 10)
              const type = ticketFieldTypeById.get(fieldId) ?? 'short_text'
              return formatFieldValueForCsv(type, ticketValueMap.get(fieldId) ?? null)
            }
            return ''
          }
        }
      })
      const cells = [...baseCells, ...ticketCells]
      lines.push(cells.map(toCsvCell).join(','))
    }
  }

  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', `attachment; filename="${toSafeFilename(collection.title)}-export.csv"`)
  res.send(lines.join('\n'))
})

// ── Presets endpoints ─────────────────────────────────────────

router.get('/presets', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  if (!canViewResponses(context)) {
    res.status(403).json({ error: 'You do not have permission to view export presets' })
    return
  }

  const collectionId = parseInt(req.query.collectionId as string, 10)
  if (isNaN(collectionId)) {
    res.status(400).json({ error: 'Invalid collection ID' })
    return
  }

  const db = await getDbAsync()
  const collection = await fetchCollection(db, collectionId, context)
  if (!collection) {
    res.status(404).json({ error: 'Collection not found' })
    return
  }

  const rows = await db.queryAll<DbPreset>(
    `SELECT id, created_by_user_id, name, all_submission_columns, submission_columns,
            ticket_template_id, all_ticket_columns, ticket_columns, created_at, updated_at
     FROM saved_export_presets
     WHERE organization_id = ? AND collection_id = ?
     ORDER BY name ASC, id ASC`,
    [collection.organization_id, collectionId]
  )

  res.json(rows.map(row => ({
    id: row.id,
    name: row.name,
    allSubmissionColumns: row.all_submission_columns === 1,
    submissionColumns: safeJsonParse<string[]>(row.submission_columns, []),
    ticketTemplateId: row.ticket_template_id,
    allTicketColumns: row.all_ticket_columns === 1,
    ticketColumns: safeJsonParse<string[]>(row.ticket_columns, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })))
})

router.post('/presets', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  if (!canViewResponses(context)) {
    res.status(403).json({ error: 'You do not have permission to create export presets' })
    return
  }

  const body = req.body as {
    collectionId?: unknown
    name?: unknown
    allSubmissionColumns?: unknown
    submissionColumns?: unknown
    ticketTemplateId?: unknown
    allTicketColumns?: unknown
    ticketColumns?: unknown
  }

  const collectionId = typeof body.collectionId === 'number' ? body.collectionId : NaN
  if (isNaN(collectionId)) {
    res.status(400).json({ error: 'Invalid collection ID' })
    return
  }

  const db = await getDbAsync()
  const collection = await fetchCollection(db, collectionId, context)
  if (!collection) {
    res.status(404).json({ error: 'Collection not found' })
    return
  }

  let name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) {
    name = await generateNextPresetName(db, collection.organization_id, collectionId)
  }

  const allSubmissionColumns = body.allSubmissionColumns === true ? 1 : 0
  const submissionColumns = Array.isArray(body.submissionColumns)
    ? body.submissionColumns.filter((k): k is string => typeof k === 'string')
    : []
  const ticketTemplateId = typeof body.ticketTemplateId === 'number' ? body.ticketTemplateId : null
  const allTicketColumns = body.allTicketColumns === true ? 1 : 0
  const ticketColumns = Array.isArray(body.ticketColumns)
    ? body.ticketColumns.filter((k): k is string => typeof k === 'string')
    : []

  try {
    const result = await db.execute(
      `INSERT INTO saved_export_presets
       (created_by_user_id, organization_id, collection_id, name,
        all_submission_columns, submission_columns,
        ticket_template_id, all_ticket_columns, ticket_columns)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        context.id,
        collection.organization_id,
        collectionId,
        name,
        allSubmissionColumns,
        JSON.stringify(submissionColumns),
        ticketTemplateId,
        allTicketColumns,
        JSON.stringify(ticketColumns),
      ]
    )

    const created = await db.queryOne<DbPreset>(
      `SELECT id, created_by_user_id, name, all_submission_columns, submission_columns,
              ticket_template_id, all_ticket_columns, ticket_columns, created_at, updated_at
       FROM saved_export_presets
       WHERE id = ?`,
      [Number(result.lastInsertRowid)]
    )

    if (!created) {
      res.status(500).json({ error: 'Failed to load created preset' })
      return
    }

    res.status(201).json({
      id: created.id,
      name: created.name,
      allSubmissionColumns: created.all_submission_columns === 1,
      submissionColumns: safeJsonParse<string[]>(created.submission_columns, []),
      ticketTemplateId: created.ticket_template_id,
      allTicketColumns: created.all_ticket_columns === 1,
      ticketColumns: safeJsonParse<string[]>(created.ticket_columns, []),
      createdAt: created.created_at,
      updatedAt: created.updated_at,
    })
  } catch (err) {
    const message = (err as Error).message ?? ''
    if (message.includes('UNIQUE constraint failed') || /unique constraint/i.test(message)) {
      res.status(409).json({ error: 'A preset with that name already exists for this collection' })
      return
    }
    console.error('[export-csv] create preset:', err)
    res.status(500).json({ error: 'Failed to save preset' })
  }
})

router.put('/presets/:presetId', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  if (!canViewResponses(context)) {
    res.status(403).json({ error: 'You do not have permission to update export presets' })
    return
  }

  const presetId = parseInt(req.params.presetId, 10)
  if (isNaN(presetId)) {
    res.status(400).json({ error: 'Invalid preset ID' })
    return
  }

  const body = req.body as {
    collectionId?: unknown
    name?: unknown
    allSubmissionColumns?: unknown
    submissionColumns?: unknown
    ticketTemplateId?: unknown
    allTicketColumns?: unknown
    ticketColumns?: unknown
  }

  const db = await getDbAsync()
  const existing = await db.queryOne<DbPreset>(
    'SELECT * FROM saved_export_presets WHERE id = ?',
    [presetId]
  )
  if (!existing) {
    res.status(404).json({ error: 'Preset not found' })
    return
  }

  const collectionId = typeof body.collectionId === 'number' ? body.collectionId : existing.collection_id
  const collection = await fetchCollection(db, collectionId, context)
  if (!collection) {
    res.status(404).json({ error: 'Collection not found' })
    return
  }

  if (existing.organization_id !== collection.organization_id) {
    res.status(400).json({ error: 'Preset cannot be moved to a different organization' })
    return
  }

  const name = typeof body.name === 'string' ? body.name.trim() : existing.name
  const allSubmissionColumns = typeof body.allSubmissionColumns === 'boolean'
    ? (body.allSubmissionColumns ? 1 : 0)
    : existing.all_submission_columns
  const submissionColumns = Array.isArray(body.submissionColumns)
    ? body.submissionColumns.filter((k): k is string => typeof k === 'string')
    : safeJsonParse<string[]>(existing.submission_columns, [])
  const ticketTemplateId = typeof body.ticketTemplateId === 'number'
    ? body.ticketTemplateId
    : (typeof body.ticketTemplateId === 'undefined' ? existing.ticket_template_id : null)
  const allTicketColumns = typeof body.allTicketColumns === 'boolean'
    ? (body.allTicketColumns ? 1 : 0)
    : existing.all_ticket_columns
  const ticketColumns = Array.isArray(body.ticketColumns)
    ? body.ticketColumns.filter((k): k is string => typeof k === 'string')
    : safeJsonParse<string[]>(existing.ticket_columns, [])

  try {
    await db.execute(
      `UPDATE saved_export_presets
       SET name = ?, collection_id = ?,
           all_submission_columns = ?, submission_columns = ?,
           ticket_template_id = ?, all_ticket_columns = ?, ticket_columns = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
      [
        name,
        collectionId,
        allSubmissionColumns,
        JSON.stringify(submissionColumns),
        ticketTemplateId,
        allTicketColumns,
        JSON.stringify(ticketColumns),
        presetId,
      ]
    )

    const updated = await db.queryOne<DbPreset>(
      `SELECT id, created_by_user_id, name, all_submission_columns, submission_columns,
              ticket_template_id, all_ticket_columns, ticket_columns, created_at, updated_at
       FROM saved_export_presets
       WHERE id = ?`,
      [presetId]
    )

    if (!updated) {
      res.status(500).json({ error: 'Failed to load updated preset' })
      return
    }

    res.json({
      id: updated.id,
      name: updated.name,
      allSubmissionColumns: updated.all_submission_columns === 1,
      submissionColumns: safeJsonParse<string[]>(updated.submission_columns, []),
      ticketTemplateId: updated.ticket_template_id,
      allTicketColumns: updated.all_ticket_columns === 1,
      ticketColumns: safeJsonParse<string[]>(updated.ticket_columns, []),
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    })
  } catch (err) {
    const message = (err as Error).message ?? ''
    if (message.includes('UNIQUE constraint failed') || /unique constraint/i.test(message)) {
      res.status(409).json({ error: 'A preset with that name already exists for this collection' })
      return
    }
    console.error('[export-csv] update preset:', err)
    res.status(500).json({ error: 'Failed to update preset' })
  }
})

router.delete('/presets/:presetId', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  if (!canViewResponses(context)) {
    res.status(403).json({ error: 'You do not have permission to delete export presets' })
    return
  }

  const presetId = parseInt(req.params.presetId, 10)
  if (isNaN(presetId)) {
    res.status(400).json({ error: 'Invalid preset ID' })
    return
  }

  const db = await getDbAsync()
  const existing = await db.queryOne<{ id: number; organization_id: number }>(
    'SELECT id, organization_id FROM saved_export_presets WHERE id = ?',
    [presetId]
  )
  if (!existing) {
    res.status(404).json({ error: 'Preset not found' })
    return
  }

  if (!canViewAllResponses(context) && existing.organization_id !== context.organizationId) {
    res.status(403).json({ error: 'You do not have permission to delete this preset' })
    return
  }

  await db.execute('DELETE FROM saved_export_presets WHERE id = ?', [presetId])
  res.status(204).send()
})

// ── Internal helpers ──────────────────────────────────────────

async function buildSchema(db: DbAdapter, collectionId: number, isAnonymous: boolean, activeVersionId: number | null): Promise<ExportSchemaResponse> {
  const fields = await fetchSubmissionFields(db, collectionId, activeVersionId)
  const submissionColumns: ExportColumn[] = [
    { fieldId: null, key: 'id', label: 'Submission ID' },
    { fieldId: null, key: 'submittedAt', label: 'Submitted At' },
  ]

  if (!isAnonymous) {
    submissionColumns.push(
      { fieldId: null, key: 'respondentName', label: 'Respondent Name' },
      { fieldId: null, key: 'respondentEmail', label: 'Respondent Email' }
    )
  }

  for (const field of fields) {
    submissionColumns.push({
      fieldId: field.id,
      // Use field_key as the stable column key so it survives version changes.
      key: field.field_key ?? `field-${field.id}`,
      label: field.label,
    })
  }

  const templates = await fetchTicketTemplatesForCollection(db, collectionId)
  const ticketTemplates: ExportTicketTemplate[] = []
  for (const template of templates) {
    const ticketFields = await fetchTicketFieldsForTemplate(db, template.id)
    const columns: ExportColumn[] = [
      { fieldId: null, key: 'status', label: 'Status' },
      { fieldId: null, key: 'finalizedAt', label: 'Closed At' },
      { fieldId: null, key: 'finalizedByName', label: 'Closed By' },
      { fieldId: null, key: 'filledAt', label: 'Filled At' },
    ]
    for (const field of ticketFields) {
      columns.push({
        fieldId: field.id,
        key: `field-${field.id}`,
        label: field.label,
      })
    }
    ticketTemplates.push({ templateId: template.id, title: template.title, columns })
  }

  return { submissionColumns, ticketTemplates }
}

function toSafeFilename(title: string): string {
  return (title.trim() || 'export')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'export'
}

export default router
