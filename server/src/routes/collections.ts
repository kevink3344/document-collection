import { Router, type Request, type Response } from 'express'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { getDb } from '../database/db'
import { authenticateToken, JWT_SECRET } from '../middleware/auth'
import { loadRequestUserContext, isAdministrator, canViewResponses, canViewAllResponses, type RequestUserContext } from '../middleware/organizationAccess'
import { sendNotificationEmail, isEmailDeliveryConfigured } from '../services/notificationEmail'

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
  | 'short_text' | 'date' | 'long_text' | 'single_choice' | 'multiple_choice'
  | 'attachment' | 'signature' | 'confirmation' | 'custom_table' | 'rating' | 'comment' | 'matrix_likert_scale'
  | 'location'

type ColType = 'text' | 'number' | 'date' | 'checkbox' | 'list'

interface FieldBranchRule {
  value: string
  targetFieldKey: string | null
}

interface DbCollection {
  id: number
  slug: string
  title: string
  status: 'draft' | 'published'
  description: string | null
  category: string | null
  organization_id: number
  organization_name?: string | null
  created_by: number
  date_due: string | null
  cover_photo_url: string | null
  logo_url: string | null
  instructions: string | null
  instructions_doc_url: string | null
  active_version_id: number | null
  active_version_number?: number | null
  active_version_status?: 'draft' | 'published' | null
  anonymous: number
  allow_submission_edits: number
  submission_edit_window_hours: number | null
  location_id: number | null
  created_at: string
  updated_at: string
  creator_name?: string
}

interface DbField {
  id: number
  collection_id: number
  version_id: number | null
  field_key: string | null
  type: FieldType
  label: string
  page_number: number
  required: number
  options: string | null
  display_style: string
  branch_rules: string | null
  sort_order: number
  staff_only: number
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

interface SeedCollectionBody {
  count?: number
}

// ── Request body types ────────────────────────────────────────

interface TableColumnInput {
  name: string
  colType: ColType
  listOptions?: string[]
  sortOrder?: number
}

interface FieldInput {
  fieldKey?: string
  type: FieldType
  label: string
  page?: number
  required?: boolean
  options?: string[]
  displayStyle?: string
  branchRules?: FieldBranchRule[]
  tableColumns?: TableColumnInput[]
  sortOrder?: number
  staffOnly?: boolean
}

function parseBranchRules(raw: string | null): FieldBranchRule[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    const rules = parsed
      .map(rule => {
        if (!rule || typeof rule !== 'object') return null
        const value = 'value' in rule ? String(rule.value ?? '').trim() : ''
        const targetRaw = 'targetFieldKey' in rule ? rule.targetFieldKey : null
        const targetFieldKey =
          targetRaw === null || targetRaw === undefined || targetRaw === ''
            ? null
            : String(targetRaw).trim()
        if (!value) return null
        if (targetFieldKey !== null && targetFieldKey === '') {
          return null
        }
        return { value, targetFieldKey }
      })
      .filter((rule): rule is FieldBranchRule => rule !== null)
    return rules.length > 0 ? rules : null
  } catch {
    return null
  }
}

function serialiseBranchRules(rules?: FieldBranchRule[]): string | null {
  const normalized = (rules ?? [])
    .map(rule => ({
      value: String(rule.value ?? '').trim(),
      targetFieldKey:
        rule.targetFieldKey === null || rule.targetFieldKey === undefined
          ? null
          : String(rule.targetFieldKey).trim(),
    }))
    .filter(
      rule =>
        rule.value !== '' &&
        (rule.targetFieldKey === null || rule.targetFieldKey !== '')
    )

  return normalized.length > 0 ? JSON.stringify(normalized) : null
}

interface CollectionBody {
  title: string
  status?: 'draft' | 'published'
  organizationId?: number
  description?: string
  category?: string
  dateDue?: string
  coverPhotoUrl?: string
  logoUrl?: string
  instructions?: string
  instructionsDocUrl?: string
  anonymous?: boolean
  allowSubmissionEdits?: boolean
  submissionEditWindowHours?: number
  locationId?: number | null
  fields?: FieldInput[]
}

