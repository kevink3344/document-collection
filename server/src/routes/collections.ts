import { Router, type Request, type Response } from 'express'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import { getDb } from '../database/db'
import { authenticateToken, JWT_SECRET, optionalAuthenticateToken } from '../middleware/auth'
import { loadRequestUserContext, isAdministrator, canViewResponses, canViewAllResponses, type RequestUserContext } from '../middleware/organizationAccess'
import { parseAttachmentValue, stringifyAttachmentValue, type AttachmentReference } from '../lib/attachmentValue'
import { deleteDriveFile, downloadDriveFile, isGoogleDriveConfigured, uploadBufferToDrive } from '../services/googleDrive'
import { sendNotificationEmail, isEmailDeliveryConfigured } from '../services/notificationEmail'
import {
  actOnWorkflowStage,
  getWorkflowSummaryForResponse,
  initializeWorkflowForResponse,
  parseWorkflowDefinition,
  serializeWorkflowDefinition,
  type ApprovalWorkflowDefinition,
} from '../services/approvalWorkflows'

const router = Router()
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
})

const MAX_ATTACHMENTS_PER_FIELD = 5

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
  | 'document'
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
  organization_description?: string | null
  created_by: number
  date_due: string | null
  cover_photo_url: string | null
  cover_photo_asset_id: number | null
  logo_url: string | null
  instructions: string | null
  instructions_doc_url: string | null
  workflow_definition: string | null
  source_template_collection_id: number | null
  template_usage_count?: number | null
  active_version_id: number | null
  active_version_number?: number | null
  active_version_status?: 'draft' | 'published' | null
  anonymous: number
  allow_submission_edits: number
  submission_edit_window_hours: number | null
  collection_type: 'standard' | 'signup_sheet'
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
  subtitle: string | null
  page_number: number
  required: number
  options: string | null
  display_style: string
  branch_rules: string | null
  sort_order: number
  staff_only: number
  location_filter_enabled: number
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
  field_label?: string | null
  staff_updated_by_name: string | null
  staff_updated_at: string | null
}

interface SeedCollectionBody {
  count?: number
}

interface DbAttachmentRow {
  id: number
  collection_id: number
  response_id: number | null
  field_id: number
  uploaded_by_user_id: number | null
  temp_upload_token: string | null
  file_name: string
  mime_type: string
  size_bytes: number
  drive_file_id: string
  drive_web_view_url: string | null
  drive_download_url: string | null
  file_data: string | null
  status: 'uploaded' | 'linked' | 'deleted'
  respondent_email?: string | null
  organization_id?: number | null
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
  subtitle?: string
  page?: number
  required?: boolean
  options?: string[]
  displayStyle?: string
  branchRules?: FieldBranchRule[]
  tableColumns?: TableColumnInput[]
  sortOrder?: number
  staffOnly?: boolean
  locationFilterEnabled?: boolean
}

function buildAttachmentDownloadUrl(attachmentId: number): string {
  return `/api/collections/attachments/${attachmentId}/download`
}

function ensureWorkflowInstanceForResponse(
  db: ReturnType<typeof getDb>,
  collection: DbCollection,
  responseId: number,
): void {
  if (!collection.workflow_definition) {
    return
  }

  const existing = db
    .prepare('SELECT id FROM approval_workflow_instances WHERE response_id = ?')
    .get(responseId) as { id: number } | undefined
  if (existing) {
    return
  }

  const responseValues = db
    .prepare(
      `SELECT rv.value, cf.field_key
       FROM collection_response_values rv
       JOIN collection_fields cf ON cf.id = rv.field_id
       WHERE rv.response_id = ?`
    )
    .all(responseId) as Array<{ value: string | null; field_key: string | null }>

  initializeWorkflowForResponse({
    collectionId: collection.id,
    responseId,
    organizationId: collection.organization_id,
    collectionTitle: collection.title,
    workflowDefinition: parseWorkflowDefinition(collection.workflow_definition),
    fieldValues: responseValues
      .filter((item) => Boolean(item.field_key))
      .map((item) => ({
        fieldKey: item.field_key as string,
        value: item.value,
      })),
    db,
  })
}

function getVisibleResponseCountMap(
  db: ReturnType<typeof getDb>,
  context: RequestUserContext,
  collectionIds: number[],
): Map<number, number> {
  if (collectionIds.length === 0) {
    return new Map()
  }

  const ph = collectionIds.map(() => '?').join(',')

  if (canViewAllResponses(context)) {
    const responseCounts = db
      .prepare(`SELECT collection_id, COUNT(*) AS n FROM collection_responses WHERE collection_id IN (${ph}) GROUP BY collection_id`)
      .all(...collectionIds) as unknown as Array<{ collection_id: number; n: number }>
    return new Map(responseCounts.map(row => [row.collection_id, row.n]))
  }

  const locationFields = db
    .prepare(
      `SELECT MIN(id) AS id, collection_id
       FROM collection_fields
       WHERE collection_id IN (${ph}) AND type = 'location' AND location_filter_enabled = 1
       GROUP BY collection_id`
    )
    .all(...collectionIds) as unknown as Array<{ id: number; collection_id: number }>
  const locationFieldByCollection = new Map(locationFields.map(row => [row.collection_id, row.id]))

  const assignedLocations = db
    .prepare(
      `SELECT l.name FROM user_locations ul
       JOIN locations l ON l.id = ul.location_id
       WHERE ul.user_id = ?`
    )
    .all(context.id) as unknown as Array<{ name: string }>
  const locationNames = assignedLocations.map(row => row.name)

  const result = new Map<number, number>()

  for (const collectionId of collectionIds) {
    const locationFieldId = locationFieldByCollection.get(collectionId)
    if (!locationFieldId) {
      const row = db
        .prepare('SELECT COUNT(*) AS n FROM collection_responses WHERE collection_id = ?')
        .get(collectionId) as unknown as { n: number }
      result.set(collectionId, row.n)
      continue
    }

    if (locationNames.length === 0) {
      result.set(collectionId, 0)
      continue
    }

    const locationPh = locationNames.map(() => '?').join(',')
    const row = db
      .prepare(
        `SELECT COUNT(DISTINCT rv.response_id) AS n
         FROM collection_response_values rv
         JOIN collection_responses cr ON cr.id = rv.response_id
         WHERE cr.collection_id = ?
           AND rv.field_id = ?
           AND rv.value IN (${locationPh})`
      )
      .get(collectionId, locationFieldId, ...locationNames) as unknown as { n: number }
    result.set(collectionId, row.n)
  }

  return result
}

function sanitizeAttachmentReference(attachment: AttachmentReference): AttachmentReference {
  return {
    attachmentId: attachment.attachmentId,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    downloadUrl: attachment.downloadUrl,
    webViewUrl: attachment.webViewUrl ?? null,
  }
}

