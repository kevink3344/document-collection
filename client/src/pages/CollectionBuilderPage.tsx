import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  GitBranch,
  Settings2,
  Save,
  Eye,
  Copy,
  Image as ImageIcon,
  Lock,
  MoreHorizontal,
  X,
  Archive,
  ArchiveRestore,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react'
import {
  createCollection,
  createCollectionVersion,
  getCollection,
  getCollectionShares,
  getCollectionVersion,
  listCollectionVersions,
  publishCollectionVersion,
  restoreCollectionVersion,
  saveCollectionShares,
  updateCollection,
} from '../api/collections'
import { listGalleryAssets } from '../api/galleryAssets'
import { listGroups } from '../api/groups'
import { getPublicSetting } from '../api/settings'
import { getCollectionTicketTemplatesAll, saveCollectionTicketTemplates, setCollectionTicketTemplateActive } from '../api/tickets'
import { listTicketTemplates } from '../api/ticketTemplates'
import { listCategories } from '../api/categories'
import { listUsers, type AppUser } from '../api/users'
import type { Category, Collection, CollectionField, CollectionShare, CollectionTicketTemplate, GalleryAsset, Group, TicketTemplate } from '../types'
import type {
  ApprovalWorkflowCondition,
  ApprovalWorkflowDefinition,
  ApprovalWorkflowStageDefinition,
  ColType,
  CollectionStatus,
  CollectionVersion,
  FieldDisplayStyle,
  FieldType,
  TableColumn,
} from '../types'
import TableWizardModal from '../components/collections/TableWizardModal'
import MatrixLikertConfigModal from '../components/collections/MatrixLikertConfigModal'
import RichTextEditor from '../components/common/RichTextEditor'
import { toEmbedUrl } from '../utils/docPreviewUrl'
import { getDocumentEmbedUrl, parseDocumentFieldConfig, serialiseDocumentFieldConfig, type DocumentFieldKind } from '../utils/documentField'
import { htmlToPlainText } from '../utils/richText'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import type { FieldBranchRule } from '../types'

// ── Local builder types ───────────────────────────────────────

interface BuilderField {
  _key: string
  fieldKey: string
  type: FieldType
  label: string
  subtitle: string
  page: number
  required: boolean
  options: string[]
  displayStyle: FieldDisplayStyle
  branchRules: FieldBranchRule[]
  tableColumns: TableColumn[]
  staffOnly: boolean
  locationFilterEnabled: boolean
}

function resolveDisplayStyle(type: FieldType, displayStyle?: string | null): FieldDisplayStyle {
  if (type === 'single_choice') {
    return displayStyle === 'dropdown' ? 'dropdown' : 'radio'
  }

  if (type === 'rating') {
    return displayStyle === 'numbers' ? 'numbers' : 'stars'
  }

  return 'radio'
}

function uid(): string {
  return Math.random().toString(36).slice(2)
}

function blankField(page = 1): BuilderField {
  return {
    _key: uid(),
    fieldKey: uid(),
    type: 'short_text',
    label: '',
    subtitle: '',
    page,
    required: false,
    options: [],
    displayStyle: 'radio',
    branchRules: [],
    tableColumns: [],
    staffOnly: false,
    locationFilterEnabled: false,
  }
}

function mapCollectionToBuilderFields(collection: Collection): BuilderField[] {
  if (collection.fields.length === 0) {
    return [blankField()]
  }

  return collection.fields.map(f => ({
    _key: uid(),
    fieldKey: f.fieldKey ?? uid(),
    type: normalizeFieldType(f.type),
    label: f.label,
    subtitle: f.subtitle ?? '',
    page: f.page ?? 1,
    required: f.required,
    options: f.options ?? [],
    displayStyle: resolveDisplayStyle(normalizeFieldType(f.type), f.displayStyle),
    branchRules: f.branchRules ?? [],
    tableColumns: (f.tableColumns ?? []).map(tc => ({
      ...tc,
      colType: normalizeColType(tc.colType),
      listOptions:
        tc.colType === 'list'
          ? (tc.listOptions ?? []).map(opt => String(opt).trim()).filter(Boolean)
          : null,
    })),
    staffOnly: f.staffOnly ?? false,
    locationFilterEnabled: f.locationFilterEnabled ?? false,
  }))
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  short_text: 'Short Text',
  date: 'Date',
  long_text: 'Long Text',
  single_choice: 'Single Choice',
  multiple_choice: 'Multiple Choice',
  document: 'Document',
  attachment: 'Attachment',
  signature: 'Signature',
  confirmation: 'Confirmation (Checkbox)',
  custom_table: 'Custom Table',
  rating: 'Rating (1–5)',
  comment: 'Comment (Read-only)',
  matrix_likert_scale: 'Matrix Likert Scale',
  location: 'Location',
}

function normalizeFieldType(type: string): FieldType {
  const valid = new Set<FieldType>([
    'short_text',
    'date',
    'long_text',
    'single_choice',
    'multiple_choice',
    'document',
    'attachment',
    'signature',
    'confirmation',
    'custom_table',
    'rating',
    'comment',
    'matrix_likert_scale',
    'location',
  ])
  return valid.has(type as FieldType) ? (type as FieldType) : 'short_text'
}

function normalizeColType(colType: string): ColType {
  const valid = new Set<ColType>(['text', 'number', 'date', 'checkbox', 'list'])
  return valid.has(colType as ColType) ? (colType as ColType) : 'text'
}

// ── Shared style tokens ───────────────────────────────────────

const INPUT =
  'w-full border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0F172A] ' +
  'text-[#1E293B] dark:text-[#F1F5F9] placeholder-[#94A3B8] px-3 py-2 text-sm rounded ' +
  'focus:outline-none focus:ring-2 focus:ring-[#2563EB]'

const LABEL = 'block text-xs font-medium text-[#64748B] mb-1'
const OTHER_OPTION_MARKER = '__DCP_OTHER_OPTION__'
const APPROVAL_ROLE_OPTIONS = ['administrator', 'team_manager', 'reviewer', 'user'] as const

function blankWorkflowStage(index: number): ApprovalWorkflowStageDefinition {
  return {
    id: `stage-${uid()}`,
    name: `Stage ${index + 1}`,
    approvalMode: 'all',
    assignees: [],
    conditions: null,
    reminderAfterHours: 24,
    escalationAfterHours: 72,
    escalationAssignees: null,
  }
}

function normalizeWorkflowDefinitionForBuilder(definition?: ApprovalWorkflowDefinition | null): ApprovalWorkflowDefinition {
  if (!definition?.enabled || definition.stages.length === 0) {
    return { enabled: false, stages: [blankWorkflowStage(0)] }
  }

  return {
    enabled: true,
    stages: definition.stages.map((stage, index) => ({
      id: stage.id || `stage-${uid()}`,
      name: stage.name || `Stage ${index + 1}`,
      approvalMode: stage.approvalMode === 'any' ? 'any' : 'all',
      assignees: stage.assignees ?? [],
      conditions: stage.conditions && stage.conditions.conditions.length > 0 ? stage.conditions : null,
      reminderAfterHours: stage.reminderAfterHours ?? 24,
      escalationAfterHours: stage.escalationAfterHours ?? 72,
      escalationAssignees: stage.escalationAssignees ?? null,
    })),
  }
}

// ── Component ─────────────────────────────────────────────────