function resolveFieldDisplayStyle(type: FieldType, displayStyle?: string): string {
  if (type === 'single_choice') {
    return displayStyle === 'dropdown' ? 'dropdown' : 'radio'
  }

  if (type === 'rating') {
    return displayStyle === 'numbers' ? 'numbers' : 'stars'
  }

  return 'radio'
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

function getPreviewUserContext(req: Request): RequestUserContext | null {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    return null
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub?: unknown }
    if (typeof payload.sub !== 'number') {
      return null
    }

    req.user = {
      sub: payload.sub,
      role: (payload as { role?: 'super_admin' | 'administrator' | 'team_manager' | 'user' }).role ?? 'user',
      organizationId: (payload as { organizationId?: number | null }).organizationId,
      organizationName: (payload as { organizationName?: string | null }).organizationName,
    }

    return loadRequestUserContext(req)
  } catch {
    return null
  }
}

function resolveCollectionOrganization(
  context: RequestUserContext,
  requestedOrganizationId: number | undefined,
): { id: number; name: string } {
  const db = getDb()

  const resolvedId = isAdministrator(context)
    ? requestedOrganizationId ?? context.organizationId ?? null
    : context.organizationId

  if (!resolvedId) {
    throw new Error('An organization assignment is required')
  }

  const organization = db
    .prepare('SELECT id, name FROM organizations WHERE id = ? AND is_active = 1')
    .get(resolvedId) as unknown as { id: number; name: string } | undefined

  if (!organization) {
    throw new Error('Selected organization does not exist')
  }

  return organization
}