function sanitizeDownloadFilename(name: string): string {
  return name.replace(/[\r\n"]/g, '_')
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
  coverPhotoAssetId?: number | null
  logoUrl?: string
  instructions?: string
  instructionsDocUrl?: string
  anonymous?: boolean
  allowSubmissionEdits?: boolean
  submissionEditWindowHours?: number
  workflowDefinition?: ApprovalWorkflowDefinition | null
  sourceTemplateCollectionId?: number | null
  locationId?: number | null
  collectionType?: 'standard' | 'signup_sheet'
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

function buildCollectionCoverPhotoUrl(slug: string, coverPhotoAssetId: number | null, coverPhotoUrl: string | null): string | null {
  if (coverPhotoAssetId) {
    return `/api/collections/public/${slug}/cover-photo`
  }
  return coverPhotoUrl
}

function resolveCoverPhotoSelection(
  db: ReturnType<typeof getDb>,
  slug: string,
  organizationId: number,
  body: CollectionBody,
): { coverPhotoAssetId: number | null; coverPhotoUrl: string | null } {
  const assetIdRaw = body.coverPhotoAssetId
  if (assetIdRaw === undefined) {
    return {
      coverPhotoAssetId: null,
      coverPhotoUrl: body.coverPhotoUrl?.trim() ?? null,
    }
  }

  if (assetIdRaw === null) {
    return {
      coverPhotoAssetId: null,
      coverPhotoUrl: body.coverPhotoUrl?.trim() ?? null,
    }
  }

  const assetId = Number(assetIdRaw)
  if (!Number.isInteger(assetId) || assetId < 1) {
    throw new Error('coverPhotoAssetId must be a positive integer')
  }

  const asset = db.prepare(`
    SELECT id, organization_id
    FROM gallery_assets
    WHERE id = ?
  `).get(assetId) as { id: number; organization_id: number } | undefined

  if (!asset || asset.organization_id !== organizationId) {
    throw new Error('Selected gallery image does not exist in the chosen organization')
  }

  return {
    coverPhotoAssetId: asset.id,
    coverPhotoUrl: buildCollectionCoverPhotoUrl(slug, asset.id, null),
  }
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
  if (isAdministrator(context)) {
    return db
      .prepare(`${COL_SELECT} WHERE c.id = ?`)
      .get(id) as unknown as DbCollection | undefined
  }
  // Check org membership first (fastest path)
  const byOrg = db
    .prepare(`${COL_SELECT} WHERE c.id = ? AND c.organization_id = ?`)
    .get(id, context.organizationId) as unknown as DbCollection | undefined
  if (byOrg) return byOrg

  // Check if directly shared with this user
  const directShare = db
    .prepare(`SELECT 1 FROM collection_shares WHERE collection_id = ? AND share_type = 'user' AND share_target_id = ?`)
    .get(id, context.id) as unknown as { 1: number } | undefined
  if (directShare) {
    return db.prepare(`${COL_SELECT} WHERE c.id = ?`).get(id) as unknown as DbCollection | undefined
  }

  // Check if shared with any group the user belongs to
  const groupShare = db
    .prepare(`
      SELECT 1 FROM collection_shares cs
      JOIN group_members gm ON gm.group_id = cs.share_target_id
      WHERE cs.collection_id = ? AND cs.share_type = 'group' AND gm.user_id = ?
      LIMIT 1
    `)
    .get(id, context.id) as unknown as { 1: number } | undefined
  if (groupShare) {
    return db.prepare(`${COL_SELECT} WHERE c.id = ?`).get(id) as unknown as DbCollection | undefined
  }

  return undefined
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
    organizationDescription: c.organization_description ?? null,
    createdBy: c.created_by,
    createdByName: c.creator_name ?? null,
    dateDue: c.date_due,
    coverPhotoUrl: c.cover_photo_url,
    coverPhotoAssetId: c.cover_photo_asset_id,
    logoUrl: c.logo_url,
    instructions: c.instructions,
    instructionsDocUrl: c.instructions_doc_url,
    workflowDefinition: parseWorkflowDefinition(c.workflow_definition),
    sourceTemplateCollectionId: c.source_template_collection_id,
    templateUsageCount: c.template_usage_count ?? 0,
    activeVersionId: c.active_version_id,
    currentVersionNumber: c.active_version_number ?? null,
    currentVersionStatus: c.active_version_status ?? null,
    anonymous: c.anonymous === 1,
    allowSubmissionEdits: c.allow_submission_edits === 1,
    submissionEditWindowHours: c.submission_edit_window_hours,
    collectionType: c.collection_type ?? 'standard',
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    fields: fields.map(f => ({
      id: f.id,
      fieldKey: f.field_key ?? `field-${f.id}`,
      type: f.type,
      label: f.label,
      subtitle: f.subtitle ?? null,
      page: Number(f.page_number) || 1,
      required: f.required === 1,
      options: f.options ? (JSON.parse(f.options) as string[]) : null,
      displayStyle: resolveFieldDisplayStyle(f.type, f.display_style),
      branchRules: parseBranchRules(f.branch_rules),
      sortOrder: f.sort_order,
      staffOnly: f.staff_only === 1,
      locationFilterEnabled: f.location_filter_enabled === 1,
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
           (collection_id, version_id, field_key, type, label, subtitle, page_number, required, options, display_style, branch_rules, sort_order, staff_only, location_filter_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        collectionId,
        null,
        field.fieldKey?.trim() || crypto.randomUUID(),
        field.type,
        field.label,
        field.subtitle?.trim() || null,
        Math.max(1, Math.floor(field.page ?? 1)),
        field.required ? 1 : 0,
        field.options?.length ? JSON.stringify(field.options) : null,
        resolveFieldDisplayStyle(field.type, field.displayStyle),
        serialiseBranchRules(field.branchRules),
        field.sortOrder ?? idx,
        field.staffOnly ? 1 : 0,
        field.locationFilterEnabled ? 1 : 0
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
           (collection_id, version_id, field_key, type, label, subtitle, page_number, required, options, display_style, branch_rules, sort_order, staff_only, location_filter_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        collectionId,
        versionId,
        field.fieldKey?.trim() || crypto.randomUUID(),
        field.type,
        field.label,
        field.subtitle?.trim() || null,
        Math.max(1, Math.floor(field.page ?? 1)),
        field.required ? 1 : 0,
        field.options?.length ? JSON.stringify(field.options) : null,
        resolveFieldDisplayStyle(field.type, field.displayStyle),
        serialiseBranchRules(field.branchRules),
        field.sortOrder ?? idx,
        field.staffOnly ? 1 : 0,
        field.locationFilterEnabled ? 1 : 0
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
    case 'document':
      return null
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
      subtitle: (f.subtitle ?? '').trim(),
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
      subtitle: f.subtitle ?? '',
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
      locationFilterEnabled: f.location_filter_enabled === 1,
    }))
  )
}

const COL_SELECT = `
  SELECT c.*, u.name AS creator_name, o.name AS organization_name,
    o.description AS organization_description,
         (SELECT COUNT(*) FROM collections child WHERE child.source_template_collection_id = c.id) AS template_usage_count,
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
router.get('/public/:slug', optionalAuthenticateToken, (req: Request, res: Response) => {
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

  if (c.anonymous !== 1 && !req.user) {
    res.status(401).json({ error: 'Authentication required to access this form' })
    return
  }

  const [allFields, colsByField] = fetchFields(c.id, c.active_version_id)
  // Strip staff-only fields — the fill page is for submitters, not staff
  const publicFields = allFields.filter(f => !f.staff_only)
  res.json(toApiCollection(c, publicFields, colsByField))
})

router.get('/public/:slug/cover-photo', async (req: Request, res: Response) => {
  const db = getDb()
  const row = db.prepare(`
    SELECT c.status, ga.drive_file_id, ga.file_data, ga.mime_type
    FROM collections c
    JOIN gallery_assets ga ON ga.id = c.cover_photo_asset_id
    WHERE c.slug = ?
  `).get(req.params.slug) as { status: 'draft' | 'published'; drive_file_id: string; file_data: string | null; mime_type: string } | undefined

  if (!row || row.status !== 'published') {
    res.status(404).json({ error: 'Cover photo not found' })
    return
  }

  // Local DB storage — serve directly from base64 field
  if (row.drive_file_id.startsWith('local:')) {
    if (!row.file_data) {
      res.status(404).json({ error: 'Cover photo file data not found' })
      return
    }
    const buffer = Buffer.from(row.file_data, 'base64')
    res.setHeader('Content-Type', row.mime_type)
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.send(buffer)
    return
  }

  try {
    const file = await downloadDriveFile(row.drive_file_id)
    res.setHeader('Content-Type', file.mimeType)
    res.setHeader('Cache-Control', 'public, max-age=300')
    file.stream.pipe(res)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'Failed to load cover photo' })
  }
})

router.post('/public/:slug/attachments', optionalAuthenticateToken, attachmentUpload.single('file'), async (req: Request, res: Response) => {
  if (!isGoogleDriveConfigured()) {
    res.status(503).json({ error: 'Attachment uploads are not configured' })
    return
  }

  const db = getDb()
  const col = db
    .prepare('SELECT id, anonymous, status, active_version_id FROM collections WHERE slug = ?')
    .get(req.params.slug) as unknown as {
      id: number
      anonymous: number
      status: 'draft' | 'published'
      active_version_id: number | null
    } | undefined

  if (!col || col.status !== 'published') {
    res.status(404).json({ error: 'Collection not found' })
    return
  }

  if (col.anonymous !== 1 && !req.user) {
    res.status(401).json({ error: 'Authentication required to upload attachments for this form' })
    return
  }

  const fieldId = Number.parseInt(String(req.body.fieldId ?? ''), 10)
  if (!Number.isInteger(fieldId) || fieldId < 1) {
    res.status(400).json({ error: 'fieldId is required' })
    return
  }

  if (!req.file) {
    res.status(400).json({ error: 'A file is required' })
    return
  }

  const [fields] = fetchFields(col.id, col.active_version_id)
  const attachmentField = fields.find(field => field.id === fieldId && field.type === 'attachment' && !field.staff_only)
  if (!attachmentField) {
    res.status(400).json({ error: 'Invalid attachment field' })
    return
  }

  const pendingCountRow = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM response_attachments
      WHERE collection_id = ?
        AND field_id = ?
        AND response_id IS NULL
        AND status = 'uploaded'
        AND (
          (? IS NOT NULL AND uploaded_by_user_id = ?)
          OR (? IS NULL AND uploaded_by_user_id IS NULL)
        )
    `)
    .get(col.id, fieldId, req.user?.sub ?? null, req.user?.sub ?? null, req.user?.sub ?? null) as { count: number }

  if ((pendingCountRow?.count ?? 0) >= MAX_ATTACHMENTS_PER_FIELD) {
    res.status(400).json({ error: `You can upload up to ${MAX_ATTACHMENTS_PER_FIELD} attachments for this field` })
    return
  }

  const uploadToken = crypto.randomUUID()

  if (!isGoogleDriveConfigured()) {
    // ── Local DB storage fallback ──────────────────────────────────────────
    const localId = `local:${crypto.randomUUID()}`
    const fileDataBase64 = req.file.buffer.toString('base64')

    const result = db
      .prepare(`
        INSERT INTO response_attachments (
          collection_id,
          response_id,
          field_id,
          uploaded_by_user_id,
          temp_upload_token,
          file_name,
          mime_type,
          size_bytes,
          drive_file_id,
          drive_web_view_url,
          drive_download_url,
          file_data,
          status
        ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 'uploaded')
      `)
      .run(
        col.id,
        fieldId,
        req.user?.sub ?? null,
        uploadToken,
        req.file.originalname,
        req.file.mimetype || 'application/octet-stream',
        req.file.buffer.byteLength,
        localId,
        fileDataBase64,
      )

    const attachmentId = Number(result.lastInsertRowid)
    res.status(201).json({
      attachmentId,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype || 'application/octet-stream',
      sizeBytes: req.file.buffer.byteLength,
      downloadUrl: buildAttachmentDownloadUrl(attachmentId),
      webViewUrl: null,
      uploadToken,
    })
    return
  }

  try {
    const uploaded = await uploadBufferToDrive({
      fileName: req.file.originalname,
      mimeType: req.file.mimetype || 'application/octet-stream',
      buffer: req.file.buffer,
    })

    const result = db
      .prepare(`
        INSERT INTO response_attachments (
          collection_id,
          response_id,
          field_id,
          uploaded_by_user_id,
          temp_upload_token,
          file_name,
          mime_type,
          size_bytes,
          drive_file_id,
          drive_web_view_url,
          drive_download_url,
          status
        ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded')
      `)
      .run(
        col.id,
        fieldId,
        req.user?.sub ?? null,
        uploadToken,
        uploaded.name,
        uploaded.mimeType,
        uploaded.sizeBytes,
        uploaded.id,
        uploaded.webViewUrl,
        uploaded.webContentUrl,
      )

    const attachmentId = Number(result.lastInsertRowid)
    res.status(201).json({
      attachmentId,
      fileName: uploaded.name,
      mimeType: uploaded.mimeType,
      sizeBytes: uploaded.sizeBytes,
      downloadUrl: buildAttachmentDownloadUrl(attachmentId),
      webViewUrl: uploaded.webViewUrl,
      uploadToken,
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'Failed to upload attachment' })
  }
})

router.delete('/public/:slug/attachments/:attachmentId', optionalAuthenticateToken, async (req: Request, res: Response) => {
  const attachmentId = Number.parseInt(req.params.attachmentId, 10)
  if (!Number.isInteger(attachmentId) || attachmentId < 1) {
    res.status(400).json({ error: 'Invalid attachment ID' })
    return
  }

  const uploadToken = typeof req.body?.uploadToken === 'string'
    ? req.body.uploadToken.trim()
    : typeof req.query.uploadToken === 'string'
      ? req.query.uploadToken.trim()
      : ''
  if (!uploadToken) {
    res.status(400).json({ error: 'uploadToken is required' })
    return
  }

  const db = getDb()
  const col = db
    .prepare('SELECT id, anonymous, status FROM collections WHERE slug = ?')
    .get(req.params.slug) as unknown as { id: number; anonymous: number; status: 'draft' | 'published' } | undefined

  if (!col || col.status !== 'published') {
    res.status(404).json({ error: 'Collection not found' })
    return
  }

  if (col.anonymous !== 1 && !req.user) {
    res.status(401).json({ error: 'Authentication required to manage attachments for this form' })
    return
  }

  const attachment = db
    .prepare(`
      SELECT id, collection_id, response_id, uploaded_by_user_id, temp_upload_token, drive_file_id, status
      FROM response_attachments
      WHERE id = ? AND collection_id = ?
    `)
    .get(attachmentId, col.id) as unknown as {
      id: number
      collection_id: number
      response_id: number | null
      uploaded_by_user_id: number | null
      temp_upload_token: string | null
      drive_file_id: string
      status: 'uploaded' | 'linked' | 'deleted'
    } | undefined

  if (!attachment || attachment.response_id !== null || attachment.status !== 'uploaded') {
    res.status(404).json({ error: 'Attachment not found' })
    return
  }

  if (attachment.temp_upload_token !== uploadToken) {
    res.status(403).json({ error: 'Attachment token mismatch' })
    return
  }

  if (attachment.uploaded_by_user_id !== (req.user?.sub ?? null)) {
    res.status(403).json({ error: 'Attachment ownership mismatch' })
    return
  }

  if (!attachment.drive_file_id.startsWith('local:')) {
    try {
      await deleteDriveFile(attachment.drive_file_id)
    } catch {
      // If the Drive file is already gone, continue and clean up the metadata row.
    }
  }

  db.prepare(`
    UPDATE response_attachments
    SET status = 'deleted', deleted_at = datetime('now')
    WHERE id = ?
  `).run(attachment.id)

  res.status(204).send()
})

router.get('/attachments/:attachmentId/download', authenticateToken, async (req: Request, res: Response) => {
  const attachmentId = Number.parseInt(req.params.attachmentId, 10)
  if (!Number.isInteger(attachmentId) || attachmentId < 1) {
    res.status(400).json({ error: 'Invalid attachment ID' })
    return
  }

  const context = loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const db = getDb()
  const attachment = db
    .prepare(`
      SELECT
        ra.id,
        ra.collection_id,
        ra.response_id,
        ra.field_id,
        ra.uploaded_by_user_id,
        ra.temp_upload_token,
        ra.file_name,
        ra.mime_type,
        ra.size_bytes,
        ra.drive_file_id,
        ra.drive_web_view_url,
        ra.drive_download_url,
        ra.file_data,
        ra.status,
        cr.respondent_email,
        c.organization_id
      FROM response_attachments ra
      JOIN collections c ON c.id = ra.collection_id
      LEFT JOIN collection_responses cr ON cr.id = ra.response_id
      WHERE ra.id = ? AND ra.status != 'deleted'
    `)
    .get(attachmentId) as unknown as DbAttachmentRow | undefined

  if (!attachment || attachment.response_id === null) {
    res.status(404).json({ error: 'Attachment not found' })
    return
  }

  let permitted = false
  if (canViewResponses(context)) {
    permitted = isAdministrator(context) || attachment.organization_id === context.organizationId
  }

  if (!permitted) {
    const userRow = db
      .prepare('SELECT email FROM users WHERE id = ?')
      .get(context.id) as { email: string } | undefined
    permitted = !!userRow?.email && userRow.email === attachment.respondent_email && (isAdministrator(context) || attachment.organization_id === context.organizationId)
  }

  if (!permitted) {
    res.status(403).json({ error: 'Access denied' })
    return
  }

  // Local DB storage — serve directly from base64 field
  if (attachment.drive_file_id.startsWith('local:')) {
    if (!attachment.file_data) {
      res.status(404).json({ error: 'Attachment file data not found' })
      return
    }
    const buffer = Buffer.from(attachment.file_data, 'base64')
    res.setHeader('Content-Type', attachment.mime_type)
    res.setHeader('Content-Disposition', `inline; filename="${sanitizeDownloadFilename(attachment.file_name)}"`)
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.send(buffer)
    return
  }

  try {
    const file = await downloadDriveFile(attachment.drive_file_id)
    res.setHeader('Content-Type', file.mimeType)
    res.setHeader('Content-Disposition', `inline; filename="${sanitizeDownloadFilename(file.fileName)}"`)
    file.stream.pipe(res)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'Failed to download attachment' })
  }
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
router.post('/public/:slug/responses', optionalAuthenticateToken, (req: Request, res: Response) => {
  const db = getDb()
  const col = db
    .prepare('SELECT id, title, anonymous, status, active_version_id, allow_submission_edits, submission_edit_window_hours, organization_id, workflow_definition FROM collections WHERE slug = ?')
    .get(req.params.slug) as unknown as {
      id: number
      title: string
      anonymous: number
      status: 'draft' | 'published'
      active_version_id: number | null
      allow_submission_edits: number
      submission_edit_window_hours: number | null
      organization_id: number | null
      workflow_definition: string | null
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

  let authenticatedRespondent: { name: string; email: string } | null = null

  if (!col.anonymous) {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required to submit this form' })
      return
    }

    const userRow = db
      .prepare('SELECT name, email FROM users WHERE id = ?')
      .get(req.user.sub) as unknown as { name: string | null; email: string | null } | undefined

    if (!userRow?.name?.trim() || !userRow.email?.trim()) {
      res.status(400).json({ error: 'Your account must have a name and email address before submitting this form' })
      return
    }

    authenticatedRespondent = {
      name: userRow.name.trim(),
      email: userRow.email.trim(),
    }
  }

  db.exec('BEGIN')
  try {
    const [collectionFields] = fetchFields(col.id, col.active_version_id)
    const fieldById = new Map(collectionFields.map(field => [field.id, field]))

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
        authenticatedRespondent?.name ?? body.respondentName?.trim() ?? null,
        authenticatedRespondent?.email ?? body.respondentEmail?.trim() ?? null,
        editableUntil
      )

    const responseId = r.lastInsertRowid as number

    if (body.values?.length) {
      const storedValuesForWorkflow: Array<{ fieldKey: string; value: string | null }> = []
      for (const val of body.values) {
        const field = fieldById.get(val.fieldId)
        let storedValue = val.value ?? null

        if (field?.type === 'attachment' && val.value) {
          const attachments = parseAttachmentValue(val.value)
          if (attachments.length > 0) {
            const linkedAttachments: AttachmentReference[] = []
            for (const attachment of attachments) {
              const uploadToken = (attachment as AttachmentReference & { uploadToken?: string }).uploadToken?.trim() ?? null
              if (!uploadToken) {
                throw new Error('Attachment upload token is missing')
              }

              const attachmentRow = db
                .prepare(`
                  SELECT id, collection_id, response_id, field_id, uploaded_by_user_id, temp_upload_token, file_name, mime_type, size_bytes, drive_file_id, drive_web_view_url, drive_download_url, status
                  FROM response_attachments
                  WHERE id = ? AND collection_id = ? AND field_id = ? AND status = 'uploaded'
                `)
                .get(attachment.attachmentId, col.id, val.fieldId) as unknown as DbAttachmentRow | undefined

              if (!attachmentRow || attachmentRow.response_id !== null) {
                throw new Error('Uploaded attachment could not be linked to this response')
              }

              if (attachmentRow.temp_upload_token !== uploadToken) {
                throw new Error('Uploaded attachment token mismatch')
              }

              if (attachmentRow.uploaded_by_user_id !== (req.user?.sub ?? null)) {
                throw new Error('Uploaded attachment ownership mismatch')
              }

              db.prepare(`
                UPDATE response_attachments
                SET response_id = ?, status = 'linked', temp_upload_token = NULL
                WHERE id = ?
              `).run(responseId, attachmentRow.id)

              linkedAttachments.push(sanitizeAttachmentReference({
                attachmentId: attachmentRow.id,
                fileName: attachmentRow.file_name,
                mimeType: attachmentRow.mime_type,
                sizeBytes: attachmentRow.size_bytes,
                downloadUrl: buildAttachmentDownloadUrl(attachmentRow.id),
                webViewUrl: attachmentRow.drive_web_view_url,
              }))
            }

            storedValue = stringifyAttachmentValue(linkedAttachments)
          }
        }

        db.prepare(
          `INSERT INTO collection_response_values (response_id, field_id, value)
           VALUES (?, ?, ?)`
        ).run(responseId, val.fieldId, storedValue)

        if (field?.field_key) {
          storedValuesForWorkflow.push({ fieldKey: field.field_key, value: storedValue })
        }
      }

      initializeWorkflowForResponse({
        collectionId: col.id,
        responseId,
        organizationId: col.organization_id,
        collectionTitle: col.title,
        workflowDefinition: parseWorkflowDefinition(col.workflow_definition),
        fieldValues: storedValuesForWorkflow,
        db,
      })
    } else {
      initializeWorkflowForResponse({
        collectionId: col.id,
        responseId,
        organizationId: col.organization_id,
        collectionTitle: col.title,
        workflowDefinition: parseWorkflowDefinition(col.workflow_definition),
        fieldValues: [],
        db,
      })
    }

    db.exec('COMMIT')

    // Send confirmation email if the feature is enabled and the respondent provided an email
    const respondentEmail = authenticatedRespondent?.email ?? body.respondentEmail?.trim()
    if (respondentEmail && isEmailDeliveryConfigured()) {
      const settingRow = db
        .prepare(`SELECT value FROM app_settings WHERE key = 'submission_confirmation_emails'`)
        .get() as { value: string } | undefined
      if (settingRow?.value === 'true') {
        void sendNotificationEmail({
          to: respondentEmail,
          subject: `Submission received – ${col.title}`,
          text: [
            `Hi ${authenticatedRespondent?.name ?? body.respondentName?.trim() ?? 'there'},`,
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
  if (req.user?.role !== 'administrator' && req.user?.role !== 'super_admin') {
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

  // For super_admin (no org), show all collections
  let cols: DbCollection[]
  if (isAdministrator(context)) {
    cols = db
      .prepare(`${COL_SELECT} ORDER BY c.created_at DESC`)
      .all() as unknown as DbCollection[]
  } else {
    // Collections in the user's org + collections shared directly or via group
    cols = db
      .prepare(`
        ${COL_SELECT}
        WHERE c.organization_id = ?
           OR EXISTS (
             SELECT 1 FROM collection_shares cs
             WHERE cs.collection_id = c.id AND cs.share_type = 'user' AND cs.share_target_id = ?
           )
           OR EXISTS (
             SELECT 1 FROM collection_shares cs
             JOIN group_members gm ON gm.group_id = cs.share_target_id
             WHERE cs.collection_id = c.id AND cs.share_type = 'group' AND gm.user_id = ?
           )
        ORDER BY c.created_at DESC
      `)
      .all(context.organizationId, context.id, context.id) as unknown as DbCollection[]
  }

  if (cols.length === 0) {
    res.json([])
    return
  }

  const ids = cols.map(c => c.id)
  const ph = ids.map(() => '?').join(',')

  const responseCountMap = getVisibleResponseCountMap(db, context, ids)

  const customTableFlags = db
    .prepare(`SELECT collection_id, COUNT(*) AS ct FROM collection_fields WHERE collection_id IN (${ph}) AND type = 'custom_table' GROUP BY collection_id`)
    .all(...ids) as unknown as Array<{ collection_id: number; ct: number }>
  const customTableMap = new Map(customTableFlags.map(r => [r.collection_id, r.ct]))

  const result = cols.map(c => ({
    ...toApiCollection(c, [], new Map()),
    responseCount: responseCountMap.get(c.id) ?? 0,
    hasCustomTable: (customTableMap.get(c.id) ?? 0) > 0,
  }))
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
  let sourceTemplateCollectionId: number | null = null
  let coverSelection: { coverPhotoAssetId: number | null; coverPhotoUrl: string | null }

  try {
    organization = resolveCollectionOrganization(context, body.organizationId)
    category = ensureCategoryExists(normalizeCategory(body.category))
    editSettings = resolveSubmissionEditSettings(body)
    if (body.sourceTemplateCollectionId !== null && body.sourceTemplateCollectionId !== undefined) {
      const templateId = Number(body.sourceTemplateCollectionId)
      if (!Number.isInteger(templateId) || templateId < 1) {
        throw new Error('sourceTemplateCollectionId must be a positive integer')
      }
      const template = fetchAccessibleCollectionById(templateId, context)
      if (!template) {
        throw new Error('Selected template collection does not exist')
      }
      sourceTemplateCollectionId = template.id
    }
    coverSelection = resolveCoverPhotoSelection(db, slug, organization.id, body)
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
            cover_photo_asset_id, logo_url, instructions, instructions_doc_url, workflow_definition, source_template_collection_id, organization_id, anonymous, allow_submission_edits,
            submission_edit_window_hours, collection_type, active_version_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(
        slug,
        body.title.trim(),
        requestedStatus,
        body.description?.trim() ?? null,
        category,
        req.user!.sub,
        body.dateDue ?? null,
        coverSelection.coverPhotoUrl,
        coverSelection.coverPhotoAssetId,
        body.logoUrl ?? null,
        body.instructions ?? null,
        body.instructionsDocUrl ?? null,
        serializeWorkflowDefinition(body.workflowDefinition),
        sourceTemplateCollectionId,
        organization.id,
        body.anonymous ? 1 : 0,
        editSettings.allowSubmissionEdits ? 1 : 0,
        editSettings.submissionEditWindowHours,
        body.collectionType === 'signup_sheet' ? 'signup_sheet' : 'standard'
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
  let coverSelection: { coverPhotoAssetId: number | null; coverPhotoUrl: string | null }

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

  try {
    coverSelection = resolveCoverPhotoSelection(getDb(), existingCollection.slug, organization.id, body)
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
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
          cover_photo_asset_id = ?, logo_url = ?, instructions = ?, instructions_doc_url = ?, workflow_definition = ?, organization_id = ?, anonymous = ?, allow_submission_edits = ?,
           submission_edit_window_hours = ?, collection_type = ?, active_version_id = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      body.title.trim(),
      requestedStatus,
      body.description?.trim() ?? null,
      category,
      body.dateDue ?? null,
      coverSelection.coverPhotoUrl,
      coverSelection.coverPhotoAssetId,
      body.logoUrl ?? null,
      body.instructions ?? null,
      body.instructionsDocUrl ?? null,
      serializeWorkflowDefinition(body.workflowDefinition),
      organization.id,
      body.anonymous ? 1 : 0,
      editSettings.allowSubmissionEdits ? 1 : 0,
      editSettings.submissionEditWindowHours,
      body.collectionType === 'signup_sheet' ? 'signup_sheet' : 'standard',
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
  let coverSelection: { coverPhotoAssetId: number | null; coverPhotoUrl: string | null }

  try {
    category = ensureCategoryExists(normalizeCategory(body.category))
    coverSelection = resolveCoverPhotoSelection(db, collection.slug, collection.organization_id, body)
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
          cover_photo_asset_id = ?, logo_url = ?, instructions = ?, instructions_doc_url = ?, workflow_definition = ?, anonymous = ?, active_version_id = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      body.title.trim(),
      requestedStatus,
      body.description?.trim() ?? null,
      category,
      body.dateDue ?? null,
      coverSelection.coverPhotoUrl,
      coverSelection.coverPhotoAssetId,
      body.logoUrl ?? null,
      body.instructions ?? null,
      body.instructionsDocUrl ?? null,
      serializeWorkflowDefinition(body.workflowDefinition),
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

  const responseCountRow = db
    .prepare('SELECT COUNT(*) AS count FROM collection_responses WHERE collection_id = ?')
    .get(id) as { count: number }
  const templateUsageRow = db
    .prepare('SELECT COUNT(*) AS count FROM collections WHERE source_template_collection_id = ?')
    .get(id) as { count: number }

  if (responseCountRow.count > 0) {
    res.status(409).json({ error: 'This template cannot be deleted because it has responses.' })
    return
  }

  if (templateUsageRow.count > 0) {
    res.status(409).json({ error: 'This template cannot be deleted because other collections were created from it.' })
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
    // Find the location field in this collection (if any) that has filtering enabled
    const locationField = db
      .prepare(
        `SELECT id FROM collection_fields WHERE collection_id = ? AND type = 'location' AND location_filter_enabled = 1 LIMIT 1`
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
      `SELECT rv.*, cf.label AS field_label
       FROM collection_response_values rv
       LEFT JOIN collection_fields cf ON cf.id = rv.field_id
       WHERE rv.response_id IN (${ph})`
    )
    .all(...responseIds) as unknown as DbResponseValue[]

  const valsByResponse = new Map<number, DbResponseValue[]>()
  for (const v of values) {
    const arr = valsByResponse.get(v.response_id) ?? []
    arr.push(v)
    valsByResponse.set(v.response_id, arr)
  }

  responses.forEach((response) => {
    ensureWorkflowInstanceForResponse(db, collection, response.id)
  })

  res.json(
    responses.map(r => ({
      id: r.id,
      respondentName: r.respondent_name,
      respondentEmail: r.respondent_email,
      submittedAt: r.submitted_at,
      workflow: getWorkflowSummaryForResponse(r.id, db),
      values: (valsByResponse.get(r.id) ?? []).map(v => ({
        fieldId: v.field_id,
        value: v.value,
        fieldLabel: v.field_label ?? null,
        staffUpdatedByName: v.staff_updated_by_name ?? null,
        staffUpdatedAt: v.staff_updated_at ?? null,
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

    // Look up the editor's name for the audit trail
    const editorRow = db
      .prepare('SELECT name FROM users WHERE id = ?')
      .get(context.id) as { name: string } | undefined
    const editorName = editorRow?.name ?? null
    const editedAt = new Date().toISOString()

    // Upsert values inside a transaction
    db.transaction(() => {
      for (const val of bodyValues) {
        const existing = db
          .prepare('SELECT id FROM collection_response_values WHERE response_id = ? AND field_id = ?')
          .get(responseId, val.fieldId) as { id: number } | undefined
        if (existing) {
          db.prepare(
            'UPDATE collection_response_values SET value = ?, staff_updated_by_name = ?, staff_updated_at = ? WHERE response_id = ? AND field_id = ?'
          ).run(val.value ?? null, editorName, editedAt, responseId, val.fieldId)
        } else {
          db.prepare(
            'INSERT INTO collection_response_values (response_id, field_id, value, staff_updated_by_name, staff_updated_at) VALUES (?, ?, ?, ?, ?)'
          ).run(responseId, val.fieldId, val.value ?? null, editorName, editedAt)
        }
      }
    })()

    res.json({ ok: true })
  } catch (err) {
    console.error('[collections] staff-fields upsert:', err)
    res.status(500).json({ error: 'Failed to save staff fields' })
  }
})

router.get('/:id/responses/:responseId/workflow', authenticateToken, (req: Request, res: Response): void => {
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

  try {
    const db = getDb()
    const collection = fetchAccessibleCollectionById(id, context)
    if (!collection) {
      res.status(404).json({ error: 'Collection not found' })
      return
    }

    const responseRow = db
      .prepare('SELECT id FROM collection_responses WHERE id = ? AND collection_id = ?')
      .get(responseId, id) as { id: number } | undefined
    if (!responseRow) {
      res.status(404).json({ error: 'Response not found' })
      return
    }

    ensureWorkflowInstanceForResponse(db, collection, responseId)

    res.json(getWorkflowSummaryForResponse(responseId, db))
  } catch (err) {
    console.error('[collections] get workflow:', err)
    res.status(500).json({ error: 'Failed to load workflow' })
  }
})

router.post('/:id/responses/:responseId/workflow/:decision(approve|reject)', authenticateToken, (req: Request, res: Response): void => {
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

  try {
    const db = getDb()
    const collection = fetchAccessibleCollectionById(id, context)
    if (!collection) {
      res.status(404).json({ error: 'Collection not found' })
      return
    }

    const responseRow = db
      .prepare('SELECT id FROM collection_responses WHERE id = ? AND collection_id = ?')
      .get(responseId, id) as { id: number } | undefined
    if (!responseRow) {
      res.status(404).json({ error: 'Response not found' })
      return
    }

    const actor = db.prepare('SELECT name FROM users WHERE id = ?').get(context.id) as { name: string | null } | undefined
    const summary = actOnWorkflowStage({
      responseId,
      userId: context.id,
      actorName: actor?.name ?? null,
      decision: req.params.decision === 'reject' ? 'rejected' : 'approved',
      comment: (req.body as { comment?: string }).comment ?? null,
      db,
    })

    if (!summary) {
      res.status(404).json({ error: 'Workflow not found' })
      return
    }

    res.json(summary)
  } catch (err) {
    console.error('[collections] act workflow:', err)
    res.status(500).json({ error: 'Failed to update workflow' })
  }
})

// ── Submission Comments ────────────────────────────────────────────────────

/**
 * GET /api/collections/:id/responses/:responseId/comments
 */
router.get('/:id/responses/:responseId/comments', authenticateToken, (req: Request, res: Response): void => {
  const id = parseInt(req.params.id, 10)
  const responseId = parseInt(req.params.responseId, 10)
  if (isNaN(id) || isNaN(responseId)) { res.status(400).json({ error: 'Invalid ID' }); return }

  const context = loadRequestUserContext(req)
  if (!context) { res.status(401).json({ error: 'Authentication required' }); return }
  if (context.role === 'user') { res.status(403).json({ error: 'Staff access required' }); return }

  try {
    const db = getDb()
    const collection = fetchAccessibleCollectionById(id, context)
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return }

    const responseRow = db
      .prepare('SELECT id FROM collection_responses WHERE id = ? AND collection_id = ?')
      .get(responseId, id) as { id: number } | undefined
    if (!responseRow) { res.status(404).json({ error: 'Response not found' }); return }

    const comments = db
      .prepare('SELECT id, user_id, user_name, body, created_at FROM submission_comments WHERE response_id = ? ORDER BY created_at ASC')
      .all(responseId) as unknown as Array<{ id: number; user_id: number; user_name: string; body: string; created_at: string }>

    res.json(comments.map(c => ({
      id: c.id,
      userId: c.user_id,
      userName: c.user_name,
      body: c.body,
      createdAt: c.created_at,
    })))
  } catch (err) {
    console.error('[collections] get comments:', err)
    res.status(500).json({ error: 'Failed to load comments' })
  }
})

/**
 * POST /api/collections/:id/responses/:responseId/comments
 */
router.post('/:id/responses/:responseId/comments', authenticateToken, (req: Request, res: Response): void => {
  const id = parseInt(req.params.id, 10)
  const responseId = parseInt(req.params.responseId, 10)
  if (isNaN(id) || isNaN(responseId)) { res.status(400).json({ error: 'Invalid ID' }); return }

  const context = loadRequestUserContext(req)
  if (!context) { res.status(401).json({ error: 'Authentication required' }); return }
  if (context.role === 'user') { res.status(403).json({ error: 'Staff access required' }); return }

  const body = (req.body as { body?: string }).body?.trim()
  if (!body) { res.status(400).json({ error: 'Comment body is required' }); return }

  try {
    const db = getDb()
    const collection = fetchAccessibleCollectionById(id, context)
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return }

    const responseRow = db
      .prepare('SELECT id FROM collection_responses WHERE id = ? AND collection_id = ?')
      .get(responseId, id) as { id: number } | undefined
    if (!responseRow) { res.status(404).json({ error: 'Response not found' }); return }

    const userRow = db.prepare('SELECT name FROM users WHERE id = ?').get(context.id) as { name: string } | undefined
    const userName = userRow?.name ?? 'Unknown'

    const result = db
      .prepare('INSERT INTO submission_comments (response_id, user_id, user_name, body) VALUES (?, ?, ?, ?)')
      .run(responseId, context.id, userName, body) as { lastInsertRowid: number | bigint }

    const comment = db
      .prepare('SELECT id, user_id, user_name, body, created_at FROM submission_comments WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as { id: number; user_id: number; user_name: string; body: string; created_at: string }

    res.status(201).json({
      id: comment.id,
      userId: comment.user_id,
      userName: comment.user_name,
      body: comment.body,
      createdAt: comment.created_at,
    })
  } catch (err) {
    console.error('[collections] add comment:', err)
    res.status(500).json({ error: 'Failed to add comment' })
  }
})

/**
 * DELETE /api/collections/:id/responses/:responseId/comments/:commentId
 * Own comments only (admins/super_admin can delete any).
 */
router.delete('/:id/responses/:responseId/comments/:commentId', authenticateToken, (req: Request, res: Response): void => {
  const id = parseInt(req.params.id, 10)
  const responseId = parseInt(req.params.responseId, 10)
  const commentId = parseInt(req.params.commentId, 10)
  if (isNaN(id) || isNaN(responseId) || isNaN(commentId)) { res.status(400).json({ error: 'Invalid ID' }); return }

  const context = loadRequestUserContext(req)
  if (!context) { res.status(401).json({ error: 'Authentication required' }); return }
  if (context.role === 'user') { res.status(403).json({ error: 'Staff access required' }); return }

  try {
    const db = getDb()
    const collection = fetchAccessibleCollectionById(id, context)
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return }

    const comment = db
      .prepare('SELECT id, user_id FROM submission_comments WHERE id = ? AND response_id = ?')
      .get(commentId, responseId) as { id: number; user_id: number } | undefined
    if (!comment) { res.status(404).json({ error: 'Comment not found' }); return }

    const canDelete = context.role === 'super_admin' || context.role === 'administrator' || comment.user_id === context.id
    if (!canDelete) { res.status(403).json({ error: 'Not allowed to delete this comment' }); return }

    db.prepare('DELETE FROM submission_comments WHERE id = ?').run(commentId)
    res.json({ ok: true })
  } catch (err) {
    console.error('[collections] delete comment:', err)
    res.status(500).json({ error: 'Failed to delete comment' })
  }
})

// ── Ticket template routes ─────────────────────────────────────────────────

type TicketHistoryEventType = 'field_changed' | 'ticket_closed' | 'ticket_reopened'

function normalizeTicketAuditValue(value: string | null | undefined): string | null {
  return value == null || value === '' ? null : value
}

function resolveTicketActorName(db: ReturnType<typeof getDb>, userId: number): string | null {
  const row = db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as { name: string } | undefined
  return row?.name ?? null
}

function insertTicketHistoryEntry(
  db: ReturnType<typeof getDb>,
  entry: {
    ticketResponseId: number
    ticketFieldId?: number | null
    ticketFieldKey?: string | null
    fieldLabelSnapshot?: string | null
    fieldTypeSnapshot?: string | null
    eventType: TicketHistoryEventType
    oldValue?: string | null
    newValue?: string | null
    changedBy: number | null
    changedByName: string | null
  }
): void {
  db.prepare(
    `INSERT INTO ticket_history (
      ticket_response_id,
      ticket_field_id,
      ticket_field_key,
      field_label_snapshot,
      field_type_snapshot,
      event_type,
      old_value,
      new_value,
      changed_by,
      changed_by_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.ticketResponseId,
    entry.ticketFieldId ?? null,
    entry.ticketFieldKey ?? null,
    entry.fieldLabelSnapshot ?? null,
    entry.fieldTypeSnapshot ?? null,
    entry.eventType,
    entry.oldValue ?? null,
    entry.newValue ?? null,
    entry.changedBy,
    entry.changedByName,
  )
}

interface DbAssignedTicketTemplate {
  id: number
  ticket_template_id: number
  title: string
  description: string | null
  display_order: number
  is_active: number
}

function canManageCollectionTickets(context: RequestUserContext): boolean {
  return isAdministrator(context) || context.role === 'administrator' || context.role === 'team_manager'
}

function fetchAssignedTicketTemplates(
  db: ReturnType<typeof getDb>,
  collectionId: number,
): DbAssignedTicketTemplate[] {
  return db.prepare(`
    SELECT
      ctt.id,
      ctt.ticket_template_id,
      tt.title,
      tt.description,
      ctt.display_order,
      ctt.is_active
    FROM collection_ticket_templates ctt
    JOIN ticket_templates tt ON tt.id = ctt.ticket_template_id
    WHERE ctt.collection_id = ? AND ctt.is_active = 1 AND tt.is_active = 1
    ORDER BY ctt.display_order ASC, ctt.id ASC
  `).all(collectionId) as DbAssignedTicketTemplate[]
}

function fetchAccessibleTicketTemplateForCollection(
  db: ReturnType<typeof getDb>,
  collectionId: number,
  templateId: number,
): DbAssignedTicketTemplate | undefined {
  return db.prepare(`
    SELECT
      ctt.id,
      ctt.ticket_template_id,
      tt.title,
      tt.description,
      ctt.display_order,
      ctt.is_active
    FROM collection_ticket_templates ctt
    JOIN ticket_templates tt ON tt.id = ctt.ticket_template_id
    WHERE ctt.collection_id = ?
      AND ctt.ticket_template_id = ?
      AND ctt.is_active = 1
      AND tt.is_active = 1
    LIMIT 1
  `).get(collectionId, templateId) as DbAssignedTicketTemplate | undefined
}

function serializeTicketResponse(
  ticket: {
    id: number
    collection_response_id: number
    collection_id: number
    ticket_template_id: number | null
    filled_by: number | null
    filled_at: string | null
    finalized: number
    finalized_at: string | null
    finalized_by_name: string | null
  },
  values: Array<{ ticket_field_id: number; value: string | null }>,
) {
  return {
    id: ticket.id,
    collectionResponseId: ticket.collection_response_id,
    collectionId: ticket.collection_id,
    ticketTemplateId: ticket.ticket_template_id,
    filledBy: ticket.filled_by,
    filledAt: ticket.filled_at,
    finalized: ticket.finalized === 1,
    finalizedAt: ticket.finalized_at,
    finalizedByName: ticket.finalized_by_name,
    values: values.map(v => ({ fieldId: v.ticket_field_id, value: v.value })),
  }
}

// GET /:id/ticket-templates — list ticket templates assigned to a collection
router.get('/:id/ticket-templates', authenticateToken, (req: Request, res: Response): void => {
  const context = loadRequestUserContext(req)
  const id = parseInt(req.params.id, 10)
  if (!context || isNaN(id)) { res.status(400).json({ error: 'Invalid request' }); return }
  if (!canViewResponses(context)) { res.status(403).json({ error: 'Access denied' }); return }

  try {
    const db = getDb()
    const collection = fetchAccessibleCollectionById(id, context)
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return }

    const includeArchived = req.query.includeArchived === 'true'

    if (includeArchived) {
      type AllAssignedRow = DbAssignedTicketTemplate & { ctt_is_active: number }
      const all = db.prepare(`
        SELECT
          ctt.id,
          ctt.ticket_template_id,
          tt.title,
          tt.description,
          ctt.display_order,
          ctt.is_active,
          ctt.is_active AS ctt_is_active
        FROM collection_ticket_templates ctt
        JOIN ticket_templates tt ON tt.id = ctt.ticket_template_id
        WHERE ctt.collection_id = ? AND tt.is_active = 1
        ORDER BY ctt.is_active DESC, ctt.display_order ASC, ctt.id ASC
      `).all(id) as AllAssignedRow[]
      res.json(all.map(t => ({
        id: t.ticket_template_id,
        title: t.title,
        description: t.description,
        displayOrder: t.display_order,
        isArchived: t.ctt_is_active === 0,
      })))
    } else {
      const templates = fetchAssignedTicketTemplates(db, id)
      res.json(templates.map(template => ({
        id: template.ticket_template_id,
        title: template.title,
        description: template.description,
        displayOrder: template.display_order,
        isArchived: false,
      })))
    }
  } catch (err) {
    console.error('[collections] get ticket templates:', err)
    res.status(500).json({ error: 'Failed to get ticket templates' })
  }
})

// PATCH /:id/ticket-templates/:templateId — archive or restore an assigned ticket template
router.patch('/:id/ticket-templates/:templateId', authenticateToken, (req: Request, res: Response): void => {
  const context = loadRequestUserContext(req)
  const collectionId = parseInt(req.params.id, 10)
  const templateId = parseInt(req.params.templateId, 10)
  if (!context || isNaN(collectionId) || isNaN(templateId)) { res.status(400).json({ error: 'Invalid request' }); return }
  if (!canManageCollectionTickets(context)) { res.status(403).json({ error: 'Manager access required' }); return }

  try {
    const db = getDb()
    const collection = fetchAccessibleCollectionById(collectionId, context)
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return }

    const body = req.body as { isActive?: boolean }
    if (typeof body.isActive !== 'boolean') { res.status(400).json({ error: 'isActive boolean required' }); return }

    const result = db.prepare(`
      UPDATE collection_ticket_templates
      SET is_active = ?, updated_at = datetime('now')
      WHERE collection_id = ? AND ticket_template_id = ?
    `).run(body.isActive ? 1 : 0, collectionId, templateId)

    if (result.changes === 0) { res.status(404).json({ error: 'Ticket template assignment not found' }); return }

    res.json({ success: true })
  } catch (err) {
    console.error('[collections] patch ticket template:', err)
    res.status(500).json({ error: 'Failed to update ticket template' })
  }
})

// PUT /:id/ticket-templates — replace assigned ticket templates for a collection
router.put('/:id/ticket-templates', authenticateToken, (req: Request, res: Response): void => {
  const context = loadRequestUserContext(req)
  const id = parseInt(req.params.id, 10)
  if (!context || isNaN(id)) { res.status(400).json({ error: 'Invalid request' }); return }
  if (!canManageCollectionTickets(context)) { res.status(403).json({ error: 'Manager access required' }); return }

  try {
    const db = getDb()
    const collection = fetchAccessibleCollectionById(id, context)
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return }

    const body = req.body as { templateIds?: number[] }
    const templateIds = Array.isArray(body.templateIds)
      ? body.templateIds.map(value => Number(value)).filter(value => Number.isInteger(value) && value > 0)
      : []

    if (templateIds.length > 0) {
      const placeholders = templateIds.map(() => '?').join(',')
      const accessibleCount = db.prepare(`
        SELECT COUNT(*) AS count
        FROM ticket_templates
        WHERE id IN (${placeholders})
          AND is_active = 1
          AND (${isAdministrator(context) ? '1 = 1' : 'organization_id = ?'})
      `).get(...templateIds, ...(isAdministrator(context) ? [] : [context.organizationId])) as { count: number }

      if (accessibleCount.count !== templateIds.length) {
        res.status(400).json({ error: 'One or more ticket templates are unavailable for this collection' })
        return
      }
    }

    db.transaction(() => {
      db.prepare('DELETE FROM collection_ticket_templates WHERE collection_id = ?').run(id)
      templateIds.forEach((templateId, index) => {
        db.prepare(`
          INSERT INTO collection_ticket_templates (collection_id, ticket_template_id, display_order)
          VALUES (?, ?, ?)
        `).run(id, templateId, index)
      })
    })()

    const templates = fetchAssignedTicketTemplates(db, id)
    res.json(templates.map(template => ({
      id: template.ticket_template_id,
      title: template.title,
      description: template.description,
      displayOrder: template.display_order,
    })))
  } catch (err) {
    console.error('[collections] save ticket templates:', err)
    res.status(500).json({ error: 'Failed to save ticket templates' })
  }
})

// GET /:id/responses/:responseId/tickets — list assigned tickets for a response
router.get('/:id/responses/:responseId/tickets', authenticateToken, (req: Request, res: Response): void => {
  const context = loadRequestUserContext(req)
  const collectionId = parseInt(req.params.id, 10)
  const responseId = parseInt(req.params.responseId, 10)
  if (!context || isNaN(collectionId) || isNaN(responseId)) { res.status(400).json({ error: 'Invalid request' }); return }
  if (!canViewResponses(context)) { res.status(403).json({ error: 'Access denied' }); return }

  try {
    const db = getDb()
    const collection = fetchAccessibleCollectionById(collectionId, context)
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return }

    const responseRow = db.prepare('SELECT id FROM collection_responses WHERE id = ? AND collection_id = ?').get(responseId, collectionId) as { id: number } | undefined
    if (!responseRow) { res.status(404).json({ error: 'Response not found' }); return }

    const templates = fetchAssignedTicketTemplates(db, collectionId)
    const tickets = db.prepare(`
      SELECT tr.*, u.name AS finalized_by_name
      FROM ticket_responses tr
      LEFT JOIN users u ON u.id = tr.finalized_by
      WHERE tr.collection_id = ? AND tr.collection_response_id = ?
    `).all(collectionId, responseId) as Array<{
      id: number
      collection_response_id: number
      collection_id: number
      ticket_template_id: number | null
      filled_by: number | null
      filled_at: string | null
      finalized: number
      finalized_at: string | null
      finalized_by_name: string | null
    }>

    const ticketByTemplateId = new Map(tickets.map(ticket => [ticket.ticket_template_id ?? 0, ticket]))

    res.json(templates.map(template => {
      const ticket = ticketByTemplateId.get(template.ticket_template_id) ?? null
      return {
        templateId: template.ticket_template_id,
        title: template.title,
        description: template.description,
        displayOrder: template.display_order,
        response: ticket
          ? serializeTicketResponse(ticket, [])
          : null,
      }
    }))
  } catch (err) {
    console.error('[collections] list response tickets:', err)
    res.status(500).json({ error: 'Failed to list tickets' })
  }
})

// GET /:id/responses/:responseId/tickets/:templateId — get ticket instance (or null)
router.get('/:id/responses/:responseId/tickets/:templateId', authenticateToken, (req: Request, res: Response): void => {
  const context = loadRequestUserContext(req)
  const collectionId = parseInt(req.params.id, 10)
  const responseId = parseInt(req.params.responseId, 10)
  const templateId = parseInt(req.params.templateId, 10)
  if (!context || isNaN(collectionId) || isNaN(responseId) || isNaN(templateId)) { res.status(400).json({ error: 'Invalid request' }); return }
  if (!canViewResponses(context)) { res.status(403).json({ error: 'Access denied' }); return }

  try {
    const db = getDb()
    const collection = fetchAccessibleCollectionById(collectionId, context)
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return }
    const template = fetchAccessibleTicketTemplateForCollection(db, collectionId, templateId)
    if (!template) { res.status(404).json({ error: 'Ticket template not assigned to this collection' }); return }

    const ticket = db.prepare(`
      SELECT tr.*, u.name AS finalized_by_name
      FROM ticket_responses tr
      LEFT JOIN users u ON u.id = tr.finalized_by
      WHERE tr.collection_response_id = ? AND tr.collection_id = ? AND tr.ticket_template_id = ?
      LIMIT 1
    `).get(responseId, collectionId, templateId) as {
      id: number
      collection_response_id: number
      collection_id: number
      ticket_template_id: number | null
      filled_by: number | null
      filled_at: string | null
      finalized: number
      finalized_at: string | null
      finalized_by_name: string | null
    } | undefined

    if (!ticket) { res.json(null); return }

    const values = db.prepare('SELECT ticket_field_id, value FROM ticket_response_values WHERE ticket_response_id = ?').all(ticket.id) as Array<{ ticket_field_id: number; value: string | null }>
    res.json(serializeTicketResponse(ticket, values))
  } catch (err) {
    console.error('[collections] get template ticket:', err)
    res.status(500).json({ error: 'Failed to get ticket' })
  }
})

// POST /:id/responses/:responseId/tickets/:templateId — create or update ticket draft
router.post('/:id/responses/:responseId/tickets/:templateId', authenticateToken, (req: Request, res: Response): void => {
  const context = loadRequestUserContext(req)
  const collectionId = parseInt(req.params.id, 10)
  const responseId = parseInt(req.params.responseId, 10)
  const templateId = parseInt(req.params.templateId, 10)
  if (!context || isNaN(collectionId) || isNaN(responseId) || isNaN(templateId)) { res.status(400).json({ error: 'Invalid request' }); return }
  if (!canViewResponses(context)) { res.status(403).json({ error: 'Staff access required' }); return }

  try {
    const db = getDb()
    const collection = fetchAccessibleCollectionById(collectionId, context)
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return }
    const template = fetchAccessibleTicketTemplateForCollection(db, collectionId, templateId)
    if (!template) { res.status(404).json({ error: 'Ticket template not assigned to this collection' }); return }

    const responseRow = db.prepare('SELECT id FROM collection_responses WHERE id = ? AND collection_id = ?').get(responseId, collectionId) as { id: number } | undefined
    if (!responseRow) { res.status(404).json({ error: 'Response not found' }); return }

    const existing = db.prepare(`
      SELECT id, finalized
      FROM ticket_responses
      WHERE collection_response_id = ? AND collection_id = ? AND ticket_template_id = ?
      LIMIT 1
    `).get(responseId, collectionId, templateId) as { id: number; finalized: number } | undefined

    const body = req.body as { values?: Array<{ fieldId: number; value: string }> }
    const values = Array.isArray(body.values) ? body.values : []
    const existingValues = existing
      ? db.prepare('SELECT ticket_field_id, value FROM ticket_response_values WHERE ticket_response_id = ?').all(existing.id) as Array<{ ticket_field_id: number; value: string | null }>
      : []
    const previousValueByFieldId = new Map(existingValues.map(value => [value.ticket_field_id, value.value]))
    const fieldRows = db.prepare(`
      SELECT id, field_key, label, type
      FROM ticket_fields
      WHERE ticket_template_id = ?
    `).all(templateId) as Array<{ id: number; field_key: string | null; label: string; type: string }>
    const fieldMetaById = new Map(fieldRows.map(field => [field.id, field]))
    const actorName = resolveTicketActorName(db, context.id)

    let ticketId: number
    if (!existing) {
      const inserted = db.prepare(`
        INSERT INTO ticket_responses (collection_response_id, collection_id, ticket_template_id, filled_by, filled_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(responseId, collectionId, templateId, context.id)
      ticketId = Number(inserted.lastInsertRowid)
    } else {
      ticketId = existing.id
      db.prepare(`
        UPDATE ticket_responses
        SET filled_by = ?, filled_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(context.id, ticketId)
    }

    const upsert = db.prepare(`
      INSERT INTO ticket_response_values (ticket_response_id, ticket_field_id, value)
      VALUES (?, ?, ?)
      ON CONFLICT(ticket_response_id, ticket_field_id) DO UPDATE SET value = excluded.value
    `)

    for (const valueRow of values) {
      if (!fieldMetaById.has(valueRow.fieldId)) continue
      upsert.run(ticketId, valueRow.fieldId, valueRow.value)

      const oldValue = normalizeTicketAuditValue(previousValueByFieldId.get(valueRow.fieldId))
      const newValue = normalizeTicketAuditValue(valueRow.value)
      if (oldValue === newValue) continue

      const fieldMeta = fieldMetaById.get(valueRow.fieldId)
      insertTicketHistoryEntry(db, {
        ticketResponseId: ticketId,
        ticketFieldId: valueRow.fieldId,
        ticketFieldKey: fieldMeta?.field_key ?? null,
        fieldLabelSnapshot: fieldMeta?.label ?? `Field #${valueRow.fieldId}`,
        fieldTypeSnapshot: fieldMeta?.type ?? null,
        eventType: 'field_changed',
        oldValue,
        newValue,
        changedBy: context.id,
        changedByName: actorName,
      })
    }

    const savedValues = db.prepare('SELECT ticket_field_id, value FROM ticket_response_values WHERE ticket_response_id = ?').all(ticketId) as Array<{ ticket_field_id: number; value: string | null }>
    const savedTicket = db.prepare(`
      SELECT tr.*, u.name AS finalized_by_name
      FROM ticket_responses tr
      LEFT JOIN users u ON u.id = tr.finalized_by
      WHERE tr.id = ?
    `).get(ticketId) as {
      id: number
      collection_response_id: number
      collection_id: number
      ticket_template_id: number | null
      filled_by: number | null
      filled_at: string | null
      finalized: number
      finalized_at: string | null
      finalized_by_name: string | null
    }

    res.json(serializeTicketResponse(savedTicket, savedValues))
  } catch (err) {
    console.error('[collections] save template ticket:', err)
    res.status(500).json({ error: 'Failed to save ticket' })
  }
})

// POST /:id/responses/:responseId/tickets/:templateId/finalize — toggle ticket closed/open
router.post('/:id/responses/:responseId/tickets/:templateId/finalize', authenticateToken, (req: Request, res: Response): void => {
  const context = loadRequestUserContext(req)
  const collectionId = parseInt(req.params.id, 10)
  const responseId = parseInt(req.params.responseId, 10)
  const templateId = parseInt(req.params.templateId, 10)
  if (!context || isNaN(collectionId) || isNaN(responseId) || isNaN(templateId)) { res.status(400).json({ error: 'Invalid request' }); return }
  if (!canViewResponses(context)) { res.status(403).json({ error: 'Staff access required' }); return }

  try {
    const db = getDb()
    const collection = fetchAccessibleCollectionById(collectionId, context)
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return }
    const template = fetchAccessibleTicketTemplateForCollection(db, collectionId, templateId)
    if (!template) { res.status(404).json({ error: 'Ticket template not assigned to this collection' }); return }

    const ticket = db.prepare(`
      SELECT id, finalized
      FROM ticket_responses
      WHERE collection_response_id = ? AND collection_id = ? AND ticket_template_id = ?
      LIMIT 1
    `).get(responseId, collectionId, templateId) as { id: number; finalized: number } | undefined
    if (!ticket) { res.status(404).json({ error: 'Ticket not found. Save a draft first.' }); return }

    const nowClosed = ticket.finalized !== 1
    const actorName = resolveTicketActorName(db, context.id)
    if (nowClosed) {
      db.prepare(`
        UPDATE ticket_responses
        SET finalized = 1, finalized_at = datetime('now'), finalized_by = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(context.id, ticket.id)
    } else {
      db.prepare(`
        UPDATE ticket_responses
        SET finalized = 0, finalized_at = NULL, finalized_by = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).run(ticket.id)
    }

    insertTicketHistoryEntry(db, {
      ticketResponseId: ticket.id,
      eventType: nowClosed ? 'ticket_closed' : 'ticket_reopened',
      oldValue: nowClosed ? 'open' : 'closed',
      newValue: nowClosed ? 'closed' : 'open',
      changedBy: context.id,
      changedByName: actorName,
      fieldLabelSnapshot: 'Ticket status',
    })

    const updatedTicket = db.prepare(`
      SELECT tr.*, u.name AS finalized_by_name
      FROM ticket_responses tr
      LEFT JOIN users u ON u.id = tr.finalized_by
      WHERE tr.id = ?
    `).get(ticket.id) as {
      id: number
      collection_response_id: number
      collection_id: number
      ticket_template_id: number | null
      filled_by: number | null
      filled_at: string | null
      finalized: number
      finalized_at: string | null
      finalized_by_name: string | null
    }
    const values = db.prepare('SELECT ticket_field_id, value FROM ticket_response_values WHERE ticket_response_id = ?').all(ticket.id) as Array<{ ticket_field_id: number; value: string | null }>

    res.json(serializeTicketResponse(updatedTicket, values))
  } catch (err) {
    console.error('[collections] toggle template ticket closed:', err)
    res.status(500).json({ error: 'Failed to update ticket' })
  }
})

// GET /:id/responses/:responseId/tickets/:templateId/history — list ticket history entries
router.get('/:id/responses/:responseId/tickets/:templateId/history', authenticateToken, (req: Request, res: Response): void => {
  const context = loadRequestUserContext(req)
  const collectionId = parseInt(req.params.id, 10)
  const responseId = parseInt(req.params.responseId, 10)
  const templateId = parseInt(req.params.templateId, 10)
  if (!context || isNaN(collectionId) || isNaN(responseId) || isNaN(templateId)) { res.status(400).json({ error: 'Invalid request' }); return }
  if (!canViewResponses(context)) { res.status(403).json({ error: 'Access denied' }); return }

  try {
    const db = getDb()
    const collection = fetchAccessibleCollectionById(collectionId, context)
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return }
    const template = fetchAccessibleTicketTemplateForCollection(db, collectionId, templateId)
    if (!template) { res.status(404).json({ error: 'Ticket template not assigned to this collection' }); return }

    const ticket = db.prepare(`
      SELECT id
      FROM ticket_responses
      WHERE collection_response_id = ? AND collection_id = ? AND ticket_template_id = ?
      LIMIT 1
    `).get(responseId, collectionId, templateId) as { id: number } | undefined

    if (!ticket) { res.json([]); return }

    const rows = db.prepare(`
      SELECT
        id,
        ticket_field_id,
        ticket_field_key,
        field_label_snapshot,
        field_type_snapshot,
        event_type,
        old_value,
        new_value,
        changed_by,
        changed_by_name,
        changed_at
      FROM ticket_history
      WHERE ticket_response_id = ?
      ORDER BY datetime(changed_at) DESC, id DESC
    `).all(ticket.id) as Array<{
      id: number
      ticket_field_id: number | null
      ticket_field_key: string | null
      field_label_snapshot: string | null
      field_type_snapshot: string | null
      event_type: TicketHistoryEventType
      old_value: string | null
      new_value: string | null
      changed_by: number | null
      changed_by_name: string | null
      changed_at: string
    }>

    res.json(rows.map(row => ({
      id: row.id,
      fieldId: row.ticket_field_id,
      fieldKey: row.ticket_field_key,
      fieldLabel: row.field_label_snapshot,
      fieldType: row.field_type_snapshot,
      eventType: row.event_type,
      oldValue: row.old_value,
      newValue: row.new_value,
      changedBy: row.changed_by,
      changedByName: row.changed_by_name,
      changedAt: row.changed_at,
    })))
  } catch (err) {
    console.error('[collections] get template ticket history:', err)
    res.status(500).json({ error: 'Failed to get ticket history' })
  }
})

// GET /:id/ticket — return ticket field definitions for a collection
router.get('/:id/ticket', authenticateToken, (req: Request, res: Response): void => {
  const context = loadRequestUserContext(req)
  const id = parseInt(req.params.id, 10)
  if (!context || isNaN(id)) { res.status(400).json({ error: 'Invalid request' }); return }
  if (!canViewResponses(context)) { res.status(403).json({ error: 'Access denied' }); return }

  try {
    const db = getDb()
    const collection = fetchAccessibleCollectionById(id, context)
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return }

    const assignedTemplate = fetchAssignedTicketTemplates(db, id)[0]
    if (!assignedTemplate) { res.json([]); return }

    const fields = db
      .prepare('SELECT * FROM ticket_fields WHERE ticket_template_id = ? ORDER BY page_number ASC, sort_order ASC, id ASC')
      .all(assignedTemplate.ticket_template_id) as Array<{ id: number; collection_id: number | null; ticket_template_id: number | null; field_key: string | null; type: string; label: string; subtitle: string | null; page_number: number; required: number; options: string | null; display_style: string; sort_order: number }>

    const fieldIds = fields.map(f => f.id)
    const cols: Array<{ id: number; ticket_field_id: number; name: string; col_type: string; list_options: string | null; sort_order: number }> =
      fieldIds.length > 0
        ? (db.prepare(`SELECT * FROM ticket_table_columns WHERE ticket_field_id IN (${fieldIds.map(() => '?').join(',')}) ORDER BY sort_order ASC`).all(...fieldIds) as typeof cols)
        : []

    const colsByFieldId = new Map<number, typeof cols>()
    cols.forEach(col => {
      const arr = colsByFieldId.get(col.ticket_field_id) ?? []
      arr.push(col)
      colsByFieldId.set(col.ticket_field_id, arr)
    })

    res.json(fields.map(f => ({
      id: f.id,
      fieldKey: f.field_key ?? `tf-${f.id}`,
      type: f.type,
      label: f.label,
      subtitle: f.subtitle ?? null,
      page: f.page_number,
      required: f.required === 1,
      options: f.options ? (JSON.parse(f.options) as string[]) : null,
      displayStyle: resolveFieldDisplayStyle(f.type as FieldType, f.display_style),
      sortOrder: f.sort_order,
      tableColumns: f.type === 'custom_table'
        ? (colsByFieldId.get(f.id) ?? []).map(col => ({
            id: col.id,
            name: col.name,
            colType: col.col_type,
            listOptions: col.col_type === 'list' && col.list_options ? (JSON.parse(col.list_options) as string[]) : null,
            sortOrder: col.sort_order,
          }))
        : null,
    })))
  } catch (err) {
    console.error('[collections] get ticket fields:', err)
    res.status(500).json({ error: 'Failed to get ticket fields' })
  }
})

// PUT /:id/ticket — replace all ticket fields for a collection
router.put('/:id/ticket', authenticateToken, (req: Request, res: Response): void => {
  const context = loadRequestUserContext(req)
  const id = parseInt(req.params.id, 10)
  if (!context || isNaN(id)) { res.status(400).json({ error: 'Invalid request' }); return }
  if (!isAdministrator(context) && context.role !== 'administrator' && context.role !== 'team_manager') {
    res.status(403).json({ error: 'Manager access required' }); return
  }

  try {
    const db = getDb()
    const collection = fetchAccessibleCollectionById(id, context)
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return }

    const assignedTemplate = fetchAssignedTicketTemplates(db, id)[0]
    if (!assignedTemplate) { res.status(400).json({ error: 'Assign a ticket template before editing ticket fields' }); return }

    const body = req.body as { fields?: FieldInput[] }
    const fields = Array.isArray(body.fields) ? body.fields : []
    const existingFields = db
      .prepare('SELECT id, field_key FROM ticket_fields WHERE ticket_template_id = ?')
      .all(assignedTemplate.ticket_template_id) as Array<{ id: number; field_key: string | null }>
    const oldFieldIds = existingFields.map(field => field.id)
    const existingFieldKeyById = new Map(
      existingFields.map(field => [field.id, field.field_key?.trim() || `tf-${field.id}`])
    )

    // Disable FK checks so we can replace ticket_fields even when
    // ticket_response_values already reference them
    try { db.exec('PRAGMA foreign_keys = OFF') } catch { /* Turso */ }

    // Delete existing ticket fields (cascade removes ticket_table_columns)
    db.prepare('DELETE FROM ticket_fields WHERE ticket_template_id = ?').run(assignedTemplate.ticket_template_id)

    const newFieldIdByKey = new Map<string, number>()

    fields.forEach((field, idx) => {
      const normalizedFieldKey = field.fieldKey?.trim() || crypto.randomUUID()
      const r = db.prepare(
        `INSERT INTO ticket_fields (collection_id, ticket_template_id, field_key, type, label, subtitle, page_number, required, options, display_style, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        null,
        assignedTemplate.ticket_template_id,
        normalizedFieldKey,
        field.type,
        field.label,
        field.subtitle?.trim() || null,
        Math.max(1, Math.floor(field.page ?? 1)),
        field.required ? 1 : 0,
        field.options?.length ? JSON.stringify(field.options) : null,
        resolveFieldDisplayStyle(field.type, field.displayStyle),
        field.sortOrder ?? idx,
      )
      if (!newFieldIdByKey.has(normalizedFieldKey)) {
        newFieldIdByKey.set(normalizedFieldKey, Number(r.lastInsertRowid))
      }
      if (field.type === 'custom_table' && field.tableColumns?.length) {
        const fieldId = r.lastInsertRowid as number
        field.tableColumns.forEach((col, ci) => {
          db.prepare(
            `INSERT INTO ticket_table_columns (ticket_field_id, name, col_type, list_options, sort_order) VALUES (?, ?, ?, ?, ?)`
          ).run(
            fieldId, col.name, col.colType,
            col.colType === 'list' ? JSON.stringify((col.listOptions ?? []).map(o => o.trim()).filter(Boolean)) : null,
            col.sortOrder ?? ci,
          )
        })
      }
    })

    if (oldFieldIds.length > 0) {
      const obsoleteFieldIds: number[] = []
      const remapValueField = db.prepare(
        'UPDATE ticket_response_values SET ticket_field_id = ? WHERE ticket_field_id = ?'
      )

      oldFieldIds.forEach(oldFieldId => {
        const fieldKey = existingFieldKeyById.get(oldFieldId)
        const replacementFieldId = fieldKey ? newFieldIdByKey.get(fieldKey) : undefined
        if (replacementFieldId) {
          remapValueField.run(replacementFieldId, oldFieldId)
        } else {
          obsoleteFieldIds.push(oldFieldId)
        }
      })

      if (obsoleteFieldIds.length > 0) {
        db.prepare(
          `DELETE FROM ticket_response_values WHERE ticket_field_id IN (${obsoleteFieldIds.map(() => '?').join(',')})`
        ).run(...obsoleteFieldIds)
      }
    }

    try { db.exec('PRAGMA foreign_keys = ON') } catch { /* Turso */ }
    res.json({ ok: true })
  } catch (err) {
    const db2 = getDb()
    try { db2.exec('PRAGMA foreign_keys = ON') } catch { /* Turso */ }
    console.error('[collections] save ticket fields:', err)
    res.status(500).json({ error: 'Failed to save ticket fields' })
  }
})

// ── Ticket instance routes ─────────────────────────────────────────────────

// GET /:id/responses/:responseId/ticket — get ticket instance (or null)
router.get('/:id/responses/:responseId/ticket', authenticateToken, (req: Request, res: Response): void => {
  const context = loadRequestUserContext(req)
  const collectionId = parseInt(req.params.id, 10)
  const responseId = parseInt(req.params.responseId, 10)
  if (!context || isNaN(collectionId) || isNaN(responseId)) { res.status(400).json({ error: 'Invalid request' }); return }
  if (!canViewResponses(context)) { res.status(403).json({ error: 'Access denied' }); return }

  try {
    const db = getDb()
    const collection = fetchAccessibleCollectionById(collectionId, context)
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return }

    type TicketRow = { id: number; collection_response_id: number; collection_id: number; filled_by: number | null; filled_at: string | null; finalized: number; finalized_at: string | null; finalized_by: number | null; finalized_by_name: string | null; created_at: string; updated_at: string }
    const ticket = db
      .prepare(`SELECT tr.*, u.name AS finalized_by_name FROM ticket_responses tr LEFT JOIN users u ON u.id = tr.finalized_by WHERE tr.collection_response_id = ? AND tr.collection_id = ?`)
      .get(responseId, collectionId) as TicketRow | undefined

    if (!ticket) { res.json(null); return }

    const values = db
      .prepare('SELECT ticket_field_id, value FROM ticket_response_values WHERE ticket_response_id = ?')
      .all(ticket.id) as Array<{ ticket_field_id: number; value: string | null }>

    res.json({
      id: ticket.id,
      collectionResponseId: ticket.collection_response_id,
      collectionId: ticket.collection_id,
      filledBy: ticket.filled_by,
      filledAt: ticket.filled_at,
      finalized: ticket.finalized === 1,
      finalizedAt: ticket.finalized_at,
      finalizedByName: ticket.finalized_by_name,
      values: values.map(v => ({ fieldId: v.ticket_field_id, value: v.value })),
    })
  } catch (err) {
    console.error('[collections] get ticket:', err)
    res.status(500).json({ error: 'Failed to get ticket' })
  }
})

// POST /:id/responses/:responseId/ticket — create or update ticket draft
router.post('/:id/responses/:responseId/ticket', authenticateToken, (req: Request, res: Response): void => {
  const context = loadRequestUserContext(req)
  const collectionId = parseInt(req.params.id, 10)
  const responseId = parseInt(req.params.responseId, 10)
  if (!context || isNaN(collectionId) || isNaN(responseId)) { res.status(400).json({ error: 'Invalid request' }); return }
  if (!canViewResponses(context)) { res.status(403).json({ error: 'Staff access required' }); return }

  try {
    const db = getDb()
    const collection = fetchAccessibleCollectionById(collectionId, context)
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return }

    const responseRow = db
      .prepare('SELECT id FROM collection_responses WHERE id = ? AND collection_id = ?')
      .get(responseId, collectionId) as { id: number } | undefined
    if (!responseRow) { res.status(404).json({ error: 'Response not found' }); return }

    const existing = db
      .prepare('SELECT id, finalized FROM ticket_responses WHERE collection_response_id = ? AND collection_id = ?')
      .get(responseId, collectionId) as { id: number; finalized: number } | undefined
    const body = req.body as { values?: Array<{ fieldId: number; value: string }> }
    const values = Array.isArray(body.values) ? body.values : []
    const existingValues = existing
      ? db.prepare('SELECT ticket_field_id, value FROM ticket_response_values WHERE ticket_response_id = ?').all(existing.id) as Array<{ ticket_field_id: number; value: string | null }>
      : []
    const previousValueByFieldId = new Map(existingValues.map(value => [value.ticket_field_id, value.value]))
    const fieldRows = db
      .prepare('SELECT id, field_key, label, type FROM ticket_fields WHERE collection_id = ?')
      .all(collectionId) as Array<{ id: number; field_key: string | null; label: string; type: string }>
    const fieldMetaById = new Map(fieldRows.map(field => [field.id, field]))
    const actorName = resolveTicketActorName(db, context.id)

    let ticketId: number
    if (!existing) {
      const r = db.prepare(
        `INSERT INTO ticket_responses (collection_response_id, collection_id, filled_by, filled_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))`
      ).run(responseId, collectionId, context.id)
      ticketId = r.lastInsertRowid as number
    } else {
      ticketId = existing.id
      db.prepare(`UPDATE ticket_responses SET filled_by = ?, filled_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
        .run(context.id, ticketId)
    }

    const upsert = db.prepare(
      `INSERT INTO ticket_response_values (ticket_response_id, ticket_field_id, value) VALUES (?, ?, ?)
       ON CONFLICT(ticket_response_id, ticket_field_id) DO UPDATE SET value = excluded.value`
    )
    for (const v of values) {
      upsert.run(ticketId, v.fieldId, v.value)

      const oldValue = normalizeTicketAuditValue(previousValueByFieldId.get(v.fieldId))
      const newValue = normalizeTicketAuditValue(v.value)
      if (oldValue === newValue) continue

      const fieldMeta = fieldMetaById.get(v.fieldId)
      insertTicketHistoryEntry(db, {
        ticketResponseId: ticketId,
        ticketFieldId: v.fieldId,
        ticketFieldKey: fieldMeta?.field_key ?? null,
        fieldLabelSnapshot: fieldMeta?.label ?? `Field #${v.fieldId}`,
        fieldTypeSnapshot: fieldMeta?.type ?? null,
        eventType: 'field_changed',
        oldValue,
        newValue,
        changedBy: context.id,
        changedByName: actorName,
      })
    }

    const savedValues = db
      .prepare('SELECT ticket_field_id, value FROM ticket_response_values WHERE ticket_response_id = ?')
      .all(ticketId) as Array<{ ticket_field_id: number; value: string | null }>

    res.json({
      id: ticketId,
      collectionResponseId: responseId,
      collectionId: collectionId,
      filledBy: context.id,
      filledAt: new Date().toISOString(),
      finalized: false,
      finalizedAt: null,
      finalizedByName: null,
      values: savedValues.map(v => ({ fieldId: v.ticket_field_id, value: v.value })),
    })
  } catch (err) {
    console.error('[collections] save ticket:', err)
    res.status(500).json({ error: 'Failed to save ticket' })
  }
})

// POST /:id/responses/:responseId/ticket/finalize — toggle ticket closed/open
router.post('/:id/responses/:responseId/ticket/finalize', authenticateToken, (req: Request, res: Response): void => {
  const context = loadRequestUserContext(req)
  const collectionId = parseInt(req.params.id, 10)
  const responseId = parseInt(req.params.responseId, 10)
  if (!context || isNaN(collectionId) || isNaN(responseId)) { res.status(400).json({ error: 'Invalid request' }); return }
  if (!canViewResponses(context)) { res.status(403).json({ error: 'Staff access required' }); return }

  try {
    const db = getDb()
    const collection = fetchAccessibleCollectionById(collectionId, context)
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return }

    const ticket = db
      .prepare('SELECT id, finalized FROM ticket_responses WHERE collection_response_id = ? AND collection_id = ?')
      .get(responseId, collectionId) as { id: number; finalized: number } | undefined
    if (!ticket) { res.status(404).json({ error: 'Ticket not found. Save a draft first.' }); return }

    const nowClosed = ticket.finalized !== 1
    const actorName = resolveTicketActorName(db, context.id)
    if (nowClosed) {
      db.prepare(
        `UPDATE ticket_responses SET finalized = 1, finalized_at = datetime('now'), finalized_by = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(context.id, ticket.id)
    } else {
      db.prepare(
        `UPDATE ticket_responses SET finalized = 0, finalized_at = NULL, finalized_by = NULL, updated_at = datetime('now') WHERE id = ?`
      ).run(ticket.id)
    }

    insertTicketHistoryEntry(db, {
      ticketResponseId: ticket.id,
      eventType: nowClosed ? 'ticket_closed' : 'ticket_reopened',
      oldValue: nowClosed ? 'open' : 'closed',
      newValue: nowClosed ? 'closed' : 'open',
      changedBy: context.id,
      changedByName: actorName,
      fieldLabelSnapshot: 'Ticket status',
    })

    const userRow = nowClosed
      ? db.prepare('SELECT name FROM users WHERE id = ?').get(context.id) as { name: string } | undefined
      : undefined
    const values = db
      .prepare('SELECT ticket_field_id, value FROM ticket_response_values WHERE ticket_response_id = ?')
      .all(ticket.id) as Array<{ ticket_field_id: number; value: string | null }>

    res.json({
      id: ticket.id,
      collectionResponseId: responseId,
      collectionId: collectionId,
      filledBy: context.id,
      filledAt: null,
      finalized: nowClosed,
      finalizedAt: nowClosed ? new Date().toISOString() : null,
      finalizedByName: nowClosed ? (userRow?.name ?? null) : null,
      values: values.map(v => ({ fieldId: v.ticket_field_id, value: v.value })),
    })
  } catch (err) {
    console.error('[collections] toggle ticket closed:', err)
    res.status(500).json({ error: 'Failed to update ticket' })
  }
})

// GET /:id/responses/:responseId/ticket/history — list ticket history entries
router.get('/:id/responses/:responseId/ticket/history', authenticateToken, (req: Request, res: Response): void => {
  const context = loadRequestUserContext(req)
  const collectionId = parseInt(req.params.id, 10)
  const responseId = parseInt(req.params.responseId, 10)
  if (!context || isNaN(collectionId) || isNaN(responseId)) { res.status(400).json({ error: 'Invalid request' }); return }
  if (!canViewResponses(context)) { res.status(403).json({ error: 'Access denied' }); return }

  try {
    const db = getDb()
    const collection = fetchAccessibleCollectionById(collectionId, context)
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return }

    const ticket = db
      .prepare('SELECT id FROM ticket_responses WHERE collection_response_id = ? AND collection_id = ?')
      .get(responseId, collectionId) as { id: number } | undefined

    if (!ticket) {
      res.json([])
      return
    }

    const rows = db.prepare(`
      SELECT
        id,
        ticket_field_id,
        ticket_field_key,
        field_label_snapshot,
        field_type_snapshot,
        event_type,
        old_value,
        new_value,
        changed_by,
        changed_by_name,
        changed_at
      FROM ticket_history
      WHERE ticket_response_id = ?
      ORDER BY datetime(changed_at) DESC, id DESC
    `).all(ticket.id) as Array<{
      id: number
      ticket_field_id: number | null
      ticket_field_key: string | null
      field_label_snapshot: string | null
      field_type_snapshot: string | null
      event_type: TicketHistoryEventType
      old_value: string | null
      new_value: string | null
      changed_by: number | null
      changed_by_name: string | null
      changed_at: string
    }>

    res.json(rows.map(row => ({
      id: row.id,
      fieldId: row.ticket_field_id,
      fieldKey: row.ticket_field_key,
      fieldLabel: row.field_label_snapshot,
      fieldType: row.field_type_snapshot,
      eventType: row.event_type,
      oldValue: row.old_value,
      newValue: row.new_value,
      changedBy: row.changed_by,
      changedByName: row.changed_by_name,
      changedAt: row.changed_at,
    })))
  } catch (err) {
    console.error('[collections] get ticket history:', err)
    res.status(500).json({ error: 'Failed to get ticket history' })
  }
})

// GET /:id/tickets — list all ticket responses for a collection
router.get('/:id/tickets', authenticateToken, (req: Request, res: Response): void => {
  const context = loadRequestUserContext(req)
  const collectionId = parseInt(req.params.id, 10)
  if (!context || isNaN(collectionId)) { res.status(400).json({ error: 'Invalid request' }); return }
  if (!canViewResponses(context)) { res.status(403).json({ error: 'Staff access required' }); return }

  try {
    const db = getDb()
    const collection = fetchAccessibleCollectionById(collectionId, context)
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return }

    type TicketListRow = {
      id: number
      collection_response_id: number
      ticket_template_id: number | null
      ticket_template_title: string | null
      filled_by: number | null
      filled_at: string | null
      finalized: number
      finalized_at: string | null
      finalized_by_name: string | null
      submitter_name: string | null
      submitter_email: string | null
      submitted_at: string | null
    }

    const rows = db.prepare(`
      SELECT
        tr.id,
        tr.collection_response_id,
        tr.ticket_template_id,
        tt.title         AS ticket_template_title,
        tr.filled_by,
        tr.filled_at,
        tr.finalized,
        tr.finalized_at,
        fu.name          AS finalized_by_name,
        cr.respondent_name  AS submitter_name,
        cr.respondent_email AS submitter_email,
        cr.submitted_at
      FROM ticket_responses tr
      LEFT JOIN ticket_templates tt ON tt.id = tr.ticket_template_id
      LEFT JOIN users fu ON fu.id = tr.finalized_by
      LEFT JOIN collection_responses cr ON cr.id = tr.collection_response_id
      WHERE tr.collection_id = ?
      ORDER BY tr.id DESC
    `).all(collectionId) as TicketListRow[]

    const ticketIds = rows.map(r => r.id)

    type ValRow = { ticket_response_id: number; ticket_field_id: number; value: string | null }
    let valRows: ValRow[] = []
    if (ticketIds.length > 0) {
      const placeholders = ticketIds.map(() => '?').join(',')
      valRows = db.prepare(
        `SELECT ticket_response_id, ticket_field_id, value FROM ticket_response_values WHERE ticket_response_id IN (${placeholders})`
      ).all(...ticketIds) as ValRow[]
    }

    const valuesByTicket = new Map<number, Array<{ fieldId: number; value: string | null }>>()
    for (const v of valRows) {
      const arr = valuesByTicket.get(v.ticket_response_id) ?? []
      arr.push({ fieldId: v.ticket_field_id, value: v.value })
      valuesByTicket.set(v.ticket_response_id, arr)
    }

    res.json(rows.map(r => ({
      id: r.id,
      collectionResponseId: r.collection_response_id,
      ticketTemplateId: r.ticket_template_id,
      ticketTitle: r.ticket_template_title,
      finalized: r.finalized === 1,
      finalizedAt: r.finalized_at,
      finalizedByName: r.finalized_by_name,
      submitterName: r.submitter_name,
      submitterEmail: r.submitter_email,
      submittedAt: r.submitted_at,
      values: valuesByTicket.get(r.id) ?? [],
    })))
  } catch (err) {
    console.error('[collections] list tickets:', err)
    res.status(500).json({ error: 'Failed to list tickets' })
  }
})

// ── Collection Share Routes ────────────────────────────────────────────────

// GET /api/collections/:id/shares
router.get('/:id/shares', authenticateToken, (req: Request, res: Response) => {
  const context = loadRequestUserContext(req)
  if (!context) return void res.status(401).json({ error: 'Authentication required' })

  const id = Number(req.params.id)
  const db = getDb()
  const collection = fetchAccessibleCollectionById(id, context)
  if (!collection) return void res.status(404).json({ error: 'Collection not found' })

  const userShares = db.prepare(`
    SELECT u.id, u.name, u.email
    FROM collection_shares cs
    JOIN users u ON u.id = cs.share_target_id
    WHERE cs.collection_id = ? AND cs.share_type = 'user'
    ORDER BY lower(u.name)
  `).all(id) as Array<{ id: number; name: string; email: string }>

  const groupShares = db.prepare(`
    SELECT g.id, g.name
    FROM collection_shares cs
    JOIN groups g ON g.id = cs.share_target_id
    WHERE cs.collection_id = ? AND cs.share_type = 'group'
    ORDER BY lower(g.name)
  `).all(id) as Array<{ id: number; name: string }>

  res.json({ users: userShares, groups: groupShares })
})

// PUT /api/collections/:id/shares  body: { userIds: number[], groupIds: number[] }
router.put('/:id/shares', authenticateToken, (req: Request, res: Response) => {
  const context = loadRequestUserContext(req)
  if (!context) return void res.status(401).json({ error: 'Authentication required' })

  const canManage = context.role === 'super_admin' || context.role === 'administrator' || context.role === 'team_manager'
  if (!canManage) return void res.status(403).json({ error: 'Insufficient permissions' })

  const id = Number(req.params.id)
  const { userIds = [], groupIds = [] } = req.body as { userIds?: number[]; groupIds?: number[] }

  const db = getDb()
  const collection = fetchAccessibleCollectionById(id, context)
  if (!collection) return void res.status(404).json({ error: 'Collection not found' })

  // Replace all shares atomically
  db.prepare(`DELETE FROM collection_shares WHERE collection_id = ?`).run(id)

  const insertShare = db.prepare(`
    INSERT OR IGNORE INTO collection_shares (collection_id, share_type, share_target_id, granted_by)
    VALUES (?, ?, ?, ?)
  `)

  for (const uid of userIds) {
    insertShare.run(id, 'user', uid, context.id)
  }
  for (const gid of groupIds) {
    insertShare.run(id, 'group', gid, context.id)
  }

  res.json({ success: true })
})

export default router