export default function CollectionBuilderPage() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const formId = useId()
  const isEdit = !!id
  const templateId = !isEdit ? searchParams.get('templateId') : null
  const collectionType = searchParams.get('type') === 'template' ? 'template' : 'standard'
  const { showToast } = useToast()
  const { user } = useAuth()

  // Metadata
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [dateDue, setDateDue] = useState('')
  const [coverPhotoUrl, setCoverPhotoUrl] = useState('')
  const [coverPhotoAssetId, setCoverPhotoAssetId] = useState<number | null>(null)
  const [logoUrl, setLogoUrl] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [status, setStatus] = useState<CollectionStatus>('draft')

  // Instructions section
  const [instructions, setInstructions] = useState('')
  const [instructionsDocUrl, setInstructionsDocUrl] = useState('')
  const [allowSubmissionEdits, setAllowSubmissionEdits] = useState(false)
  const [submissionEditWindowHours, setSubmissionEditWindowHours] = useState('24')
  const [workflowEnabled, setWorkflowEnabled] = useState(false)
  const [workflowStages, setWorkflowStages] = useState<ApprovalWorkflowStageDefinition[]>([blankWorkflowStage(0)])
  const [workflowUsers, setWorkflowUsers] = useState<AppUser[]>([])

  // Share state
  const [shareUsers, setShareUsers] = useState<CollectionShare['users']>([])
  const [shareGroups, setShareGroups] = useState<CollectionShare['groups']>([])
  const [availableUsersForShare, setAvailableUsersForShare] = useState<AppUser[]>([])
  const [availableGroupsForShare, setAvailableGroupsForShare] = useState<Group[]>([])
  const [shareSaving, setShareSaving] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [shareLoaded, setShareLoaded] = useState(false)


  // Fields
  const [fields, setFields] = useState<BuilderField[]>([blankField()])
  const [activeBuilderPage, setActiveBuilderPage] = useState(1)

  // UI state
  const [saving, setSaving] = useState(false)
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [wizardField, setWizardField] = useState<string | null>(null) // _key of field being configured
  const [matrixConfigField, setMatrixConfigField] = useState<string | null>(null) // _key of field being configured
  const [collectionSlug, setCollectionSlug] = useState<string | null>(null)
  const [activeVersionId, setActiveVersionId] = useState<number | null>(null)
  const [currentVersionNumber, setCurrentVersionNumber] = useState<number | null>(null)
  const [versions, setVersions] = useState<CollectionVersion[]>([])
  const [detailsTab, setDetailsTab] = useState<'general' | 'photo' | 'share' | 'versions' | 'ticket'>('general')
  const [detailsOverflowOpen, setDetailsOverflowOpen] = useState(false)
  const [versionCompareFromId, setVersionCompareFromId] = useState<number | null>(null)
  const [versionCompareToId, setVersionCompareToId] = useState<number | null>(null)
  const [versionSnapshots, setVersionSnapshots] = useState<Record<number, Collection>>({})
  const [versionDiffLoading, setVersionDiffLoading] = useState(false)
  const [versionDiffError, setVersionDiffError] = useState<string | null>(null)
  const [lastSavedSignature, setLastSavedSignature] = useState<string>('')
  const [pendingRestoreVersionId, setPendingRestoreVersionId] = useState<number | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [pendingRemoveKey, setPendingRemoveKey] = useState<string | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [categoriesError, setCategoriesError] = useState<string | null>(null)
  const [galleryAssets, setGalleryAssets] = useState<GalleryAsset[]>([])
  const [galleryLoading, setGalleryLoading] = useState(false)
  const [galleryError, setGalleryError] = useState<string | null>(null)
  const [logoPadding, setLogoPadding] = useState({ top: 0, right: 0, bottom: 0, left: 0 })

  // Ticket fields
  const [ticketFields, setTicketFields] = useState<BuilderField[]>([])
  const [ticketWizardField, setTicketWizardField] = useState<string | null>(null)
  const [ticketMatrixConfigField, setTicketMatrixConfigField] = useState<string | null>(null)
  const [ticketSaving, setTicketSaving] = useState(false)
  const [ticketSaveError, setTicketSaveError] = useState<string | null>(null)
  const [ticketSaved, setTicketSaved] = useState(false)
  const [availableTicketTemplates, setAvailableTicketTemplates] = useState<TicketTemplate[]>([])
  const [assignedTicketTemplates, setAssignedTicketTemplates] = useState<CollectionTicketTemplate[]>([])
  const [selectedTicketTemplateId, setSelectedTicketTemplateId] = useState('')

  // Used to skip autosave on initial load
  const loadedRef = useRef(false)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [loadTick, setLoadTick] = useState(0)

  const builderPages = useMemo(() => {
    const pages = Array.from(
      new Set(fields.map(field => Math.max(1, Math.floor(field.page || 1))))
    ).sort((a, b) => a - b)

    return pages.length > 0 ? pages : [1]
  }, [fields])

  const visibleFields = useMemo(
    () => fields.filter(field => Math.max(1, Math.floor(field.page || 1)) === activeBuilderPage),
    [activeBuilderPage, fields],
  )

  const selectedCoverAsset = useMemo(
    () => galleryAssets.find(asset => asset.id === coverPhotoAssetId) ?? null,
    [galleryAssets, coverPhotoAssetId],
  )

  const logoPaddingStyle = useMemo<CSSProperties>(() => ({
    paddingTop: `${logoPadding.top}px`,
    paddingRight: `${logoPadding.right}px`,
    paddingBottom: `${logoPadding.bottom}px`,
    paddingLeft: `${logoPadding.left}px`,
  }), [logoPadding.bottom, logoPadding.left, logoPadding.right, logoPadding.top])

  function normalizeFieldsForSignature(fieldsToNormalize: BuilderField[]): BuilderField[] {
    if (fieldsToNormalize.length === 1 && fieldsToNormalize[0].label.trim() === '' && fieldsToNormalize[0].type === 'short_text') {
      return []
    }
    return fieldsToNormalize
  }

  function buildFormSignature(): string {
    return JSON.stringify({
      title: title.trim(),
      description,
      category,
      dateDue,
      coverPhotoUrl,
      coverPhotoAssetId,
      logoUrl,
      anonymous,
      allowSubmissionEdits,
      submissionEditWindowHours,
      status,
      instructions,
      instructionsDocUrl,
      workflowEnabled,
      workflowStages: workflowEnabled ? workflowStages : [],
      fields: normalizeFieldsForSignature(fields).map(({ _key, ...f }) => ({
        ...f,
        tableColumns: f.tableColumns.map(({ id, ...c }) => ({
          ...c,
          listOptions: c.colType === 'list' ? (c.listOptions ?? []).map(opt => opt.trim()).filter(Boolean) : null,
        })),
      })),
    })
  }

  function buildSignatureFromCollection(col: Collection): string {
    const workflow = normalizeWorkflowDefinitionForBuilder(col.workflowDefinition)
    const builderFields = col.fields.length === 0
      ? []
      : col.fields.map(f => ({
          fieldKey: f.fieldKey ?? uid(),
          type: normalizeFieldType(f.type),
          label: f.label,
          subtitle: f.subtitle ?? '',
          page: f.page ?? 1,
          required: f.required,
          options: f.options ?? [],
          displayStyle: resolveDisplayStyle(normalizeFieldType(f.type), f.displayStyle),
          branchRules: f.branchRules ?? [],
          tableColumns: (f.tableColumns ?? []).map(tc => ({
            name: tc.name.trim(),
            colType: normalizeColType(tc.colType),
            listOptions:
              tc.colType === 'list'
                ? (tc.listOptions ?? []).map(opt => String(opt).trim()).filter(Boolean)
                : null,
            sortOrder: tc.sortOrder,
          })),
          staffOnly: f.staffOnly ?? false,
          locationFilterEnabled: f.locationFilterEnabled ?? false,
        }))

    return JSON.stringify({
      title: col.title.trim(),
      description: col.description ? htmlToPlainText(col.description) : '',
      category: col.category ?? '',
      dateDue: col.dateDue ?? '',
      coverPhotoUrl: col.coverPhotoUrl ?? '',
      coverPhotoAssetId: col.coverPhotoAssetId ?? null,
      logoUrl: col.logoUrl ?? '',
      anonymous: col.anonymous,
      allowSubmissionEdits: col.allowSubmissionEdits,
      submissionEditWindowHours: String(col.submissionEditWindowHours ?? 24),
      status: col.status ?? 'draft',
      instructions: col.instructions ?? '',
      instructionsDocUrl: col.instructionsDocUrl ?? '',
      workflowEnabled: workflow.enabled,
      workflowStages: workflow.enabled ? workflow.stages : [],
      fields: builderFields,
    })
  }

  const currentSignature = useMemo(buildFormSignature, [
    title, description, category, dateDue, coverPhotoUrl, coverPhotoAssetId, logoUrl,
    anonymous, allowSubmissionEdits, submissionEditWindowHours, status, instructions,
    instructionsDocUrl, workflowEnabled, workflowStages, fields,
  ])

  const isDirty = useMemo(() => currentSignature !== lastSavedSignature, [currentSignature, lastSavedSignature])

  function applyCollectionToForm(col: Collection, options?: { asTemplate?: boolean }) {
    const asTemplate = options?.asTemplate === true

    setTitle(col.title)
    setCollectionSlug(asTemplate ? null : col.slug)
    setActiveVersionId(asTemplate ? null : col.activeVersionId ?? null)
    setCurrentVersionNumber(asTemplate ? null : col.currentVersionNumber ?? null)
    setDescription(col.description ? htmlToPlainText(col.description) : '')
    setCategory(col.category ?? '')
    setDateDue(asTemplate ? '' : col.dateDue ?? '')
    setCoverPhotoUrl(col.coverPhotoUrl ?? '')
    setCoverPhotoAssetId(col.coverPhotoAssetId ?? null)
    setLogoUrl(col.logoUrl ?? '')
    setAnonymous(col.anonymous)
    setAllowSubmissionEdits(col.allowSubmissionEdits)
    setSubmissionEditWindowHours(String(col.submissionEditWindowHours ?? 24))

    setStatus(asTemplate ? 'draft' : (col.status ?? 'draft'))
    setInstructions(col.instructions ?? '')
    setInstructionsDocUrl(col.instructionsDocUrl ?? '')
    const workflow = normalizeWorkflowDefinitionForBuilder(col.workflowDefinition)
    setWorkflowEnabled(workflow.enabled)
    setWorkflowStages(workflow.stages)
    setFields(mapCollectionToBuilderFields(col))
    setActiveBuilderPage(1)
    setSaveError(null)
  }

  useEffect(() => {
    setActiveBuilderPage(current => {
      if (builderPages.includes(current)) {
        return current
      }

      return builderPages[0]
    })
  }, [builderPages])

  // Load existing collection when editing
  useEffect(() => {
    if (!id) return
    setLoadError(null)
    getCollection(parseInt(id, 10))
      .then(col => {
        applyCollectionToForm(col)
        setLastSavedSignature(buildSignatureFromCollection(col))
        setLoadTick(t => t + 1)
      })
      .catch(err => setLoadError((err as Error).message))
  }, [id, isEdit])

  useEffect(() => {
    Promise.all([
      getPublicSetting('image_logo_padding_top').catch(() => '0'),
      getPublicSetting('image_logo_padding_right').catch(() => '0'),
      getPublicSetting('image_logo_padding_bottom').catch(() => '0'),
      getPublicSetting('image_logo_padding_left').catch(() => '0'),
    ]).then(([top, right, bottom, left]) => {
      setLogoPadding({
        top: Math.max(0, Number.parseInt(top, 10) || 0),
        right: Math.max(0, Number.parseInt(right, 10) || 0),
        bottom: Math.max(0, Number.parseInt(bottom, 10) || 0),
        left: Math.max(0, Number.parseInt(left, 10) || 0),
      })
    })
  }, [])

  useEffect(() => {
    if (detailsTab !== 'photo') return
    setGalleryLoading(true)
    setGalleryError(null)
    listGalleryAssets()
      .then(setGalleryAssets)
      .catch(err => setGalleryError((err as Error).message))
      .finally(() => setGalleryLoading(false))
  }, [detailsTab])

  // Load assigned ticket templates when editing (including archived)
  useEffect(() => {
    if (!id || !isEdit) return
    getCollectionTicketTemplatesAll(parseInt(id, 10))
      .then(all => setAssignedTicketTemplates(all))
      .catch(() => setAssignedTicketTemplates([]))
  }, [id, isEdit])

  useEffect(() => {
    if (!isEdit) return
    listTicketTemplates({ organizationOnly: true })
      .then(setAvailableTicketTemplates)
      .catch(() => setAvailableTicketTemplates([]))
  }, [isEdit])

  useEffect(() => {
    if (isEdit || !templateId) return

    const parsedId = Number(templateId)
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      setLoadError('Template not found.')
      return
    }

    setLoadError(null)
    getCollection(parsedId)
      .then(col => {
        applyCollectionToForm(col, { asTemplate: true })
        showToast(`Template loaded from "${col.title}"`, 'success')
      })
      .catch(err => setLoadError((err as Error).message))
  }, [isEdit, showToast, templateId])

  useEffect(() => {
    listCategories()
      .then(setCategories)
      .catch(err => setCategoriesError((err as Error).message))
      .finally(() => setCategoriesLoading(false))
  }, [])

  useEffect(() => {
    listUsers()
      .then(setWorkflowUsers)
      .catch(() => setWorkflowUsers([]))
  }, [])

  useEffect(() => {
    if (!id) return
    listCollectionVersions(parseInt(id, 10))
      .then(setVersions)
      .catch(() => setVersions([]))
  }, [id, loadTick])

  useEffect(() => {
    if (versions.length === 0) {
      setVersionCompareFromId(null)
      setVersionCompareToId(null)
      return
    }

    setVersionCompareToId(prev => prev ?? versions[0].id)
    setVersionCompareFromId(prev => {
      if (prev) return prev
      if (versions.length > 1) return versions[1].id
      return versions[0].id
    })
  }, [versions])

  useEffect(() => {
    setDetailsOverflowOpen(false)
  }, [detailsTab])

  useEffect(() => {
    if (!id || detailsTab !== 'share' || shareLoaded) return
    setShareLoaded(true)
    Promise.all([
      getCollectionShares(parseInt(id, 10)),
      listUsers(),
      listGroups(),
    ])
      .then(([shares, users, groups]) => {
        setShareUsers(shares.users)
        setShareGroups(shares.groups)
        setAvailableUsersForShare(users)
        setAvailableGroupsForShare(groups)
      })
      .catch(() => {})
  }, [id, detailsTab, shareLoaded])

  useEffect(() => {
    if (!id || detailsTab !== 'versions') return
    const targets = [versionCompareFromId, versionCompareToId].filter((v): v is number => typeof v === 'number')
    if (targets.length === 0) return

    const missing = targets.filter(v => !versionSnapshots[v])
    if (missing.length === 0) return

    setVersionDiffLoading(true)
    setVersionDiffError(null)

    Promise.all(missing.map(versionId => getCollectionVersion(parseInt(id, 10), versionId)))
      .then(items => {
        setVersionSnapshots(prev => {
          const next = { ...prev }
          items.forEach((snapshot, idx) => {
            next[missing[idx]] = snapshot
          })
          return next
        })
      })
      .catch(err => setVersionDiffError((err as Error).message))
      .finally(() => setVersionDiffLoading(false))
  }, [id, detailsTab, versionCompareFromId, versionCompareToId, versionSnapshots])

  function normaliseFieldForDiff(field: CollectionField) {
    return {
      fieldKey: field.fieldKey ?? '',
      type: field.type,
      label: field.label.trim(),
      page: field.page,
      required: field.required,
      options: (field.options ?? []).map(opt => opt.trim()).filter(Boolean),
      displayStyle: resolveDisplayStyle(field.type, field.displayStyle),
      branchRules: (field.branchRules ?? [])
        .map(rule => ({
          value: rule.value.trim(),
          targetFieldKey: rule.targetFieldKey,
        }))
        .filter(rule => rule.value !== ''),
      tableColumns: (field.tableColumns ?? []).map(col => ({
        name: col.name.trim(),
        colType: col.colType,
        listOptions: (col.listOptions ?? []).map(opt => opt.trim()).filter(Boolean),
      })),
    }
  }

  function fieldKey(field: CollectionField) {
    return field.fieldKey?.trim() || `${field.type}:${field.label.trim().toLowerCase()}`
  }

  const versionDiff = useMemo(() => {
    if (!versionCompareFromId || !versionCompareToId) return null
    const from = versionSnapshots[versionCompareFromId]
    const to = versionSnapshots[versionCompareToId]
    if (!from || !to) return null

    const changes: string[] = []

    if ((from.title ?? '') !== (to.title ?? '')) changes.push(`Title: "${from.title}" to "${to.title}"`)
    if ((from.description ?? '') !== (to.description ?? '')) changes.push('Description updated')
    if ((from.category ?? '') !== (to.category ?? '')) changes.push(`Category: ${from.category ?? 'none'} to ${to.category ?? 'none'}`)
    if ((from.dateDue ?? '') !== (to.dateDue ?? '')) changes.push(`Due date: ${from.dateDue ?? 'none'} to ${to.dateDue ?? 'none'}`)
    if (from.status !== to.status) changes.push(`Status: ${from.status} to ${to.status}`)
    if (from.anonymous !== to.anonymous) changes.push(`Response mode: ${from.anonymous ? 'Anonymous' : 'Authenticated'} to ${to.anonymous ? 'Anonymous' : 'Authenticated'}`)
    if (from.allowSubmissionEdits !== to.allowSubmissionEdits) {
      changes.push(`Submission edits: ${from.allowSubmissionEdits ? 'Enabled' : 'Disabled'} to ${to.allowSubmissionEdits ? 'Enabled' : 'Disabled'}`)
    }
    if ((from.submissionEditWindowHours ?? 0) !== (to.submissionEditWindowHours ?? 0)) {
      changes.push(`Edit window hours: ${from.submissionEditWindowHours ?? 0} to ${to.submissionEditWindowHours ?? 0}`)
    }

    const fromFields = new Map(from.fields.map(field => [fieldKey(field), field]))
    const toFields = new Map(to.fields.map(field => [fieldKey(field), field]))

    let fieldsAdded = 0
    let fieldsRemoved = 0
    let fieldsChanged = 0

    toFields.forEach((field, key) => {
      if (!fromFields.has(key)) {
        fieldsAdded += 1
        changes.push(`Field added: ${field.label} (${field.type.replace('_', ' ')})`)
      }
    })

    fromFields.forEach((field, key) => {
      if (!toFields.has(key)) {
        fieldsRemoved += 1
        changes.push(`Field removed: ${field.label} (${field.type.replace('_', ' ')})`)
      }
    })

    fromFields.forEach((field, key) => {
      const next = toFields.get(key)
      if (!next) return
      const left = JSON.stringify(normaliseFieldForDiff(field))
      const right = JSON.stringify(normaliseFieldForDiff(next))
      if (left !== right) {
        fieldsChanged += 1
        changes.push(`Field changed: ${field.label}`)
      }
    })

    return {
      changes,
      metadataChanged: changes.length - fieldsAdded - fieldsRemoved - fieldsChanged,
      fieldsAdded,
      fieldsRemoved,
      fieldsChanged,
    }
  }, [versionCompareFromId, versionCompareToId, versionSnapshots])

  // ── Field helpers ─────────────────────────────────────────

  function updateField(key: string, patch: Partial<BuilderField>) {
    setFields(prev =>
      prev.map(f => (f._key === key ? { ...f, ...patch } : f))
    )
  }

  function removeField(key: string) {
    setFields(prev => {
      const next = prev.filter(f => f._key !== key)
      return next.length > 0 ? next : [blankField()]
    })
  }

  function moveField(key: string, dir: -1 | 1) {
    setFields(prev => {
      const currentField = prev.find(f => f._key === key)
      if (!currentField) return prev

      const samePageIndices = prev
        .map((field, index) => ({ field, index }))
        .filter(({ field }) => Math.max(1, Math.floor(field.page || 1)) === Math.max(1, Math.floor(currentField.page || 1)))

      const pageIndex = samePageIndices.findIndex(({ field }) => field._key === key)
      const targetPageIndex = pageIndex + dir

      if (pageIndex === -1 || targetPageIndex < 0 || targetPageIndex >= samePageIndices.length) {
        return prev
      }

      const next = [...prev]
      const sourceIndex = samePageIndices[pageIndex].index
      const targetIndex = samePageIndices[targetPageIndex].index
      ;[next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]]
      return next
    })
  }

  function addOption(key: string) {
    setFields(prev =>
      prev.map(f =>
        f._key === key ? { ...f, options: [...f.options, ''] } : f
      )
    )
  }

  function updateOption(key: string, idx: number, val: string) {
    setFields(prev =>
      prev.map(f =>
        f._key === key
          ? { ...f, options: f.options.map((o, i) => (i === idx ? val : o)) }
          : f
      )
    )
  }

  function removeOption(key: string, idx: number) {
    setFields(prev =>
      prev.map(f =>
        f._key === key
          ? { ...f, options: f.options.filter((_, i) => i !== idx) }
          : f
      )
    )
  }

  function addOtherOption(key: string) {
    setFields(prev =>
      prev.map(f => {
        if (f._key !== key || f.options.includes(OTHER_OPTION_MARKER)) return f
        return { ...f, options: [...f.options, OTHER_OPTION_MARKER] }
      })
    )
  }

  function removeOtherOption(key: string) {
    setFields(prev =>
      prev.map(f =>
        f._key === key
          ? { ...f, options: f.options.filter(opt => opt !== OTHER_OPTION_MARKER) }
          : f
      )
    )
  }

  async function copyShareLink() {
    if (!collectionSlug) return
    const url = `${window.location.origin}/fill/${collectionSlug}`
    try {
      await navigator.clipboard.writeText(url)
      showToast('Share link copied to clipboard', 'success')
    } catch {
      showToast(`Copy failed. Share URL: ${url}`, 'info')
    }
  }

  // ── Autosave (edit mode only) ────────────────────────────

  useEffect(() => {
    if (!isEdit || !loadedRef.current) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      if (!title.trim()) return
      void doSave({ silent: true })
    }, 2000)
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, category, dateDue, coverPhotoUrl, coverPhotoAssetId, logoUrl, anonymous, allowSubmissionEdits, submissionEditWindowHours, status, instructions, instructionsDocUrl, workflowEnabled, workflowStages, fields])

  // Mark as loaded AFTER the autosave effect has already run (effects run in definition order)
  useEffect(() => {
    if (loadTick > 0) loadedRef.current = true
  }, [loadTick])

  // ── Save ──────────────────────────────────────────────────

  function buildPayload(statusOverride: CollectionStatus = status) {
    const rawHours = Number(submissionEditWindowHours)
    const normalizedHours = Number.isFinite(rawHours)
      ? Math.max(1, Math.min(168, Math.floor(rawHours)))
      : 24

    const normalizedWorkflow = workflowEnabled
      ? {
          enabled: true,
          stages: workflowStages
            .map(stage => ({
              ...stage,
              name: stage.name.trim(),
              assignees: (stage.assignees ?? []).filter(assignee => assignee.value.trim() !== ''),
              conditions:
                stage.conditions && stage.conditions.conditions.length > 0
                  ? {
                      match: stage.conditions.match,
                      conditions: stage.conditions.conditions.filter(condition => condition.fieldKey.trim() !== ''),
                    }
                  : null,
            }))
            .filter(stage => stage.name !== '' && stage.assignees.length > 0),
        }
      : null

    return {
      title: title.trim(),
      status: statusOverride,
      description: description.trim() || undefined,
      category: category.trim() || undefined,
      dateDue: dateDue || undefined,
      coverPhotoUrl: coverPhotoUrl.trim() || undefined,
      coverPhotoAssetId,
      logoUrl: logoUrl.trim() || undefined,
      instructions: instructions || undefined,
      instructionsDocUrl: instructionsDocUrl.trim() || undefined,
      workflowDefinition: normalizedWorkflow && normalizedWorkflow.stages.length > 0 ? normalizedWorkflow : null,
      sourceTemplateCollectionId: !isEdit && templateId && Number.isInteger(Number(templateId)) && Number(templateId) > 0
        ? Number(templateId)
        : undefined,
      anonymous,
      allowSubmissionEdits,
      submissionEditWindowHours: allowSubmissionEdits ? normalizedHours : undefined,
      fields: fields
        .filter(f => f.label.trim() !== '')
        .map((f, i) => ({
          fieldKey: f.fieldKey,
          type: normalizeFieldType(f.type),
          label: f.label.trim(),
          subtitle: f.subtitle.trim() || undefined,
          page: Math.max(1, Math.floor(f.page || 1)),
          required: f.required,
          options: f.options.filter(o => o.trim() !== ''),
          displayStyle: resolveDisplayStyle(f.type, f.displayStyle),
          branchRules:
            f.type === 'single_choice'
              ? f.branchRules
                  .map(rule => ({
                    value: rule.value.trim(),
                    targetFieldKey: rule.targetFieldKey,
                  }))
                  .filter(rule => rule.value !== '' && rule.targetFieldKey)
              : [],
          tableColumns: f.tableColumns.map((c, ci) => ({
            ...c,
            colType: normalizeColType(c.colType),
            listOptions:
              normalizeColType(c.colType) === 'list'
                ? (c.listOptions ?? []).map(opt => opt.trim()).filter(Boolean)
                : null,
            sortOrder: ci,
          })),
          sortOrder: i,
          staffOnly: f.staffOnly,
          locationFilterEnabled: f.locationFilterEnabled,
        })),
    }
  }

  async function doSave({
    silent = false,
    statusOverride,
  }: {
    silent?: boolean
    statusOverride?: CollectionStatus
  } = {}) {
    if (!title.trim()) {
      if (!silent) setSaveError('Title is required.')
      return
    }
    if (!silent) { setSaving(true); setSaveError(null) }
    else setAutoSaveStatus('saving')
    try {
      const saved = isEdit
        ? await updateCollection(parseInt(id!, 10), buildPayload(statusOverride))
        : await createCollection(buildPayload(statusOverride))
      setCollectionSlug(saved.slug)
      setStatus(saved.status)
      setActiveVersionId(saved.activeVersionId ?? null)
      setCurrentVersionNumber(saved.currentVersionNumber ?? null)
      if (!isEdit) {
        navigate(`/collections/${saved.id}/edit`, { replace: true })
      }
      if (isEdit) {
        const collectionId = parseInt(id!, 10)
        listCollectionVersions(collectionId).then(setVersions).catch(() => undefined)
      }
      setLastSavedSignature(buildSignatureFromCollection(saved))
      if (silent) {
        setAutoSaveStatus('saved')
        setTimeout(() => setAutoSaveStatus('idle'), 2500)
      }
    } catch (err) {
      if (silent) setAutoSaveStatus('error')
      else setSaveError((err as Error).message)
    } finally {
      if (!silent) setSaving(false)
    }
  }

  async function handleSave() {
    if (!title.trim()) {
      setSaveError('Title is required.')
      return
    }
    await doSave({ silent: false })
  }

  async function handlePublishToggle() {
    const nextStatus: CollectionStatus = status === 'published' ? 'draft' : 'published'

    if (isEdit && nextStatus === 'published' && activeVersionId) {
      setSaving(true)
      setSaveError(null)
      try {
        const saved = await publishCollectionVersion(parseInt(id!, 10), activeVersionId)
        setStatus(saved.status)
        setActiveVersionId(saved.activeVersionId ?? null)
        setCurrentVersionNumber(saved.currentVersionNumber ?? null)
        setCollectionSlug(saved.slug)
        setLastSavedSignature(buildSignatureFromCollection(saved))
        showToast('Version published', 'success')
        listCollectionVersions(parseInt(id!, 10)).then(setVersions).catch(() => undefined)
      } catch (err) {
        setSaveError((err as Error).message)
      } finally {
        setSaving(false)
      }
      return
    }

    setStatus(nextStatus)
    await doSave({ silent: false, statusOverride: nextStatus })
  }

  async function handleCreateNewVersion() {
    if (!isEdit || !id || !title.trim()) {
      setSaveError('Title is required.')
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      const created = await createCollectionVersion(parseInt(id, 10), buildPayload('draft'))
      setStatus(created.status)
      setCollectionSlug(created.slug)
      setActiveVersionId(created.activeVersionId ?? null)
      setCurrentVersionNumber(created.currentVersionNumber ?? null)
      setLastSavedSignature(buildSignatureFromCollection(created))
      setLoadTick(t => t + 1)
      showToast('New draft version created', 'success')
    } catch (err) {
      setSaveError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function canRestoreVersions(): boolean {
    return user?.role === 'super_admin' || user?.role === 'administrator'
  }

  function handleRestoreVersionClick(versionId: number) {
    setRestoreError(null)
    setPendingRestoreVersionId(versionId)
  }

  function cancelRestore() {
    setPendingRestoreVersionId(null)
    setRestoreError(null)
  }

  async function confirmRestore() {
    if (!isEdit || !id || !pendingRestoreVersionId) return
    const versionId = pendingRestoreVersionId

    setRestoring(true)
    setRestoreError(null)
    try {
      const restored = await restoreCollectionVersion(parseInt(id, 10), versionId)
      applyCollectionToForm(restored)
      setLastSavedSignature(buildSignatureFromCollection(restored))
      setPendingRemoveKey(null)
      setLoadTick(t => t + 1)
      listCollectionVersions(parseInt(id, 10)).then(setVersions).catch(() => undefined)
      showToast(`Restored to v${restored.currentVersionNumber} as a new draft`, 'success')
    } catch (err) {
      setRestoreError((err as Error).message)
    } finally {
      setRestoring(false)
      setPendingRestoreVersionId(null)
    }
  }

  function handleRemoveFieldClick(field: BuilderField) {
    if (!field.label.trim()) {
      removeField(field._key)
      return
    }
    setPendingRemoveKey(field._key)
  }

  function confirmRemoveField(field: BuilderField) {
    removeField(field._key)
    setPendingRemoveKey(null)
  }

  function cancelRemoveField() {
    setPendingRemoveKey(null)
  }

  function updateWorkflowStage(stageId: string, patch: Partial<ApprovalWorkflowStageDefinition>) {
    setWorkflowStages(prev => prev.map(stage => (stage.id === stageId ? { ...stage, ...patch } : stage)))
  }

  function addWorkflowStage() {
    setWorkflowStages(prev => [...prev, blankWorkflowStage(prev.length)])
  }

  function removeWorkflowStage(stageId: string) {
    setWorkflowStages(prev => {
      const next = prev.filter(stage => stage.id !== stageId)
      return next.length > 0 ? next : [blankWorkflowStage(0)]
    })
  }

  function addWorkflowAssignee(stageId: string, type: 'user' | 'role') {
    setWorkflowStages(prev => prev.map(stage => {
      if (stage.id !== stageId) return stage
      return {
        ...stage,
        assignees: [...stage.assignees, { type, value: '' }],
      }
    }))
  }

  function updateWorkflowAssignee(stageId: string, assigneeIndex: number, patch: { type?: 'user' | 'role'; value?: string }) {
    setWorkflowStages(prev => prev.map(stage => {
      if (stage.id !== stageId) return stage
      return {
        ...stage,
        assignees: stage.assignees.map((assignee, index) => (index === assigneeIndex ? { ...assignee, ...patch } : assignee)),
      }
    }))
  }

  function removeWorkflowAssignee(stageId: string, assigneeIndex: number) {
    setWorkflowStages(prev => prev.map(stage => {
      if (stage.id !== stageId) return stage
      return {
        ...stage,
        assignees: stage.assignees.filter((_, index) => index !== assigneeIndex),
      }
    }))
  }

  function updateWorkflowCondition(stageId: string, patch: Partial<ApprovalWorkflowCondition>) {
    setWorkflowStages(prev => prev.map(stage => {
      if (stage.id !== stageId) return stage
      const current = stage.conditions?.conditions[0] ?? { fieldKey: '', operator: 'equals', value: '' }
      return {
        ...stage,
        conditions: {
          match: 'all',
          conditions: [{ ...current, ...patch }],
        },
      }
    }))
  }

  function clearWorkflowCondition(stageId: string) {
    setWorkflowStages(prev => prev.map(stage => (stage.id === stageId ? { ...stage, conditions: null } : stage)))
  }

  const categoryOptions = useMemo(() => {
    const names = categories.map(item => item.name)
    if (category && !names.some(name => name.toLowerCase() === category.toLowerCase())) {
      return [...names, category]
    }
    return names
  }, [categories, category])

  // ── Ticket field helpers ──────────────────────────────────

  function updateTicketField(key: string, patch: Partial<BuilderField>) {
    setTicketFields(prev => prev.map(f => f._key === key ? { ...f, ...patch } : f))
  }

  async function handleSaveTicket() {
    if (!id) return
    setTicketSaving(true)
    setTicketSaveError(null)
    try {
      await saveCollectionTicketTemplates(
        parseInt(id, 10),
        assignedTicketTemplates.filter(t => !t.isArchived).map(template => template.id),
      )
      setTicketSaved(true)
      setTimeout(() => setTicketSaved(false), 2500)
      showToast('Assigned tickets saved', 'success')
    } catch (err) {
      setTicketSaveError((err as Error).message)
    } finally {
      setTicketSaving(false)
    }
  }

  async function archiveAssignedTicketTemplate(templateId: number) {
    if (!id) return
    try {
      await setCollectionTicketTemplateActive(parseInt(id, 10), templateId, false)
      setAssignedTicketTemplates(prev => prev.map(t => t.id === templateId ? { ...t, isArchived: true } : t))
      showToast('Ticket archived', 'success')
    } catch (err) {
      showToast((err as Error).message, 'error')
    }
  }

  async function restoreAssignedTicketTemplate(templateId: number) {
    if (!id) return
    try {
      await setCollectionTicketTemplateActive(parseInt(id, 10), templateId, true)
      setAssignedTicketTemplates(prev => prev.map(t => t.id === templateId ? { ...t, isArchived: false } : t))
      showToast('Ticket restored', 'success')
    } catch (err) {
      showToast((err as Error).message, 'error')
    }
  }

  function addAssignedTicketTemplate() {
    const templateId = Number(selectedTicketTemplateId)
    if (!Number.isInteger(templateId) || templateId <= 0) return
    if (assignedTicketTemplates.some(template => template.id === templateId)) return

    const template = availableTicketTemplates.find(item => item.id === templateId)
    if (!template) return

    setAssignedTicketTemplates(prev => [
      ...prev,
      {
        id: template.id,
        title: template.title,
        description: template.description,
        displayOrder: prev.length,
      },
    ])
    setSelectedTicketTemplateId('')
  }

  function removeAssignedTicketTemplate(templateId: number) {
    setAssignedTicketTemplates(prev => prev
      .filter(template => template.id !== templateId)
      .map((template, index) => ({ ...template, displayOrder: index })))
  }

  function moveAssignedTicketTemplate(templateId: number, direction: -1 | 1) {
    setAssignedTicketTemplates(prev => {
      const index = prev.findIndex(template => template.id === templateId)
      const targetIndex = index + direction
      if (index === -1 || targetIndex < 0 || targetIndex >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
      return next.map((template, order) => ({ ...template, displayOrder: order }))
    })
  }

  // ── Wizard field ──────────────────────────────────────────

  const wizardBuilderField = wizardField
    ? fields.find(f => f._key === wizardField)
    : null

  const matrixConfigBuilderField = matrixConfigField
    ? fields.find(f => f._key === matrixConfigField)
    : null

  const matrixConfigFromField = matrixConfigBuilderField
    ? (() => {
        try {
          // If options is a string (JSON), parse it; otherwise treat as array of row labels
          if (matrixConfigBuilderField.options && matrixConfigBuilderField.options.length > 0) {
            const firstOpt = matrixConfigBuilderField.options[0]
            if (typeof firstOpt === 'string' && firstOpt.startsWith('{')) {
              // Try to parse as JSON (matrix config)
              return JSON.parse(firstOpt)
            }
          }
          return null
        } catch {
          return null
        }
      })()
    : null

  if (loadError) {
    return (
      <div className="rounded border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4 text-red-700 dark:text-red-400 text-sm">
        {loadError}
      </div>
    )
  }

  return (
    <>
      {/* Table Wizard modal */}
      {wizardBuilderField && (
        <TableWizardModal
          columns={wizardBuilderField.tableColumns}
          onSave={cols => {
            updateField(wizardBuilderField._key, { tableColumns: cols })
            setWizardField(null)
          }}
          onClose={() => setWizardField(null)}
        />
      )}

      {/* Matrix Likert Config modal */}
      {matrixConfigBuilderField && (
        <MatrixLikertConfigModal
          config={matrixConfigFromField}
          onSave={config => {
            // Store as single JSON string in options array
            updateField(matrixConfigBuilderField._key, { options: [JSON.stringify(config)] })
            setMatrixConfigField(null)
          }}
          onClose={() => setMatrixConfigField(null)}
        />
      )}

      {/* Ticket Table Wizard modal */}
      {ticketWizardField && (() => {
        const twf = ticketFields.find(f => f._key === ticketWizardField)
        if (!twf) return null
        return (
          <TableWizardModal
            columns={twf.tableColumns}
            onSave={cols => {
              updateTicketField(twf._key, { tableColumns: cols })
              setTicketWizardField(null)
            }}
            onClose={() => setTicketWizardField(null)}
          />
        )
      })()}

      {/* Ticket Matrix Config modal */}
        {ticketMatrixConfigField && (() => {
        const tmf = ticketFields.find(f => f._key === ticketMatrixConfigField)
        if (!tmf) return null
        let matrixCfg = null
        try {
          if (tmf.options.length > 0 && tmf.options[0].startsWith('{')) {
            matrixCfg = JSON.parse(tmf.options[0])
          }
        } catch { /* ignore */ }
        return (
          <MatrixLikertConfigModal
            config={matrixCfg}
            onSave={config => {
              updateTicketField(tmf._key, { options: [JSON.stringify(config)] })
              setTicketMatrixConfigField(null)
            }}
            onClose={() => setTicketMatrixConfigField(null)}
          />
        )
      })()}

      {/* Restore Version confirmation modal */}
      {pendingRestoreVersionId && (() => {
        const version = versions.find(v => v.id === pendingRestoreVersionId)
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white dark:bg-[#1E293B] rounded-lg shadow-xl w-full max-w-md overflow-hidden">
              <div className="px-5 py-4 border-b border-[#E2E8F0] dark:border-[#334155]">
                <h2 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">
                  Restore Version {version ? `v${version.versionNumber}` : ''}
                </h2>
              </div>
              <div className="px-5 py-4 space-y-3">
                <div className="flex items-start gap-3 rounded border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-3 text-sm text-amber-800 dark:text-amber-300">
                  <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-medium">This will create a new draft version.</p>
                    <p>
                      A new draft version will be created from v{version?.versionNumber} and set as the active version.
                    </p>
                    {status === 'published' && (
                      <p className="font-medium">
                        The collection will be moved back to draft status and will no longer be visible to respondents until re-published.
                      </p>
                    )}
                    {isDirty && (
                      <p className="text-xs">
                        You have unsaved changes in the current draft. Restoring will discard those changes.
                      </p>
                    )}
                  </div>
                </div>
                {restoreError && (
                  <div className="rounded border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-3 text-red-700 dark:text-red-400 text-sm">
                    {restoreError}
                  </div>
                )}
              </div>
              <div className="px-5 py-4 border-t border-[#E2E8F0] dark:border-[#334155] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={cancelRestore}
                  disabled={restoring}
                  className="rounded border border-[#CBD5E1] dark:border-[#475569] px-4 py-2 text-sm font-medium text-[#64748B] hover:bg-[#F1F5F9] dark:hover:bg-[#1E293B] transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmRestore}
                  disabled={restoring}
                  className="inline-flex items-center gap-1.5 rounded bg-[#0F766E] px-4 py-2 text-sm font-medium text-white hover:bg-[#0D5C56] transition-colors disabled:opacity-50"
                >
                  <RotateCcw size={14} />
                  {restoring ? 'Restoring…' : 'Restore Version'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      <div className="max-w-6xl mx-auto space-y-6">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/collections')}
              className="text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9] transition-colors"
            >
              <ArrowLeft size={18} />
            </button>
            <h1 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">
              {isEdit
                ? 'Edit Collection'
                : templateId
                  ? 'New Collection From Template'
                  : collectionType === 'template'
                    ? 'New Template-Based Collection'
                    : 'New Collection'}
            </h1>
            <span
              className={[
                'text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border',
                status === 'published'
                  ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-700'
                  : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700',
              ].join(' ')}
            >
              {status}
            </span>
            {isEdit && currentVersionNumber && (
              <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border border-[#CBD5E1] dark:border-[#334155] text-[#64748B]">
                v{currentVersionNumber}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {isEdit && versions.length > 0 && (
              <span className="text-xs text-[#64748B]">
                {versions.length} version{versions.length === 1 ? '' : 's'}
              </span>
            )}
            {isEdit && autoSaveStatus !== 'idle' && (
              <span className={`text-xs ${
                autoSaveStatus === 'saving' ? 'text-[#94A3B8]' :
                autoSaveStatus === 'saved'  ? 'text-green-600 dark:text-green-400' :
                'text-red-500'
              }`}>
                {autoSaveStatus === 'saving' ? 'Auto-saving…' :
                 autoSaveStatus === 'saved'  ? 'Saved' :
                 'Auto-save failed'}
              </span>
            )}
            {isEdit && (
              <button
                onClick={() => {
                  if (!collectionSlug) return
                  window.open(`/fill/${collectionSlug}?preview=true`, '_blank', 'noopener')
                }}
                disabled={!collectionSlug}
                className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-1.5 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors disabled:opacity-40"
              >
                <Eye size={14} />
                <span className="sm:hidden">Test</span>
                <span className="hidden sm:inline">Test Form</span>
              </button>
            )}
            {isEdit && (
              <button
                onClick={handleCreateNewVersion}
                disabled={saving}
                className="flex items-center gap-1.5 text-sm text-[#64748B] border border-[#E2E8F0] dark:border-[#334155] px-3 py-1.5 rounded hover:bg-[#F8FAFC] dark:hover:bg-[#1E293B] transition-colors disabled:opacity-40"
              >
                <Copy size={14} />
                <span className="sm:hidden">Version</span>
                <span className="hidden sm:inline">New Version</span>
              </button>
            )}
            <button
              onClick={handlePublishToggle}
              disabled={saving}
              className={[
                'text-sm font-medium px-3 py-1.5 rounded transition-colors disabled:opacity-60 border',
                status === 'published'
                  ? 'border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:bg-amber-900/20 dark:hover:bg-amber-900/30'
                  : 'border-[#16A34A] text-white bg-[#16A34A] hover:bg-[#15803D]',
              ].join(' ')}
            >
              <span className="sm:hidden">
                {saving
                  ? '...'
                  : status === 'published'
                  ? 'Draft'
                  : 'Publish'}
              </span>
              <span className="hidden sm:inline">
                {saving
                  ? 'Working...'
                  : status === 'published'
                  ? 'Move to Draft'
                  : 'Publish'}
              </span>
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center justify-center h-[34px] sm:h-auto gap-1.5 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-3 sm:px-4 py-1.5 rounded transition-colors"
            >
              <Save size={14} />
              <span className="hidden sm:inline">{saving ? 'Saving…' : 'Save'}</span>
            </button>
          </div>
        </div>

        {saveError && (
          <div className="rounded border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-3 text-red-700 dark:text-red-400 text-sm">
            {saveError}
          </div>
        )}

        {/* Metadata card */}
        <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-5 space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">
            Collection Details
          </h2>
          <div className="relative flex items-center gap-2 border-b border-[#E2E8F0] dark:border-[#334155] pb-3">
            <button
              type="button"
              onClick={() => setDetailsTab('general')}
              className={[
                'px-3 py-2 text-sm font-semibold border-b-2 transition-colors rounded-t',
                detailsTab === 'general'
                  ? 'border-[#2563EB] text-[#2563EB] bg-blue-50 dark:bg-blue-900/20'
                  : 'border-transparent text-[#64748B] hover:text-[#2563EB] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]',
              ].join(' ')}
            >
              General
            </button>
            <button
              type="button"
              onClick={() => setDetailsTab('photo')}
              className={[
                'px-3 py-2 text-sm font-semibold border-b-2 transition-colors rounded-t',
                detailsTab === 'photo'
                  ? 'border-[#2563EB] text-[#2563EB] bg-blue-50 dark:bg-blue-900/20'
                  : 'border-transparent text-[#64748B] hover:text-[#2563EB] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]',
              ].join(' ')}
            >
              Photo
            </button>
            <button
              type="button"
              onClick={() => setDetailsTab('share')}
              className={[
                'px-3 py-2 text-sm font-semibold border-b-2 transition-colors rounded-t',
                detailsTab === 'share'
                  ? 'border-[#2563EB] text-[#2563EB] bg-blue-50 dark:bg-blue-900/20'
                  : 'border-transparent text-[#64748B] hover:text-[#2563EB] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]',
              ].join(' ')}
            >
              Share
            </button>
            {isEdit && (
              <button
                type="button"
                onClick={() => setDetailsTab('versions')}
                className={[
                  'px-3 py-2 text-sm font-semibold border-b-2 transition-colors rounded-t',
                  detailsTab === 'versions'
                    ? 'border-[#2563EB] text-[#2563EB] bg-blue-50 dark:bg-blue-900/20'
                    : 'border-transparent text-[#64748B] hover:text-[#2563EB] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]',
                ].join(' ')}
              >
                Versions
              </button>
            )}
            {isEdit && (
              <button
                type="button"
                onClick={() => setDetailsTab('ticket')}
                className={[
                  'hidden sm:inline-flex px-3 py-2 text-sm font-semibold border-b-2 transition-colors rounded-t',
                  detailsTab === 'ticket'
                    ? 'border-[#2563EB] text-[#2563EB] bg-blue-50 dark:bg-blue-900/20'
                    : 'border-transparent text-[#64748B] hover:text-[#2563EB] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]',
                ].join(' ')}
              >
                Add Ticket
              </button>
            )}
            {isEdit && (
              <div className="relative sm:hidden ml-auto">
                <button
                  type="button"
                  onClick={() => setDetailsOverflowOpen(open => !open)}
                  className={[
                    'inline-flex items-center justify-center w-10 h-10 text-sm font-semibold border-b-2 transition-colors rounded-t',
                    detailsTab === 'ticket' || detailsOverflowOpen
                      ? 'border-[#2563EB] text-[#2563EB] bg-blue-50 dark:bg-blue-900/20'
                      : 'border-transparent text-[#64748B] hover:text-[#2563EB] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]',
                  ].join(' ')}
                  aria-label="More collection detail tabs"
                >
                  <MoreHorizontal size={16} />
                </button>
                {detailsOverflowOpen && (
                  <div className="absolute right-0 top-full mt-2 min-w-[140px] rounded-lg border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#1E293B] shadow-lg py-1 z-20">
                    <button
                      type="button"
                      onClick={() => {
                        setDetailsTab('ticket')
                        setDetailsOverflowOpen(false)
                      }}
                      className={[
                        'w-full text-left px-3 py-2 text-sm transition-colors',
                        detailsTab === 'ticket'
                          ? 'text-[#2563EB] bg-blue-50 dark:bg-blue-900/20'
                          : 'text-[#1E293B] dark:text-[#F1F5F9] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]',
                      ].join(' ')}
                    >
                      Add Ticket
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {detailsTab === 'general' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor={`${formId}-title`} className={LABEL}>
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  id={`${formId}-title`}
                  type="text"
                  placeholder="e.g. Department Emergency Contacts"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className={INPUT}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor={`${formId}-description`} className={LABEL}>
                  Description
                </label>
                <textarea
                  id={`${formId}-description`}
                  rows={3}
                  placeholder="Briefly describe the purpose of this collection"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className={`${INPUT} min-h-[72px] resize-y`}
                />
              </div>
              <div>
                <label htmlFor={`${formId}-category`} className={LABEL}>
                  Category
                </label>
                <select
                  id={`${formId}-category`}
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className={INPUT}
                  disabled={categoriesLoading || categoryOptions.length === 0}
                >
                  <option value="">Select a category</option>
                  {categoryOptions.map(name => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                {categoriesError ? (
                  <p className="mt-1 text-xs text-red-500">{categoriesError}</p>
                ) : (
                  <p className="mt-1 text-xs text-[#64748B]">
                    {categoriesLoading
                      ? 'Loading categories…'
                      : 'Categories are managed in Settings.'}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor={`${formId}-due`} className={LABEL}>
                  Date Due (optional)
                </label>
                <input
                  id={`${formId}-due`}
                  type="date"
                  value={dateDue}
                  onChange={e => setDateDue(e.target.value)}
                  className={INPUT}
                />
              </div>
              <div>
                <label htmlFor={`${formId}-status`} className={LABEL}>
                  Status
                </label>
                <select
                  id={`${formId}-status`}
                  value={status}
                  onChange={e => setStatus(e.target.value as CollectionStatus)}
                  className={INPUT}
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
              </div>
              <div>
                <label className={LABEL}>Response Mode</label>
                <div className="inline-flex rounded overflow-hidden border border-[#CBD5E1] dark:border-[#334155] w-full">
                  <button
                    type="button"
                    onClick={() => setAnonymous(false)}
                    className={[
                      'flex-1 px-3 py-2 text-sm font-medium transition-colors',
                      !anonymous
                        ? 'bg-[#475569] dark:bg-[#64748B] text-white'
                        : 'bg-white dark:bg-[#0F172A] text-[#64748B] hover:bg-[#F8FAFC] dark:hover:bg-[#1E293B]',
                    ].join(' ')}
                  >
                    Authenticated
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnonymous(true)}
                    className={[
                      'flex-1 px-3 py-2 text-sm font-medium transition-colors border-l border-[#CBD5E1] dark:border-[#334155]',
                      anonymous
                        ? 'bg-[#475569] dark:bg-[#64748B] text-white'
                        : 'bg-white dark:bg-[#0F172A] text-[#64748B] hover:bg-[#F8FAFC] dark:hover:bg-[#1E293B]',
                    ].join(' ')}
                  >
                    Anonymous
                  </button>
                </div>
                <p className="mt-1 text-xs text-[#64748B]">
                  {anonymous ? 'No name or email required from respondents.' : 'Respondents must provide their name and email.'}
                </p>
              </div>
              <div className="sm:col-span-2 rounded-lg border border-[#1E3A5F] bg-[#1E3A5F] p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Approval Workflow</h3>
                    <p className="mt-1 text-xs text-blue-200">
                      Define sequential stages, assign approvers by user or role, and add optional routing rules with reminder/escalation windows.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm font-medium text-white">
                    <input
                      type="checkbox"
                      checked={workflowEnabled}
                      onChange={e => setWorkflowEnabled(e.target.checked)}
                      className="accent-[#2563EB] w-4 h-4"
                    />
                    Enable
                  </label>
                </div>

                {workflowEnabled && (
                  <div className="space-y-4">
                    {workflowStages.map((stage, stageIndex) => {
                      const condition = stage.conditions?.conditions[0] ?? null
                      return (
                        <div key={stage.id} className="rounded-lg border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#111827] p-4 space-y-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="inline-flex items-center justify-center h-7 min-w-7 px-2 rounded-full bg-[#DBEAFE] text-[#1D4ED8] text-xs font-semibold">
                                {stageIndex + 1}
                              </span>
                              <input
                                type="text"
                                value={stage.name}
                                onChange={e => updateWorkflowStage(stage.id, { name: e.target.value })}
                                className={INPUT}
                                placeholder="Stage name"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => removeWorkflowStage(stage.id)}
                              className="text-xs font-medium text-red-600 hover:text-red-700"
                            >
                              Remove stage
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <label className={LABEL}>Approval Mode</label>
                              <select
                                value={stage.approvalMode}
                                onChange={e => updateWorkflowStage(stage.id, { approvalMode: e.target.value === 'any' ? 'any' : 'all' })}
                                className={INPUT}
                              >
                                <option value="all">All approvers required</option>
                                <option value="any">Any approver can approve</option>
                              </select>
                            </div>
                            <div>
                              <label className={LABEL}>Reminder After (hours)</label>
                              <input
                                type="number"
                                min={1}
                                value={stage.reminderAfterHours ?? ''}
                                onChange={e => updateWorkflowStage(stage.id, { reminderAfterHours: e.target.value ? Number(e.target.value) : null })}
                                className={INPUT}
                              />
                            </div>
                            <div>
                              <label className={LABEL}>Escalate After (hours)</label>
                              <input
                                type="number"
                                min={1}
                                value={stage.escalationAfterHours ?? ''}
                                onChange={e => updateWorkflowStage(stage.id, { escalationAfterHours: e.target.value ? Number(e.target.value) : null })}
                                className={INPUT}
                              />
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <label className={LABEL}>Approvers</label>
                              <div className="flex items-center gap-2">
                                <button type="button" onClick={() => addWorkflowAssignee(stage.id, 'user')} className="text-xs font-medium text-[#2563EB] hover:text-blue-700">Add user</button>
                                <button type="button" onClick={() => addWorkflowAssignee(stage.id, 'role')} className="text-xs font-medium text-[#2563EB] hover:text-blue-700">Add role</button>
                              </div>
                            </div>
                            {stage.assignees.length === 0 && (
                              <p className="text-xs text-[#64748B]">Add at least one approver for this stage.</p>
                            )}
                            {stage.assignees.map((assignee, assigneeIndex) => (
                              <div key={`${stage.id}-assignee-${assigneeIndex}`} className="grid grid-cols-1 md:grid-cols-[140px_minmax(0,1fr)_auto] gap-3 items-center">
                                <select
                                  value={assignee.type}
                                  onChange={e => updateWorkflowAssignee(stage.id, assigneeIndex, { type: e.target.value === 'role' ? 'role' : 'user', value: '' })}
                                  className={INPUT}
                                >
                                  <option value="user">Specific user</option>
                                  <option value="role">Role</option>
                                </select>
                                {assignee.type === 'user' ? (
                                  <select
                                    value={assignee.value}
                                    onChange={e => updateWorkflowAssignee(stage.id, assigneeIndex, { value: e.target.value })}
                                    className={INPUT}
                                  >
                                    <option value="">Select user</option>
                                    {workflowUsers.map(user => (
                                      <option key={user.id} value={String(user.id)}>
                                        {user.name} ({user.email})
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <select
                                    value={assignee.value}
                                    onChange={e => updateWorkflowAssignee(stage.id, assigneeIndex, { value: e.target.value })}
                                    className={INPUT}
                                  >
                                    <option value="">Select role</option>
                                    {APPROVAL_ROLE_OPTIONS.map(role => (
                                      <option key={role} value={role}>{role}</option>
                                    ))}
                                  </select>
                                )}
                                <button type="button" onClick={() => removeWorkflowAssignee(stage.id, assigneeIndex)} className="text-xs font-medium text-red-600 hover:text-red-700">Remove</button>
                              </div>
                            ))}
                          </div>

                          <div className="rounded border border-dashed border-[#CBD5E1] dark:border-[#334155] p-3 space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">Optional Condition</p>
                                <p className="text-xs text-[#64748B]">Only run this stage when the submitted form data matches the rule.</p>
                              </div>
                              {condition ? (
                                <button type="button" onClick={() => clearWorkflowCondition(stage.id)} className="text-xs font-medium text-red-600 hover:text-red-700">Clear</button>
                              ) : null}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <select
                                value={condition?.fieldKey ?? ''}
                                onChange={e => updateWorkflowCondition(stage.id, { fieldKey: e.target.value })}
                                className={INPUT}
                              >
                                <option value="">Select field</option>
                                {fields.filter(field => field.label.trim() !== '').map(field => (
                                  <option key={field.fieldKey} value={field.fieldKey}>{field.label}</option>
                                ))}
                              </select>
                              <select
                                value={condition?.operator ?? 'equals'}
                                onChange={e => updateWorkflowCondition(stage.id, { operator: e.target.value as ApprovalWorkflowCondition['operator'] })}
                                className={INPUT}
                              >
                                <option value="equals">equals</option>
                                <option value="not_equals">does not equal</option>
                                <option value="greater_than">greater than</option>
                                <option value="greater_or_equal">greater than or equal</option>
                                <option value="less_than">less than</option>
                                <option value="less_or_equal">less than or equal</option>
                                <option value="contains">contains</option>
                                <option value="not_empty">is not empty</option>
                                <option value="is_empty">is empty</option>
                              </select>
                              <input
                                type="text"
                                value={condition?.value === null || condition?.value === undefined ? '' : String(condition.value)}
                                onChange={e => updateWorkflowCondition(stage.id, { value: e.target.value })}
                                className={INPUT}
                                placeholder="Comparison value"
                                disabled={condition?.operator === 'not_empty' || condition?.operator === 'is_empty'}
                              />
                            </div>
                          </div>
                        </div>
                      )
                    })}

                    <button
                      type="button"
                      onClick={addWorkflowStage}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded border border-blue-300 text-sm font-medium text-white hover:bg-[#1a3354]"
                    >
                      <Plus size={14} />
                      Add stage
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {detailsTab === 'photo' && (
            <div className="space-y-4">
              <div>
                <label htmlFor={`${formId}-logo`} className={LABEL}>
                  Image Logo URL (optional)
                </label>
                <input
                  id={`${formId}-logo`}
                  type="url"
                  placeholder="https://…"
                  value={logoUrl}
                  onChange={e => setLogoUrl(e.target.value)}
                  className={`${INPUT.replace('px-3 py-2', 'px-1 py-1')}`}
                />
                <p className="mt-1 text-xs text-[#94A3B8]">Displayed at the top of the survey banner (max 150px wide). Supports SVG, PNG, etc.</p>
              </div>
              <div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <label className={LABEL}>Cover Photo Gallery</label>
                    <p className="text-xs text-[#94A3B8]">Choose a cover photo from your organization gallery. Upload new images in Settings first.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCoverPhotoAssetId(null)
                      setCoverPhotoUrl('')
                    }}
                    className="inline-flex items-center gap-1.5 border border-[#CBD5E1] dark:border-[#334155] text-[#475569] dark:text-[#CBD5E1] text-sm font-medium px-3 py-2 rounded hover:bg-[#F1F5F9] dark:hover:bg-[#1E293B] transition-colors"
                  >
                    <X size={14} />
                    Clear Cover
                  </button>
                </div>
                {galleryError && <p className="text-sm text-red-500 mt-2">{galleryError}</p>}
                {galleryLoading ? (
                  <p className="text-sm text-[#64748B] mt-3">Loading gallery…</p>
                ) : galleryAssets.length === 0 ? (
                  <div className="mt-3 rounded-lg border border-dashed border-[#CBD5E1] dark:border-[#334155] p-4 text-sm text-[#64748B]">
                    No gallery images are available yet. Upload cover images in Settings before assigning one here.
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <select
                      value={coverPhotoAssetId == null ? '' : String(coverPhotoAssetId)}
                      onChange={e => {
                        const value = e.target.value
                        if (!value) {
                          setCoverPhotoAssetId(null)
                          setCoverPhotoUrl('')
                          return
                        }

                        const selectedId = Number.parseInt(value, 10)
                        const asset = galleryAssets.find(item => item.id === selectedId)
                        setCoverPhotoAssetId(selectedId)
                        setCoverPhotoUrl(asset?.fileUrl ?? '')
                      }}
                      className={INPUT}
                    >
                      <option value="">Select a gallery image…</option>
                      {galleryAssets.map(asset => (
                        <option key={asset.id} value={asset.id}>
                          {asset.name} ({asset.usageCount} in use)
                        </option>
                      ))}
                    </select>

                    {selectedCoverAsset && (
                      <div className="rounded-lg border border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A] p-3">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <div>
                            <p className="font-medium text-[#1E293B] dark:text-[#F1F5F9]">{selectedCoverAsset.name}</p>
                            <p className="mt-1 text-xs text-[#64748B]">Used by {selectedCoverAsset.usageCount} collection{selectedCoverAsset.usageCount === 1 ? '' : 's'}</p>
                          </div>
                          {selectedCoverAsset.tags.length > 0 && (
                            <span className="text-xs text-[#94A3B8]">{selectedCoverAsset.tags.join(', ')}</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {coverPhotoUrl ? (
                <div className="relative h-44 rounded-lg overflow-hidden bg-[#F1F5F9] dark:bg-[#0F172A] border border-[#E2E8F0] dark:border-[#334155]">
                  <img
                    src={coverPhotoUrl}
                    alt="Cover"
                    className="w-full h-full object-cover"
                    onError={e => {
                      ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                    }}
                  />
                  {logoUrl && (
                    <div style={logoPaddingStyle} className="absolute left-3 top-3 z-10 inline-flex max-w-[96px] bg-white/95 shadow-sm border border-white/80">
                      <img
                        src={logoUrl}
                        alt="Logo preview"
                        className="w-full h-auto"
                        onError={e => {
                          ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                        }}
                      />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/30 flex items-end p-4">
                    <span className="text-white text-lg font-bold drop-shadow">
                      {title || 'Untitled Collection'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
                  <ImageIcon size={14} />
                  No cover photo selected yet.
                </div>
              )}
            </div>
          )}

          {detailsTab === 'share' && (
            <div className="space-y-4">
              <p className="text-xs text-[#64748B]">
                {status === 'published'
                  ? 'Share this URL with staff or anonymous users to fill out the form.'
                  : 'This collection is currently a draft. Publish it before sharing the live link.'}
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={collectionSlug ? `${window.location.origin}/fill/${collectionSlug}` : 'Save the collection first to generate a share URL.'}
                  className={`${INPUT} bg-[#F8FAFC] dark:bg-[#0B1220]`}
                />
                <button
                  type="button"
                  onClick={copyShareLink}
                  disabled={!collectionSlug || status !== 'published'}
                  className="inline-flex items-center gap-1 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-3 py-2 rounded transition-colors"
                >
                  <Copy size={14} />
                  Copy
                </button>
              </div>

              <div className="rounded-lg border border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A] p-4">
                <label className="flex items-center gap-3 text-sm text-[#1E293B] dark:text-[#F1F5F9] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowSubmissionEdits}
                    onChange={e => setAllowSubmissionEdits(e.target.checked)}
                    className="accent-[#2563EB] w-4 h-4"
                  />
                  Allow users to edit submitted responses
                </label>
                <p className="mt-1 text-xs text-[#64748B]">
                  Disabled by default. When enabled, users can edit their own submission for a limited time.
                </p>
                {allowSubmissionEdits && (
                  <div className="mt-3 max-w-xs">
                    <label htmlFor={`${formId}-edit-window`} className={LABEL}>
                      Edit Window (hours)
                    </label>
                    <input
                      id={`${formId}-edit-window`}
                      type="number"
                      min={1}
                      max={168}
                      step={1}
                      value={submissionEditWindowHours}
                      onChange={e => setSubmissionEditWindowHours(e.target.value)}
                      className={INPUT}
                    />
                    <p className="mt-1 text-xs text-[#64748B]">Recommended: 24 to 36 hours.</p>
                  </div>
                )}
              </div>

              {/* User & Group Access Sharing */}
              {id && (
                <div className="rounded-lg border border-[#E2E8F0] dark:border-[#334155] p-4 space-y-4">
                  <p className="text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide">Access — Users & Groups</p>
                  <p className="text-xs text-[#64748B]">Grant additional users or groups access to this collection, even if they're outside your organization.</p>

                  {/* Users */}
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[#1E293B] dark:text-[#F1F5F9]">Users</p>
                    <div className="flex flex-wrap gap-1.5">
                      {shareUsers.map(u => (
                        <span key={u.id} className="inline-flex items-center gap-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 text-xs px-2 py-0.5 rounded-full">
                          {u.name}
                          <button
                            type="button"
                            onClick={() => setShareUsers(prev => prev.filter(x => x.id !== u.id))}
                            className="hover:text-red-500 ml-0.5"
                          >
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                      {shareUsers.length === 0 && <span className="text-xs text-[#94A3B8]">No users added</span>}
                    </div>
                    <select
                      className="w-full border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0F172A] text-[#1E293B] dark:text-[#F1F5F9] text-xs px-2 py-1.5 rounded focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                      value=""
                      onChange={e => {
                        if (!e.target.value) return
                        const uid = Number(e.target.value)
                        const u = availableUsersForShare.find(x => x.id === uid)
                        if (u && !shareUsers.some(x => x.id === uid)) {
                          setShareUsers(prev => [...prev, { id: u.id, name: u.name, email: u.email }])
                        }
                      }}
                    >
                      <option value="">— Add user —</option>
                      {availableUsersForShare
                        .filter(u => !shareUsers.some(x => x.id === u.id))
                        .map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
                    </select>
                  </div>

                  {/* Groups */}
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[#1E293B] dark:text-[#F1F5F9]">Groups</p>
                    <div className="flex flex-wrap gap-1.5">
                      {shareGroups.map(g => (
                        <span key={g.id} className="inline-flex items-center gap-1 bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 text-xs px-2 py-0.5 rounded-full">
                          {g.name}
                          <button
                            type="button"
                            onClick={() => setShareGroups(prev => prev.filter(x => x.id !== g.id))}
                            className="hover:text-red-500 ml-0.5"
                          >
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                      {shareGroups.length === 0 && <span className="text-xs text-[#94A3B8]">No groups added</span>}
                    </div>
                    <select
                      className="w-full border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0F172A] text-[#1E293B] dark:text-[#F1F5F9] text-xs px-2 py-1.5 rounded focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                      value=""
                      onChange={e => {
                        if (!e.target.value) return
                        const gid = Number(e.target.value)
                        const g = availableGroupsForShare.find(x => x.id === gid)
                        if (g && !shareGroups.some(x => x.id === gid)) {
                          setShareGroups(prev => [...prev, { id: g.id, name: g.name }])
                        }
                      }}
                    >
                      <option value="">— Add group —</option>
                      {availableGroupsForShare
                        .filter(g => !shareGroups.some(x => x.id === g.id))
                        .map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </div>

                  {shareError && <p className="text-red-600 text-xs">{shareError}</p>}
                  <button
                    type="button"
                    disabled={shareSaving}
                    onClick={() => {
                      if (!id) return
                      setShareSaving(true)
                      setShareError(null)
                      saveCollectionShares(parseInt(id, 10), {
                        userIds: shareUsers.map(u => u.id),
                        groupIds: shareGroups.map(g => g.id),
                      })
                        .catch(err => setShareError((err as Error).message))
                        .finally(() => setShareSaving(false))
                    }}
                    className="inline-flex items-center gap-1.5 bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
                  >
                    <Save size={14} />
                    {shareSaving ? 'Saving…' : 'Save Access'}
                  </button>
                </div>
              )}

            </div>
          )}

          {detailsTab === 'versions' && isEdit && (
            <div className="space-y-4">
              <p className="text-xs text-[#64748B]">Compare two saved versions to review what changed.</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>From Version</label>
                  <select
                    value={versionCompareFromId ?? ''}
                    onChange={e => setVersionCompareFromId(Number(e.target.value))}
                    className={INPUT}
                  >
                    {versions.map(v => (
                      <option key={`from-${v.id}`} value={v.id}>
                        v{v.versionNumber} ({v.status})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>To Version</label>
                  <select
                    value={versionCompareToId ?? ''}
                    onChange={e => setVersionCompareToId(Number(e.target.value))}
                    className={INPUT}
                  >
                    {versions.map(v => (
                      <option key={`to-${v.id}`} value={v.id}>
                        v{v.versionNumber} ({v.status})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {versionDiffError && (
                <div className="rounded border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-3 text-red-700 dark:text-red-400 text-sm">
                  {versionDiffError}
                </div>
              )}

              {versionDiffLoading && (
                <p className="text-sm text-[#64748B]">Loading version details…</p>
              )}

              {!versionDiffLoading && versionDiff && (
                <div className="rounded border border-[#E2E8F0] dark:border-[#334155] overflow-hidden">
                  <div className="px-4 py-3 bg-[#F8FAFC] dark:bg-[#0F172A] border-b border-[#E2E8F0] dark:border-[#334155] flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-[#475569] dark:text-[#94A3B8]">Summary:</span>
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-[2px] bg-[#E2E8F0] text-[#475569] dark:bg-[#334155] dark:text-[#CBD5E1]">Metadata {versionDiff.metadataChanged}</span>
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-[2px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">Added {versionDiff.fieldsAdded}</span>
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-[2px] bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">Removed {versionDiff.fieldsRemoved}</span>
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-[2px] bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">Changed {versionDiff.fieldsChanged}</span>
                  </div>
                  {versionDiff.changes.length > 0 ? (
                    <ul className="p-4 space-y-2 text-sm text-[#1E293B] dark:text-[#F1F5F9] list-disc list-inside">
                      {versionDiff.changes.map(change => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="p-4 text-sm text-[#64748B]">No differences found between the selected versions.</p>
                  )}
                </div>
              )}

              <div className="border-t border-[#E2E8F0] dark:border-[#334155] pt-4 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">
                  Version History
                </h3>
                {versions.length === 0 ? (
                  <p className="text-sm text-[#64748B]">No saved versions yet.</p>
                ) : (
                  <div className="space-y-2">
                    {versions.map(v => {
                      const isActive = v.isActive
                      return (
                        <div
                          key={v.id}
                          className="flex items-center justify-between gap-3 rounded border border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A] px-3 py-2"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-sm font-medium text-[#1E293B] dark:text-[#F1F5F9]">
                              v{v.versionNumber}
                            </span>
                            <span className={[
                              'text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border',
                              v.status === 'published'
                                ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-700'
                                : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700',
                            ].join(' ')}>
                              {v.status}
                            </span>
                            {isActive && (
                              <span className="text-[10px] font-medium text-[#2563EB]">Active</span>
                            )}
                            <span className="text-xs text-[#94A3B8] truncate">
                              {new Date(v.createdAt).toLocaleString()}
                            </span>
                          </div>
                          {canRestoreVersions() && (
                            <button
                              type="button"
                              onClick={() => handleRestoreVersionClick(v.id)}
                              disabled={isActive}
                              title={isActive ? 'This is the active version' : 'Restore this version as a new draft'}
                              className="inline-flex items-center gap-1 text-xs text-[#0F766E] hover:text-[#0D5C56] disabled:text-[#94A3B8] disabled:cursor-not-allowed transition-colors shrink-0"
                            >
                              <RotateCcw size={12} />
                              Restore
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Ticket Assignment */}
        {detailsTab === 'ticket' && isEdit && (
          <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">
                Add Ticket
              </h2>
              <span className="text-xs text-[#64748B]">Manage templates in Tickets, then assign them here.</span>
            </div>
            <p className="text-xs text-[#64748B]">
              Assign one or more reusable ticket templates to this collection. Each assigned ticket appears separately in Records for every submission.
            </p>

            <div className="space-y-3">
              <div className="rounded border border-[#E2E8F0] dark:border-[#334155] bg-[#FAFAFA] dark:bg-[#0F172A] p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-[#64748B] mb-2">Available templates</div>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {availableTicketTemplates
                    .filter(template => !assignedTicketTemplates.some(assigned => assigned.id === template.id && !assigned.isArchived))
                    .length === 0 ? (
                      <div className="text-sm text-[#64748B]">No unassigned ticket templates are available.</div>
                    ) : (
                      availableTicketTemplates
                        .filter(template => !assignedTicketTemplates.some(assigned => assigned.id === template.id && !assigned.isArchived))
                        .map(template => (
                          <button
                            key={template.id}
                            type="button"
                            onClick={() => setSelectedTicketTemplateId(String(template.id))}
                            className={[
                              'w-full rounded border px-3 py-3 text-left transition-colors',
                              selectedTicketTemplateId === String(template.id)
                                ? 'border-[#2563EB] bg-blue-50 dark:bg-blue-900/20'
                                : 'border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#111827] hover:border-[#BFDBFE] dark:hover:border-[#475569]',
                            ].join(' ')}
                          >
                            <div className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">{template.title}</div>
                            <div className="mt-1 text-xs text-[#64748B]">{template.description || 'No description provided.'}</div>
                          </button>
                        ))
                    )}
                </div>
              </div>

              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={addAssignedTicketTemplate}
                  disabled={!selectedTicketTemplateId}
                  className="inline-flex items-center justify-center gap-2 rounded border border-[#2563EB] px-4 py-2 text-sm font-semibold text-[#2563EB] hover:bg-blue-50 disabled:opacity-50"
                >
                  <Plus size={14} />
                  Add Selected Ticket
                </button>
              </div>
            </div>

            {/* Active tickets */}
            <div className="space-y-3">
              {assignedTicketTemplates.filter(t => !t.isArchived).length === 0 ? (
                <div className="text-center py-10 text-[#94A3B8] text-sm">
                  No ticket templates assigned yet.
                </div>
              ) : (
                assignedTicketTemplates.filter(t => !t.isArchived).map((template, index, activeList) => (
                  <div
                    key={template.id}
                    className="rounded-lg border border-[#E2E8F0] dark:border-[#334155] bg-[#FAFAFA] dark:bg-[#0F172A] p-4 flex items-start justify-between gap-4"
                  >
                    <div>
                      <div className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">{template.title}</div>
                      <div className="mt-1 text-xs text-[#64748B]">{template.description || 'No description'}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => moveAssignedTicketTemplate(template.id, -1)}
                        disabled={index === 0}
                        className="text-[#94A3B8] hover:text-[#64748B] disabled:opacity-30 transition-colors"
                        aria-label="Move ticket up"
                      >
                        <ChevronUp size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveAssignedTicketTemplate(template.id, 1)}
                        disabled={index === activeList.length - 1}
                        className="text-[#94A3B8] hover:text-[#64748B] disabled:opacity-30 transition-colors"
                        aria-label="Move ticket down"
                      >
                        <ChevronDown size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => archiveAssignedTicketTemplate(template.id)}
                        className="text-[#94A3B8] hover:text-amber-500 transition-colors"
                        aria-label="Archive ticket"
                        title="Archive ticket (hides the form, keeps existing entries)"
                      >
                        <Archive size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeAssignedTicketTemplate(template.id)}
                        className="text-[#94A3B8] hover:text-red-500 transition-colors"
                        aria-label="Remove ticket assignment"
                        title="Remove ticket assignment"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Archived tickets */}
            {assignedTicketTemplates.some(t => t.isArchived) && (
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">Archived</div>
                {assignedTicketTemplates.filter(t => t.isArchived).map(template => (
                  <div
                    key={template.id}
                    className="rounded-lg border border-dashed border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A] p-4 flex items-start justify-between gap-4 opacity-60"
                  >
                    <div>
                      <div className="text-sm font-semibold text-[#64748B]">{template.title}</div>
                      <div className="mt-1 text-xs text-[#94A3B8]">{template.description || 'No description'}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => restoreAssignedTicketTemplate(template.id)}
                      className="text-[#94A3B8] hover:text-[#2563EB] transition-colors shrink-0"
                      aria-label="Restore ticket"
                      title="Restore ticket (makes the form active again)"
                    >
                      <ArchiveRestore size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {ticketSaveError && (
              <div className="rounded border border-red-200 bg-red-50 dark:bg-red-900/20 p-3 text-red-700 dark:text-red-400 text-sm">
                {ticketSaveError}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSaveTicket}
                disabled={ticketSaving}
                className="inline-flex items-center gap-2 rounded bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                {ticketSaving ? 'Saving…' : ticketSaved ? 'Saved!' : 'Save Assigned Tickets'}
              </button>
            </div>
          </div>
        )}

        {/* Two-column: Instructions + Field Designer (General tab only) */}
        {detailsTab === 'general' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-5 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">
              Instructions
            </h2>
            <div>
              <label htmlFor={`${formId}-instructions`} className={LABEL}>
                Description / Instructions
              </label>
              <RichTextEditor
                value={instructions}
                onChange={setInstructions}
                placeholder="Provide context or step-by-step instructions for respondents…"
                minHeightClassName="min-h-[180px]"
              />
            </div>
            <div>
              <label htmlFor={`${formId}-doc-url`} className={LABEL}>
                Link to Google Doc or PDF (optional)
              </label>
              <input
                id={`${formId}-doc-url`}
                type="url"
                placeholder="https://docs.google.com/… or https://…/file.pdf"
                value={instructionsDocUrl}
                onChange={e => setInstructionsDocUrl(e.target.value)}
                className={INPUT}
              />
              {instructionsDocUrl && (
                <div className="mt-2 border border-[#E2E8F0] dark:border-[#334155] rounded overflow-hidden h-40">
                  <iframe
                    src={toEmbedUrl(instructionsDocUrl)}
                    title="Document preview"
                    className="w-full h-full"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Field Designer */}
          <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">
                Form Fields
              </h2>
              <div className="flex items-center gap-3">
                {isEdit ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/collections/${id}/branching`)}
                    className="inline-flex items-center gap-1 text-xs text-[#0F766E] hover:underline"
                  >
                    <GitBranch size={12} />
                    Edit branching
                  </button>
                ) : (
                  <span className="text-[11px] text-[#94A3B8]">Save the collection to configure branching</span>
                )}
                <button
                  onClick={() => setFields(prev => [...prev, blankField(activeBuilderPage)])}
                  className="flex items-center gap-1 text-xs text-[#2563EB] hover:underline"
                >
                  <Plus size={13} />
                  Add field
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {builderPages.map(pageNumber => (
                <button
                  key={pageNumber}
                  type="button"
                  onClick={() => setActiveBuilderPage(pageNumber)}
                  className={[
                    'px-3 py-2 text-sm font-semibold border-b-2 transition-colors rounded-t',
                    activeBuilderPage === pageNumber
                      ? 'border-[#2563EB] text-[#2563EB] bg-blue-50 dark:bg-blue-900/20'
                      : 'border-transparent text-[#64748B] hover:text-[#2563EB] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]',
                  ].join(' ')}
                >
                  Page {pageNumber}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {visibleFields.map((field, idx) => (
                <FieldCard
                  key={field._key}
                  field={field}
                  index={idx}
                  total={visibleFields.length}
                  onUpdate={patch => updateField(field._key, patch)}
                  onRemove={() => handleRemoveFieldClick(field)}
                  onMoveUp={() => moveField(field._key, -1)}
                  onMoveDown={() => moveField(field._key, 1)}
                  onAddOption={() => addOption(field._key)}
                  onAddOtherOption={() => addOtherOption(field._key)}
                  onRemoveOtherOption={() => removeOtherOption(field._key)}
                  onUpdateOption={(i, v) => updateOption(field._key, i, v)}
                  onRemoveOption={i => removeOption(field._key, i)}
                  onConfigureTable={() => setWizardField(field._key)}
                  onConfigureMatrix={() => setMatrixConfigField(field._key)}
                  isPendingRemove={pendingRemoveKey === field._key}
                  collectionStatus={status}
                  onConfirmRemove={() => confirmRemoveField(field)}
                  onCancelRemove={cancelRemoveField}
                />
              ))}
            </div>

            <button
              onClick={() => setFields(prev => [...prev, blankField(activeBuilderPage)])}
              className="w-full border-2 border-dashed border-[#E2E8F0] dark:border-[#334155] rounded-lg py-3 text-sm text-[#94A3B8] hover:border-[#2563EB] hover:text-[#2563EB] transition-colors flex items-center justify-center gap-2"
            >
              <Plus size={15} />
              Add another field
            </button>
          </div>
        </div>
        )}
      </div>
    </>
  )
}

// ── FieldCard sub-component ───────────────────────────────────

interface FieldCardProps {
  field: BuilderField
  index: number
  total: number
  onUpdate: (patch: Partial<BuilderField>) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onAddOption: () => void
  onAddOtherOption: () => void
  onRemoveOtherOption: () => void
  onUpdateOption: (idx: number, val: string) => void
  onRemoveOption: (idx: number) => void
  onConfigureTable: () => void
  onConfigureMatrix: () => void
  hideStaffOnly?: boolean
  isPendingRemove?: boolean
  collectionStatus?: CollectionStatus
  onConfirmRemove?: () => void
  onCancelRemove?: () => void
}

const FIELD_INPUT =
  'border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0F172A] ' +
  'text-[#1E293B] dark:text-[#F1F5F9] placeholder-[#94A3B8] px-2.5 py-1.5 text-sm rounded ' +
  'focus:outline-none focus:ring-2 focus:ring-[#2563EB]'

function FieldCard({
  field,
  index,
  total,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  onAddOption,
  onAddOtherOption,
  onRemoveOtherOption,
  onUpdateOption,
  onRemoveOption,
  onConfigureTable,
  onConfigureMatrix,
  hideStaffOnly = false,
  isPendingRemove = false,
  collectionStatus = 'draft',
  onConfirmRemove,
  onCancelRemove,
}: FieldCardProps) {
  const showOptions =
    field.type === 'single_choice' || field.type === 'multiple_choice'
  const showTable = field.type === 'custom_table'
  const isDocumentField = field.type === 'document'
  const regularOptions = field.options.filter(opt => opt !== OTHER_OPTION_MARKER)
  const hasOtherOption = field.options.includes(OTHER_OPTION_MARKER)
  const documentConfig = parseDocumentFieldConfig(field.options)
  const documentPreviewUrl = getDocumentEmbedUrl(documentConfig)

  function updateDocumentConfig(patch: Partial<{ kind: DocumentFieldKind; url: string }>) {
    onUpdate({
      options: serialiseDocumentFieldConfig({
        kind: patch.kind ?? documentConfig.kind,
        url: patch.url ?? documentConfig.url,
      }),
      required: false,
    })
  }

  return (
    <div className={[
      'border rounded-lg p-3 space-y-3 bg-[#FAFAFA] dark:bg-[#0F172A]',
      field.staffOnly
        ? 'border-amber-400 dark:border-amber-600'
        : 'border-[#E2E8F0] dark:border-[#334155]',
    ].join(' ')}>
      {isPendingRemove && (
        <div className="rounded border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-3 space-y-2">
          <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-400">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Remove field &quot;{field.label}&quot;?</p>
              {collectionStatus === 'published' && (
                <p className="text-xs mt-1">
                  This collection is published. Removing this field may affect existing submissions and reports.
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onConfirmRemove}
              className="inline-flex items-center gap-1 rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition-colors"
            >
              <Trash2 size={12} />
              Remove
            </button>
            <button
              type="button"
              onClick={onCancelRemove}
              className="rounded border border-[#CBD5E1] dark:border-[#475569] px-3 py-1.5 text-xs font-medium text-[#64748B] hover:bg-[#F1F5F9] dark:hover:bg-[#1E293B] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Row 1: type selector + move/delete */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold text-[#94A3B8] w-5 text-center shrink-0">
          {index + 1}
        </span>
        <select
          value={field.type}
          onChange={e => {
            const t = e.target.value as FieldType
            onUpdate({
              type: t,
              options: [],
              tableColumns: [],
              displayStyle: resolveDisplayStyle(t),
              branchRules: [],
              required: t === 'document' ? false : field.required,
            })
          }}
          className={`${FIELD_INPUT} flex-1`}
        >
          {(Object.entries(FIELD_TYPE_LABELS) as [FieldType, string][]).map(
            ([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            )
          )}
        </select>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onMoveUp}
            disabled={index === 0}
            className="text-[#94A3B8] hover:text-[#64748B] disabled:opacity-30 transition-colors"
          >
            <ChevronUp size={15} />
          </button>
          <button
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="text-[#94A3B8] hover:text-[#64748B] disabled:opacity-30 transition-colors"
          >
            <ChevronDown size={15} />
          </button>
          <button
            onClick={onRemove}
            className="text-[#94A3B8] hover:text-red-500 transition-colors ml-1"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Row 2: label + required */}
      <div className="pl-7 space-y-2">
        {field.type === 'comment' ? (
          <RichTextEditor
            placeholder="Comment text with formatting (bold, italic, lists, colors, etc.)"
            value={field.label}
            onChange={html => onUpdate({ label: html })}
            minHeightClassName="min-h-32"
          />
        ) : (
          <input
            type="text"
            placeholder="Field label"
            value={field.label}
            onChange={e => onUpdate({ label: e.target.value })}
            className={`${FIELD_INPUT} w-full`}
          />
        )}
        {field.type !== 'comment' && (
          <input
            type="text"
            placeholder="Subtitle (optional)"
            value={field.subtitle}
            onChange={e => onUpdate({ subtitle: e.target.value })}
            className={`${FIELD_INPUT} w-full text-[#64748B] dark:text-[#94A3B8]`}
          />
        )}
        <div className="flex items-center gap-4 flex-wrap">
          {field.type !== 'comment' && field.type !== 'matrix_likert_scale' && field.type !== 'document' && (
          <label className="flex items-center gap-1 text-xs text-[#64748B] cursor-pointer">
            <input
              type="checkbox"
              checked={field.required}
              onChange={e => onUpdate({ required: e.target.checked })}
              className="accent-[#2563EB] w-3.5 h-3.5"
            />
            Required
          </label>
          )}
          <label className="flex items-center gap-1 text-xs text-[#64748B]">
            Page
            <input
              type="number"
              min={1}
              value={field.page}
              onChange={e => onUpdate({ page: Math.max(1, Number(e.target.value) || 1) })}
              className={`${FIELD_INPUT} w-16`}
            />
          </label>
          {!hideStaffOnly && (
          <label className="flex items-center gap-1 text-xs cursor-pointer select-none text-amber-600 dark:text-amber-500">
            <input
              type="checkbox"
              checked={field.staffOnly}
              onChange={e => onUpdate({ staffOnly: e.target.checked })}
              className="accent-amber-500 w-3.5 h-3.5"
            />
            <Lock size={11} />
            Staff only
          </label>
          )}
        </div>

        {/* Display style toggle for single_choice */}
        {field.type === 'single_choice' && (
          <div className="flex items-center gap-1 text-xs text-[#64748B]">
            <span className="shrink-0">Display as:</span>
            <button
              type="button"
              onClick={() => onUpdate({ displayStyle: 'radio' })}
              className={[
                'px-2 py-0.5 rounded border text-xs transition-colors',
                field.displayStyle === 'radio'
                  ? 'bg-[#2563EB] border-[#2563EB] text-white'
                  : 'border-[#CBD5E1] dark:border-[#334155] text-[#64748B] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]',
              ].join(' ')}
            >
              Radio
            </button>
            <button
              type="button"
              onClick={() => onUpdate({ displayStyle: 'dropdown' })}
              className={[
                'px-2 py-0.5 rounded border text-xs transition-colors',
                field.displayStyle === 'dropdown'
                  ? 'bg-[#2563EB] border-[#2563EB] text-white'
                  : 'border-[#CBD5E1] dark:border-[#334155] text-[#64748B] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]',
              ].join(' ')}
            >
              Dropdown
            </button>
            {field.branchRules.length > 0 && (
              <span className="ml-2 rounded-[2px] bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                {field.branchRules.length} branch rule{field.branchRules.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        )}

        {field.type === 'rating' && (
          <div className="flex items-center gap-1 text-xs text-[#64748B]">
            <span className="shrink-0">Display as:</span>
            <button
              type="button"
              onClick={() => onUpdate({ displayStyle: 'stars' })}
              className={[
                'px-2 py-0.5 rounded border text-xs transition-colors',
                field.displayStyle === 'stars'
                  ? 'bg-[#2563EB] border-[#2563EB] text-white'
                  : 'border-[#CBD5E1] dark:border-[#334155] text-[#64748B] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]',
              ].join(' ')}
            >
              Stars
            </button>
            <button
              type="button"
              onClick={() => onUpdate({ displayStyle: 'numbers' })}
              className={[
                'px-2 py-0.5 rounded border text-xs transition-colors',
                field.displayStyle === 'numbers'
                  ? 'bg-[#2563EB] border-[#2563EB] text-white'
                  : 'border-[#CBD5E1] dark:border-[#334155] text-[#64748B] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]',
              ].join(' ')}
            >
              Numbers
            </button>
          </div>
        )}

        {isDocumentField && (
          <div className="space-y-3 rounded border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0B1220] p-3">
            <div className="flex items-center gap-1 text-xs text-[#64748B]">
              <span className="shrink-0">Document type:</span>
              <button
                type="button"
                onClick={() => updateDocumentConfig({ kind: 'google_doc' })}
                className={[
                  'px-2 py-0.5 rounded border text-xs transition-colors',
                  documentConfig.kind === 'google_doc'
                    ? 'bg-[#2563EB] border-[#2563EB] text-white'
                    : 'border-[#CBD5E1] dark:border-[#334155] text-[#64748B] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]',
                ].join(' ')}
              >
                Google Doc
              </button>
              <button
                type="button"
                onClick={() => updateDocumentConfig({ kind: 'pdf' })}
                className={[
                  'px-2 py-0.5 rounded border text-xs transition-colors',
                  documentConfig.kind === 'pdf'
                    ? 'bg-[#2563EB] border-[#2563EB] text-white'
                    : 'border-[#CBD5E1] dark:border-[#334155] text-[#64748B] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]',
                ].join(' ')}
              >
                PDF Doc
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#64748B] mb-1">Public document link</label>
              <input
                type="url"
                placeholder={documentConfig.kind === 'google_doc' ? 'https://docs.google.com/…' : 'https://…/file.pdf'}
                value={documentConfig.url}
                onChange={e => updateDocumentConfig({ url: e.target.value })}
                className={`${FIELD_INPUT} w-full`}
              />
              <p className="mt-1 text-[11px] text-[#94A3B8]">
                This link must be publicly viewable. Respondents will see an inline preview and can open the document in a new tab.
              </p>
            </div>

            {documentPreviewUrl ? (
              <div className="overflow-hidden rounded border border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A]">
                <iframe
                  src={documentPreviewUrl}
                  title="Document field preview"
                  className="h-[500px] w-full"
                  loading="lazy"
                />
              </div>
            ) : documentConfig.url ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Enter a valid public document URL to preview this field.
              </p>
            ) : null}
          </div>
        )}
      </div>

      {/* Choice options */}
      {showOptions && (
        <div className="pl-7 space-y-2">
          {field.options.map((opt, i) => {
            if (opt === OTHER_OPTION_MARKER) return null
            const visibleIndex = regularOptions.indexOf(opt)
            return (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder={`Option ${visibleIndex + 1}`}
                  value={opt}
                  onChange={e => onUpdateOption(i, e.target.value)}
                  className={`${FIELD_INPUT} flex-1`}
                />
                <button
                  onClick={() => onRemoveOption(i)}
                  className="text-[#94A3B8] hover:text-red-500 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )
          })}
          <button
            onClick={onAddOption}
            className="flex items-center gap-1 text-xs text-[#2563EB] hover:underline"
          >
            <Plus size={12} />
            Add option
          </button>
          {!hasOtherOption ? (
            <button
              onClick={onAddOtherOption}
              className="flex items-center gap-1 text-xs text-[#2563EB] hover:underline"
            >
              <Plus size={12} />
              Add other option
            </button>
          ) : (
            <div className="flex items-center justify-between rounded border border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A] px-2.5 py-2 text-xs">
              <span className="text-[#64748B]">Other option enabled (shows a free-text box when selected)</span>
              <button
                type="button"
                onClick={onRemoveOtherOption}
                className="text-[#94A3B8] hover:text-red-500 transition-colors"
                title="Remove Other option"
              >
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Table wizard */}
      {showTable && (
        <div className="pl-7">
          <button
            onClick={onConfigureTable}
            className="flex items-center gap-1.5 text-xs bg-[#2563EB] hover:bg-[#1D4ED8] text-white px-3 py-1.5 rounded transition-colors"
          >
            <Settings2 size={13} />
            Configure Columns
            {field.tableColumns.length > 0 && (
              <span className="ml-1 text-white font-medium">
                ({field.tableColumns.length})
              </span>
            )}
          </button>
        </div>
      )}

      {/* Matrix Likert config */}
      {field.type === 'matrix_likert_scale' && (
        <div className="pl-7">
          <button
            onClick={() => onConfigureMatrix()}
            className="flex items-center gap-1.5 text-xs bg-[#2563EB] hover:bg-[#1D4ED8] text-white px-3 py-1.5 rounded transition-colors"
          >
            <Settings2 size={13} />
            Configure Matrix
            {field.options && field.options.length > 0 && (
              <span className="ml-1 text-white font-medium">
                ({field.options.length} rows)
              </span>
            )}
          </button>
        </div>
      )}

      {/* Location filter option */}
      {field.type === 'location' && (
        <div className="pl-7">
          <label className="flex items-start gap-2 cursor-pointer select-none rounded border border-teal-200 dark:border-teal-900/40 bg-teal-50 dark:bg-teal-900/10 px-3 py-2.5">
            <input
              type="checkbox"
              checked={field.locationFilterEnabled}
              onChange={e => onUpdate({ locationFilterEnabled: e.target.checked })}
              className="accent-teal-600 w-3.5 h-3.5 mt-0.5 shrink-0"
            />
            <span className="text-xs text-teal-800 dark:text-teal-300">
              <span className="font-medium">Limit views based on the logged in person&apos;s Location</span>
              <span className="block mt-0.5 text-teal-600 dark:text-teal-400">When enabled, users will only see submissions where this field matches their assigned location.</span>
            </span>
          </label>
        </div>
      )}
    </div>
  )
}