function fetchAccessibleCollectionById(
  id: number,
  context: RequestUserContext,
): DbCollection | undefined {
  const db = getDb()
  return db
    .prepare(`${COL_SELECT} WHERE c.id = ? AND c.organization_id = ?`)
    .get(id, context.organizationId) as unknown as DbCollection | undefined
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
    organizationId: c.organization_id,
    organizationName: c.organization_name ?? null,
    createdBy: c.created_by,
    createdByName: c.creator_name ?? null,
    dateDue: c.date_due,
    coverPhotoUrl: c.cover_photo_url,
    logoUrl: c.logo_url,
    instructions: c.instructions,
    instructionsDocUrl: c.instructions_doc_url,
    activeVersionId: c.active_version_id,
    currentVersionNumber: c.active_version_number ?? null,
    currentVersionStatus: c.active_version_status ?? null,
    anonymous: c.anonymous === 1,
    allowSubmissionEdits: c.allow_submission_edits === 1,
    submissionEditWindowHours: c.submission_edit_window_hours,
    locationId: c.location_id,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    fields: fields.map(f => ({
      id: f.id,
      fieldKey: f.field_key ?? `field-${f.id}`,
      type: f.type,
      label: f.label,
      page: Number(f.page_number) || 1,
      required: f.required === 1,
      options: f.options ? (JSON.parse(f.options) as string[]) : null,
      displayStyle: resolveFieldDisplayStyle(f.type, f.display_style),
      branchRules: parseBranchRules(f.branch_rules),
      sortOrder: f.sort_order,
      staffOnly: f.staff_only === 1,
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
           (collection_id, version_id, field_key, type, label, page_number, required, options, display_style, branch_rules, sort_order, staff_only)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        collectionId,
        null,
        field.fieldKey?.trim() || crypto.randomUUID(),
        field.type,
        field.label,
        Math.max(1, Math.floor(field.page ?? 1)),
        field.required ? 1 : 0,
        field.options?.length ? JSON.stringify(field.options) : null,
        resolveFieldDisplayStyle(field.type, field.displayStyle),
        serialiseBranchRules(field.branchRules),
        field.sortOrder ?? idx,
        field.staffOnly ? 1 : 0
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
           (collection_id, version_id, field_key, type, label, page_number, required, options, display_style, branch_rules, sort_order, staff_only)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        collectionId,
        versionId,
        field.fieldKey?.trim() || crypto.randomUUID(),
        field.type,
        field.label,
        Math.max(1, Math.floor(field.page ?? 1)),
        field.required ? 1 : 0,
        field.options?.length ? JSON.stringify(field.options) : null,
        resolveFieldDisplayStyle(field.type, field.displayStyle),
        serialiseBranchRules(field.branchRules),
        field.sortOrder ?? idx,
        field.staffOnly ? 1 : 0
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

type SeedRandomSource = () => number

const SEED_FIRST_NAMES = ['Alex', 'Jordan', 'Taylor', 'Morgan', 'Sam', 'Riley', 'Casey', 'Jamie', 'Avery', 'Cameron']
const SEED_LAST_NAMES = ['Parker', 'Reed', 'Morgan', 'Hayes', 'Brooks', 'Bennett', 'Coleman', 'Bailey', 'Foster', 'Diaz']
const SEED_DEPARTMENTS = ['HR', 'Operations', 'Finance', 'Marketing', 'IT', 'Facilities', 'Support', 'Compliance']
const SEED_CITIES = ['Seattle', 'Austin', 'Chicago', 'Denver', 'Boston', 'Miami', 'Atlanta', 'Phoenix']
const SEED_SENTENCES = [
  'Completed during seeded demo run.',
  'Captured for workflow testing and reporting previews.',
  'Sample response created from the settings utility.',
  'Used to verify records, exports, and filtering behavior.',
]

function createSeededRandomSource(collectionId: number, submissionIndex: number): SeedRandomSource {
  const hash = crypto
    .createHash('sha256')
    .update(`seed:${collectionId}:${submissionIndex}`)
    .digest()
  let state = hash.readUInt32LE(0) || 1
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function pickSeedValue<T>(items: T[], random: SeedRandomSource): T {
  return items[Math.floor(random() * items.length)]
}

function parseFieldOptions(field: DbField): string[] {
  if (!field.options) return []
  try {
    const parsed = JSON.parse(field.options) as unknown
    return Array.isArray(parsed)
      ? parsed.map(option => String(option).trim()).filter(option => option !== '' && option !== '__DCP_OTHER_OPTION__')
      : []
  } catch {
    return []
  }
}

function isoDateFromOffset(offsetDays: number): string {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

function formatSqliteDateTime(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

function buildSeededSubmittedAt(random: SeedRandomSource): string {
  const date = new Date()
  const daysBack = Math.floor(random() * 30)
  date.setDate(date.getDate() - daysBack)

  const dayOfWeek = date.getDay()
  if (dayOfWeek === 0) {
    date.setDate(date.getDate() - 2)
  } else if (dayOfWeek === 6) {
    date.setDate(date.getDate() - 1)
  }

  const hour = 8 + Math.floor(random() * 10)
  const minute = Math.floor(random() * 60)
  const second = Math.floor(random() * 60)
  date.setHours(hour, minute, second, 0)

  return formatSqliteDateTime(date)
}

function buildSeededName(random: SeedRandomSource, submissionIndex: number): string {
  return `${pickSeedValue(SEED_FIRST_NAMES, random)} ${pickSeedValue(SEED_LAST_NAMES, random)} ${submissionIndex + 1}`
}

function buildSeededText(field: DbField, random: SeedRandomSource, submissionIndex: number): string {
  const label = field.label.toLowerCase()
  if (label.includes('department') || label.includes('team')) {
    return pickSeedValue(SEED_DEPARTMENTS, random)
  }
  if (label.includes('city') || label.includes('location')) {
    return pickSeedValue(SEED_CITIES, random)
  }
  if (label.includes('name')) {
    return buildSeededName(random, submissionIndex)
  }
  return `Sample ${field.label || 'response'} ${submissionIndex + 1}`
}

function buildSeededLongText(field: DbField, random: SeedRandomSource, submissionIndex: number): string {
  return `${buildSeededText(field, random, submissionIndex)}. ${pickSeedValue(SEED_SENTENCES, random)}`
}

function buildSeededCustomTableValue(columns: DbTableColumn[], random: SeedRandomSource, submissionIndex: number): string {
  const rowCount = 1 + Math.floor(random() * 3)
  const rows = Array.from({ length: rowCount }, (_, rowIndex) => {
    const row: Record<string, string> = {}
    for (const column of columns) {
      const label = column.name || `Column ${rowIndex + 1}`
      switch (column.col_type) {
        case 'number':
          row[label] = String(10 + Math.floor(random() * 90))
          break
        case 'date':
          row[label] = isoDateFromOffset(Math.floor(random() * 45) - 15)
          break
        case 'checkbox':
          row[label] = random() > 0.5 ? 'true' : 'false'
          break
        case 'list': {
          const options = (() => {
            try {
              const parsed = column.list_options ? (JSON.parse(column.list_options) as unknown) : []
              return Array.isArray(parsed) ? parsed.map(option => String(option).trim()).filter(Boolean) : []
            } catch {
              return []
            }
          })()
          row[label] = options.length > 0 ? pickSeedValue(options, random) : `Option ${rowIndex + 1}`
          break
        }
        default:
          row[label] = `Seed ${submissionIndex + 1}-${rowIndex + 1}`
          break
      }
    }
    return row
  })
  return JSON.stringify(rows)
}

function buildSeededMatrixValue(field: DbField, random: SeedRandomSource): string | null {
  const [rawConfig] = parseFieldOptions(field)
  if (!rawConfig) return null
  try {
    const parsed = JSON.parse(rawConfig) as { rows?: unknown; columns?: unknown }
    const rows = Array.isArray(parsed.rows) ? parsed.rows.map(row => String(row)) : []
    const columns = Array.isArray(parsed.columns) ? parsed.columns.map(column => String(column)) : []
    if (rows.length === 0 || columns.length === 0) return null
    const value: Record<number, string> = {}
    rows.forEach((_, rowIndex) => {
      value[rowIndex] = pickSeedValue(columns, random)
    })
    return JSON.stringify(value)
  } catch {
    return null
  }
}

function buildSeededFieldValue(
  field: DbField,
  tableColumns: DbTableColumn[],
  random: SeedRandomSource,
  submissionIndex: number
): string | null {
  switch (field.type) {
    case 'short_text':
      return buildSeededText(field, random, submissionIndex)
    case 'long_text':
      return buildSeededLongText(field, random, submissionIndex)
    case 'date':
      return isoDateFromOffset(Math.floor(random() * 60) - 20)
    case 'single_choice': {
      const options = parseFieldOptions(field)
      return options.length > 0 ? pickSeedValue(options, random) : null
    }
    case 'multiple_choice': {
      const options = parseFieldOptions(field)
      if (options.length === 0) return null
      const shuffled = [...options].sort(() => random() - 0.5)
      const count = Math.min(shuffled.length, 1 + Math.floor(random() * Math.min(3, shuffled.length)))
      return JSON.stringify(shuffled.slice(0, count))
    }
    case 'attachment':
      return `https://example.com/seeded/${field.id ?? submissionIndex + 1}-${submissionIndex + 1}.pdf`
    case 'signature':
      return `Seeded signature ${submissionIndex + 1}`
    case 'confirmation':
      return random() > 0.35 ? 'true' : 'false'
    case 'custom_table':
      return tableColumns.length > 0 ? buildSeededCustomTableValue(tableColumns, random, submissionIndex) : JSON.stringify([])
    case 'rating':
      return String(1 + Math.floor(random() * 5))
    case 'matrix_likert_scale':
      return buildSeededMatrixValue(field, random)
    case 'comment':
      return null
    case 'location':
      return null
    default:
      return null
  }
}

function normaliseIncomingFields(fields: FieldInput[]): string {
  return JSON.stringify(
    fields.map((f, i) => ({
      fieldKey: String(f.fieldKey ?? '').trim(),
      type: f.type,
      label: (f.label ?? '').trim(),
      page: Math.max(1, Math.floor(f.page ?? 1)),
      required: !!f.required,
      options: (f.options ?? []).map(o => o.trim()).filter(Boolean),
      displayStyle: resolveFieldDisplayStyle(f.type, f.displayStyle),
      branchRules: (f.branchRules ?? [])
        .map(rule => ({
          value: String(rule.value ?? '').trim(),
          targetFieldKey:
            rule.targetFieldKey === null || rule.targetFieldKey === undefined
              ? null
              : String(rule.targetFieldKey).trim(),
        }))
        .filter(
          rule =>
            rule.value !== '' &&
            (rule.targetFieldKey === null || rule.targetFieldKey !== '')
        ),
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
      staffOnly: !!f.staffOnly,
    }))
  )
}

function normaliseDbFields(fields: DbField[], colsByField: Map<number, DbTableColumn[]>): string {
  return JSON.stringify(
    fields.map((f, i) => ({
      fieldKey: f.field_key ?? `field-${f.id}`,
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
      displayStyle: resolveFieldDisplayStyle(f.type, f.display_style ?? undefined),
      branchRules: parseBranchRules(f.branch_rules) ?? [],
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
      staffOnly: f.staff_only === 1,
    }))
  )
}

const COL_SELECT = `
  SELECT c.*, u.name AS creator_name, o.name AS organization_name,
         cv.version_number AS active_version_number,
         cv.status AS active_version_status
  FROM collections c
  LEFT JOIN users u ON u.id = c.created_by
  LEFT JOIN organizations o ON o.id = c.organization_id
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
  const previewUser = previewRequested ? getPreviewUserContext(req) : null
  const c = db
    .prepare(`${COL_SELECT} WHERE c.slug = ?`)
    .get(req.params.slug) as unknown as DbCollection | undefined

  const canPreviewDraft =
    !!previewUser &&
    previewUser.organizationId === c?.organization_id

  if (!c || (c.status !== 'published' && !canPreviewDraft)) {
    res.status(404).json({ error: 'Collection not found' })
    return
  }
  const [allFields, colsByField] = fetchFields(c.id, c.active_version_id)
  // Strip staff-only fields — the fill page is for submitters, not staff
  const publicFields = allFields.filter(f => !f.staff_only)
  res.json(toApiCollection(c, publicFields, colsByField))
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
    .prepare('SELECT id, title, anonymous, status, active_version_id, allow_submission_edits, submission_edit_window_hours FROM collections WHERE slug = ?')
    .get(req.params.slug) as unknown as {
      id: number
      title: string
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
    copyEmail?: string
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

    // Send confirmation email if the feature is enabled and the respondent provided an email
    const respondentEmail = body.respondentEmail?.trim()
    if (respondentEmail && isEmailDeliveryConfigured()) {
      const settingRow = db
        .prepare(`SELECT value FROM app_settings WHERE key = 'submission_confirmation_emails'`)
        .get() as { value: string } | undefined
      if (settingRow?.value === 'true') {
        void sendNotificationEmail({
          to: respondentEmail,
          subject: `Submission received – ${col.title}`,
          text: [
            `Hi ${body.respondentName?.trim() ?? 'there'},`,
            '',
            `Thank you for your submission to "${col.title}". We have received your response.`,
            '',
            'If you have any questions, please contact the collection administrator.',
          ].join('\n'),
        }).catch(err => console.error('[collections] confirmation email error:', err))
      }
    }

    // Send copy-of-answers email if the respondent requested one
    const copyEmail = body.copyEmail?.trim()
    if (copyEmail && isEmailDeliveryConfigured()) {
      try {
        const [fields] = fetchFields(col.id, col.active_version_id)
        const fieldMap = new Map(fields.map(f => [f.id, f]))

        const answerLines: string[] = []
        for (const val of body.values ?? []) {
          const field = fieldMap.get(val.fieldId)
          if (!field) continue
          // Skip non-input field types
          if (field.type === 'comment') continue
          let displayValue = val.value ?? ''
          // Decode multiple_choice JSON arrays
          if (field.type === 'multiple_choice') {
            try {
              const arr = JSON.parse(displayValue) as string[]
              displayValue = Array.isArray(arr)
                ? arr
                    .map(item =>
                      item.startsWith('__DCP_OTHER__::') ? item.slice('__DCP_OTHER__::'.length) : item
                    )
                    .join(', ')
                : displayValue
            } catch { /* use raw */ }
          } else if (displayValue.startsWith('__DCP_OTHER__::')) {
            displayValue = displayValue.slice('__DCP_OTHER__::'.length)
          }
          if (!displayValue.trim()) continue
          answerLines.push(`${field.label}\n${displayValue}`)
        }

        const disclaimerRow = db
          .prepare(`SELECT value FROM app_settings WHERE key = 'copy_answers_disclaimer'`)
          .get() as { value: string } | undefined
        const disclaimer =
          disclaimerRow?.value?.trim() ||
          'For privacy your email will not be saved by the system. It will only be used for this purpose.'

        void sendNotificationEmail({
          to: copyEmail,
          subject: `Your answers – ${col.title}`,
          text: [
            `Here are your submitted answers for "${col.title}":`,
            '',
            ...answerLines.flatMap(line => [line, '']),
            '---',
            disclaimer,
          ].join('\n'),
        }).catch(err => console.error('[collections] copy-of-answers email error:', err))
      } catch (err) {
        console.error('[collections] copy-of-answers email build error:', err)
      }
    }

    res.status(201).json({ id: responseId, submitted: true })
  } catch (err) {
    db.exec('ROLLBACK')
    console.error('[collections] submit response:', err)
    res.status(500).json({ error: 'Failed to submit response' })
  }
})

router.post('/:id/seed', authenticateToken, (req: Request, res: Response) => {
  if (req.user?.role !== 'administrator') {
    res.status(403).json({ error: 'Administrator access required' })
    return
  }

  const id = parseInt(req.params.id, 10)
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid collection ID' })
    return
  }

  const body = req.body as SeedCollectionBody
  const count = Math.floor(Number(body.count ?? 0))
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    res.status(400).json({ error: 'count must be an integer between 1 and 20' })
    return
  }

  const db = getDb()
  const collection = db
    .prepare('SELECT id, title, anonymous, active_version_id FROM collections WHERE id = ?')
    .get(id) as { id: number; title: string; anonymous: number; active_version_id: number | null } | undefined

  if (!collection) {
    res.status(404).json({ error: 'Collection not found' })
    return
  }

  if (!collection.active_version_id) {
    res.status(400).json({ error: 'Collection does not have an active version to seed' })
    return
  }

  const [fields, colsByField] = fetchFields(collection.id, collection.active_version_id)
  if (fields.length === 0) {
    res.status(400).json({ error: 'Collection does not have any fields to seed' })
    return
  }

  db.exec('BEGIN')
  try {
    for (let submissionIndex = 0; submissionIndex < count; submissionIndex += 1) {
      const random = createSeededRandomSource(collection.id, submissionIndex)
      const respondentName = collection.anonymous === 1 ? null : buildSeededName(random, submissionIndex)
      const respondentEmail = collection.anonymous === 1
        ? null
        : `${respondentName?.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '')}@seed.example.com`
      const submittedAt = buildSeededSubmittedAt(random)

      const insertedResponse = db
        .prepare(
          `INSERT INTO collection_responses
             (collection_id, collection_version_id, respondent_name, respondent_email, editable_until, submitted_at)
           VALUES (?, ?, ?, ?, NULL, ?)`
        )
        .run(collection.id, collection.active_version_id, respondentName, respondentEmail, submittedAt)

      const responseId = insertedResponse.lastInsertRowid as number

      for (const field of fields) {
        if (field.id === undefined) continue
        const value = buildSeededFieldValue(field, colsByField.get(field.id) ?? [], random, submissionIndex)
        if (value === null || value === '') continue

        db.prepare(
          `INSERT INTO collection_response_values (response_id, field_id, value)
           VALUES (?, ?, ?)`
        ).run(responseId, field.id, value)
      }
    }

    db.exec('COMMIT')
    res.status(201).json({ created: count, collectionId: collection.id, collectionTitle: collection.title })
  } catch (err) {
    db.exec('ROLLBACK')
    console.error('[collections] seed:', err)
    res.status(500).json({ error: 'Failed to seed collection data' })
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
  const context = loadRequestUserContext(_req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const db = getDb()
  const cols = db
    .prepare(`${COL_SELECT} WHERE c.organization_id = ? ORDER BY c.created_at DESC`)
    .all(context.organizationId) as unknown as DbCollection[]

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
  const context = loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const body = req.body as CollectionBody
  if (!body.title?.trim()) {
    res.status(400).json({ error: 'title is required' })
    return
  }

  const db = getDb()
  const slug = generateUniqueSlug(db, body.title)
  let organization: { id: number; name: string }
  let category: string | null
  let editSettings: { allowSubmissionEdits: boolean; submissionEditWindowHours: number | null }

  try {
    organization = resolveCollectionOrganization(context, body.organizationId)
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
            logo_url, instructions, instructions_doc_url, organization_id, anonymous, allow_submission_edits,
            submission_edit_window_hours, location_id, active_version_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
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
        body.logoUrl ?? null,
        body.instructions ?? null,
        body.instructionsDocUrl ?? null,
        organization.id,
        body.anonymous ? 1 : 0,
        editSettings.allowSubmissionEdits ? 1 : 0,
        editSettings.submissionEditWindowHours,
        body.locationId ?? null
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

  const context = loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const c = fetchAccessibleCollectionById(id, context)

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

  const context = loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const body = req.body as CollectionBody
  if (!body.title?.trim()) {
    res.status(400).json({ error: 'title is required' })
    return
  }

  let organization: { id: number; name: string }
  let category: string | null
  let editSettings: { allowSubmissionEdits: boolean; submissionEditWindowHours: number | null }

  try {
    organization = resolveCollectionOrganization(context, body.organizationId)
    category = ensureCategoryExists(normalizeCategory(body.category))
    editSettings = resolveSubmissionEditSettings(body)
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
    return
  }

  const db = getDb()
  const existingCollection = fetchAccessibleCollectionById(id, context)

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
           logo_url = ?, instructions = ?, instructions_doc_url = ?, organization_id = ?, anonymous = ?, allow_submission_edits = ?,
           submission_edit_window_hours = ?, location_id = ?, active_version_id = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      body.title.trim(),
      requestedStatus,
      body.description?.trim() ?? null,
      category,
      body.dateDue ?? null,
      body.coverPhotoUrl ?? null,
      body.logoUrl ?? null,
      body.instructions ?? null,
      body.instructionsDocUrl ?? null,
      organization.id,
      body.anonymous ? 1 : 0,
      editSettings.allowSubmissionEdits ? 1 : 0,
      editSettings.submissionEditWindowHours,
      body.locationId ?? null,
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

  const context = loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const db = getDb()
  const collection = fetchAccessibleCollectionById(id, context)

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

  const context = loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const db = getDb()
  const collection = fetchAccessibleCollectionById(id, context)

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

  const context = loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const body = req.body as CollectionBody
  if (!body.title?.trim()) {
    res.status(400).json({ error: 'title is required' })
    return
  }

  const db = getDb()
  const collection = fetchAccessibleCollectionById(id, context)

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
           logo_url = ?, instructions = ?, instructions_doc_url = ?, anonymous = ?, active_version_id = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      body.title.trim(),
      requestedStatus,
      body.description?.trim() ?? null,
      category,
      body.dateDue ?? null,
      body.coverPhotoUrl ?? null,
      body.logoUrl ?? null,
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

  const context = loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const accessibleCollection = fetchAccessibleCollectionById(id, context)
  if (!accessibleCollection) {
    res.status(404).json({ error: 'Collection not found' })
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

  const context = loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const db = getDb()
  const exists = fetchAccessibleCollectionById(id, context)
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

  const context = loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  // Plain users cannot view collection results
  if (!canViewResponses(context)) {
    res.status(403).json({ error: 'You do not have permission to view collection results' })
    return
  }

  const db = getDb()
  const collection = fetchAccessibleCollectionById(id, context)
  if (!collection) {
    res.status(404).json({ error: 'Collection not found' })
    return
  }

  // Determine whether to apply location filtering.
  // Reviewers: only see responses where the 'location' field value matches one of their assigned locations.
  // Higher roles: see everything.
  let responses: DbResponse[]

  if (!canViewAllResponses(context)) {
    // Find the location field in this collection (if any)
    const locationField = db
      .prepare(
        `SELECT id FROM collection_fields WHERE collection_id = ? AND type = 'location' LIMIT 1`
      )
      .get(id) as unknown as { id: number } | undefined

    if (locationField) {
      // Get the reviewer's assigned location names
      const assignedLocations = db
        .prepare(
          `SELECT l.name FROM user_locations ul
           JOIN locations l ON l.id = ul.location_id
           WHERE ul.user_id = ?`
        )
        .all(context.id) as unknown as Array<{ name: string }>
      const locationNames = assignedLocations.map(l => l.name)

      if (locationNames.length === 0) {
        res.json([])
        return
      }

      // Find response IDs where the location field value is in the reviewer's locations
      const ph = locationNames.map(() => '?').join(',')
      const matchingResponseIds = db
        .prepare(
          `SELECT DISTINCT rv.response_id
           FROM collection_response_values rv
           WHERE rv.field_id = ? AND rv.value IN (${ph})`
        )
        .all(locationField.id, ...locationNames) as unknown as Array<{ response_id: number }>
      const ids = matchingResponseIds.map(r => r.response_id)

      if (ids.length === 0) {
        res.json([])
        return
      }

      const idPh = ids.map(() => '?').join(',')
      responses = db
        .prepare(
          `SELECT * FROM collection_responses
           WHERE collection_id = ? AND id IN (${idPh})
           ORDER BY submitted_at DESC`
        )
        .all(id, ...ids) as unknown as DbResponse[]
    } else {
      // No location field in this collection — reviewer sees all responses
      responses = db
        .prepare(
          'SELECT * FROM collection_responses WHERE collection_id = ? ORDER BY submitted_at DESC'
        )
        .all(id) as unknown as DbResponse[]
    }
  } else {
    responses = db
      .prepare(
        'SELECT * FROM collection_responses WHERE collection_id = ? ORDER BY submitted_at DESC'
      )
      .all(id) as unknown as DbResponse[]
  }

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

/**
 * PUT /api/collections/:id/responses/:responseId/staff-fields
 * Upsert values for staff-only fields on a specific response. Staff roles only.
 */
router.put('/:id/responses/:responseId/staff-fields', authenticateToken, (req: Request, res: Response): void => {
  const id = parseInt(req.params.id, 10)
  const responseId = parseInt(req.params.responseId, 10)
  if (isNaN(id) || isNaN(responseId)) {
    res.status(400).json({ error: 'Invalid ID' })
    return
  }

  const context = loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }
  if (context.role === 'user') {
    res.status(403).json({ error: 'Staff access required' })
    return
  }

  const body = req.body as { values?: { fieldId: number; value: string }[] }
  if (!Array.isArray(body.values)) {
    res.status(400).json({ error: 'values array is required' })
    return
  }
  const bodyValues = body.values

  try {
    const db = getDb()

    // Verify collection is accessible to this staff member
    const collection = fetchAccessibleCollectionById(id, context)
    if (!collection) {
      res.status(404).json({ error: 'Collection not found' })
      return
    }

    // Verify response belongs to collection
    const responseRow = db
      .prepare('SELECT id FROM collection_responses WHERE id = ? AND collection_id = ?')
      .get(responseId, id) as { id: number } | undefined
    if (!responseRow) {
      res.status(404).json({ error: 'Response not found' })
      return
    }

    // Validate all provided fieldIds are staff-only fields for this collection
    if (body.values.length > 0) {
      const fieldIds = body.values.map(v => v.fieldId)
      const ph = fieldIds.map(() => '?').join(',')
      const staffFields = db
        .prepare(
          `SELECT id FROM collection_fields WHERE id IN (${ph}) AND staff_only = 1 AND collection_id = ?`
        )
        .all(...fieldIds, id) as { id: number }[]
      const staffFieldIds = new Set(staffFields.map(f => f.id))
      const badId = fieldIds.find(fid => !staffFieldIds.has(fid))
      if (badId !== undefined) {
        res.status(400).json({ error: `Field ${badId} is not a staff-only field for this collection` })
        return
      }
    }

    // Upsert values inside a transaction
    db.transaction(() => {
      for (const val of bodyValues) {
        const existing = db
          .prepare('SELECT id FROM collection_response_values WHERE response_id = ? AND field_id = ?')
          .get(responseId, val.fieldId) as { id: number } | undefined
        if (existing) {
          db.prepare('UPDATE collection_response_values SET value = ? WHERE response_id = ? AND field_id = ?')
            .run(val.value ?? null, responseId, val.fieldId)
        } else {
          db.prepare('INSERT INTO collection_response_values (response_id, field_id, value) VALUES (?, ?, ?)')
            .run(responseId, val.fieldId, val.value ?? null)
        }
      }
    })()

    res.json({ ok: true })
  } catch (err) {
    console.error('[collections] staff-fields upsert:', err)
    res.status(500).json({ error: 'Failed to save staff fields' })
  }
})

export default router
