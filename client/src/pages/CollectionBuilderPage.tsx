import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  Settings2,
  Save,
  Eye,
  Copy,
  Upload,
} from 'lucide-react'
import {
  createCollection,
  createCollectionVersion,
  getCollection,
  listCollectionVersions,
  publishCollectionVersion,
  updateCollection,
} from '../api/collections'
import { listCategories } from '../api/categories'
import type { Category } from '../types'
import type {
  ColType,
  CollectionStatus,
  CollectionVersion,
  FieldType,
  TableColumn,
} from '../types'
import TableWizardModal from '../components/collections/TableWizardModal'
import RichTextEditor from '../components/common/RichTextEditor'
import { toEmbedUrl } from '../utils/docPreviewUrl'
import { htmlToPlainText } from '../utils/richText'
import { useToast } from '../contexts/ToastContext'

// ── Local builder types ───────────────────────────────────────

interface BuilderField {
  _key: string
  type: FieldType
  label: string
  page: number
  required: boolean
  options: string[]
  displayStyle: 'radio' | 'dropdown'
  tableColumns: TableColumn[]
}

function uid(): string {
  return Math.random().toString(36).slice(2)
}

function blankField(): BuilderField {
  return {
    _key: uid(),
    type: 'short_text',
    label: '',
    page: 1,
    required: false,
    options: [],
    displayStyle: 'radio',
    tableColumns: [],
  }
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  short_text: 'Short Text',
  long_text: 'Long Text',
  single_choice: 'Single Choice',
  multiple_choice: 'Multiple Choice',
  attachment: 'Attachment',
  signature: 'Signature',
  confirmation: 'Confirmation (Checkbox)',
  custom_table: 'Custom Table',
}

function normalizeFieldType(type: string): FieldType {
  const valid = new Set<FieldType>([
    'short_text',
    'long_text',
    'single_choice',
    'multiple_choice',
    'attachment',
    'signature',
    'confirmation',
    'custom_table',
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

// ── Component ─────────────────────────────────────────────────

export default function CollectionBuilderPage() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const formId = useId()
  const isEdit = !!id
  const { showToast } = useToast()

  // Metadata
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [dateDue, setDateDue] = useState('')
  const [coverPhotoUrl, setCoverPhotoUrl] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [status, setStatus] = useState<CollectionStatus>('draft')

  // Instructions section
  const [instructions, setInstructions] = useState('')
  const [instructionsDocUrl, setInstructionsDocUrl] = useState('')
  const [allowSubmissionEdits, setAllowSubmissionEdits] = useState(false)
  const [submissionEditWindowHours, setSubmissionEditWindowHours] = useState('24')

  // Fields
  const [fields, setFields] = useState<BuilderField[]>([blankField()])

  // UI state
  const [saving, setSaving] = useState(false)
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [wizardField, setWizardField] = useState<string | null>(null) // _key of field being configured
  const [collectionSlug, setCollectionSlug] = useState<string | null>(null)
  const [activeVersionId, setActiveVersionId] = useState<number | null>(null)
  const [currentVersionNumber, setCurrentVersionNumber] = useState<number | null>(null)
  const [versions, setVersions] = useState<CollectionVersion[]>([])
  const [detailsTab, setDetailsTab] = useState<'general' | 'photo' | 'share'>('general')
  const [categories, setCategories] = useState<Category[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [categoriesError, setCategoriesError] = useState<string | null>(null)

  // Used to skip autosave on initial load
  const loadedRef = useRef(false)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [loadTick, setLoadTick] = useState(0)

  // Load existing collection when editing
  useEffect(() => {
    if (!id) return
    getCollection(parseInt(id, 10))
      .then(col => {
        setTitle(col.title)
        setCollectionSlug(col.slug)
        setActiveVersionId(col.activeVersionId ?? null)
        setCurrentVersionNumber(col.currentVersionNumber ?? null)
        setDescription(col.description ? htmlToPlainText(col.description) : '')
        setCategory(col.category ?? '')
        setDateDue(col.dateDue ?? '')
        setCoverPhotoUrl(col.coverPhotoUrl ?? '')
        setAnonymous(col.anonymous)
        setAllowSubmissionEdits(col.allowSubmissionEdits)
        setSubmissionEditWindowHours(String(col.submissionEditWindowHours ?? 24))
        setStatus(col.status ?? 'draft')
        setInstructions(col.instructions ?? '')
        setInstructionsDocUrl(col.instructionsDocUrl ?? '')
        setFields(
          col.fields.length > 0
            ? col.fields.map(f => ({
                _key: uid(),
                type: normalizeFieldType(f.type),
                label: f.label,
                page: f.page ?? 1,
                required: f.required,
                options: f.options ?? [],
                displayStyle: f.displayStyle === 'dropdown' ? 'dropdown' : 'radio',
                tableColumns: (f.tableColumns ?? []).map(tc => ({
                  ...tc,
                  colType: normalizeColType(tc.colType),
                  listOptions:
                    tc.colType === 'list'
                      ? (tc.listOptions ?? []).map(opt => String(opt).trim()).filter(Boolean)
                      : null,
                })),
              }))
            : [blankField()]
        )
        setLoadTick(t => t + 1)
      })
      .catch(err => setLoadError((err as Error).message))
  }, [id, isEdit])

  useEffect(() => {
    listCategories()
      .then(setCategories)
      .catch(err => setCategoriesError((err as Error).message))
      .finally(() => setCategoriesLoading(false))
  }, [])

  useEffect(() => {
    if (!id) return
    listCollectionVersions(parseInt(id, 10))
      .then(setVersions)
      .catch(() => setVersions([]))
  }, [id, loadTick])

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
      const idx = prev.findIndex(f => f._key === key)
      const next = [...prev]
      const target = idx + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[idx], next[target]] = [next[target], next[idx]]
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

  function handleCoverUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      setCoverPhotoUrl(result)
    }
    reader.readAsDataURL(file)
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
  }, [title, description, category, dateDue, coverPhotoUrl, anonymous, allowSubmissionEdits, submissionEditWindowHours, status, instructions, instructionsDocUrl, fields])

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

    return {
      title: title.trim(),
      status: statusOverride,
      description: description.trim() || undefined,
      category: category.trim() || undefined,
      dateDue: dateDue || undefined,
      coverPhotoUrl: coverPhotoUrl.trim() || undefined,
      instructions: instructions || undefined,
      instructionsDocUrl: instructionsDocUrl.trim() || undefined,
      anonymous,
      allowSubmissionEdits,
      submissionEditWindowHours: allowSubmissionEdits ? normalizedHours : undefined,
      fields: fields
        .filter(f => f.label.trim() !== '')
        .map((f, i) => ({
          type: normalizeFieldType(f.type),
          label: f.label.trim(),
          page: Math.max(1, Math.floor(f.page || 1)),
          required: f.required,
          options: f.options.filter(o => o.trim() !== ''),
          displayStyle: f.displayStyle,
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
      setLoadTick(t => t + 1)
      showToast('New draft version created', 'success')
    } catch (err) {
      setSaveError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const categoryOptions = useMemo(() => {
    const names = categories.map(item => item.name)
    if (category && !names.some(name => name.toLowerCase() === category.toLowerCase())) {
      return [...names, category]
    }
    return names
  }, [categories, category])

  // ── Wizard field ──────────────────────────────────────────

  const wizardBuilderField = wizardField
    ? fields.find(f => f._key === wizardField)
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
              {isEdit ? 'Edit Collection' : 'New Collection'}
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
                Test Form
              </button>
            )}
            {isEdit && (
              <button
                onClick={handleCreateNewVersion}
                disabled={saving}
                className="flex items-center gap-1.5 text-sm text-[#64748B] border border-[#E2E8F0] dark:border-[#334155] px-3 py-1.5 rounded hover:bg-[#F8FAFC] dark:hover:bg-[#1E293B] transition-colors disabled:opacity-40"
              >
                <Copy size={14} />
                New Version
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
              {saving
                ? 'Working...'
                : status === 'published'
                ? 'Move to Draft'
                : 'Publish'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-1.5 rounded transition-colors"
            >
              <Save size={14} />
              {saving ? 'Saving…' : 'Save'}
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
          <div className="flex items-center gap-2 border-b border-[#E2E8F0] dark:border-[#334155] pb-3">
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
                <input
                  id={`${formId}-description`}
                  type="text"
                  placeholder="Briefly describe the purpose of this collection"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className={INPUT}
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
            </div>
          )}

          {detailsTab === 'photo' && (
            <div className="space-y-4">
              <div>
                <label htmlFor={`${formId}-cover`} className={LABEL}>
                  Cover Photo URL (optional)
                </label>
                <input
                  id={`${formId}-cover`}
                  type="url"
                  placeholder="https://…"
                  value={coverPhotoUrl}
                  onChange={e => setCoverPhotoUrl(e.target.value)}
                  className={INPUT}
                />
              </div>

              <div>
                <label htmlFor={`${formId}-cover-upload`} className={LABEL}>
                  Upload Attachment (Image)
                </label>
                <label
                  htmlFor={`${formId}-cover-upload`}
                  className="inline-flex items-center gap-2 px-3 py-2 border border-[#CBD5E1] dark:border-[#334155] rounded text-sm text-[#475569] dark:text-[#94A3B8] cursor-pointer hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]"
                >
                  <Upload size={14} />
                  Upload Image
                </label>
                <input
                  id={`${formId}-cover-upload`}
                  type="file"
                  accept="image/*"
                  onChange={handleCoverUpload}
                  className="hidden"
                />
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
                  <div className="absolute inset-0 bg-black/30 flex items-end p-4">
                    <span className="text-white text-lg font-bold drop-shadow">
                      {title || 'Untitled Collection'}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[#94A3B8]">No cover photo selected yet.</p>
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

              <div className="pt-1 border-t border-[#E2E8F0] dark:border-[#334155]">
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
              </div>

              {allowSubmissionEdits && (
                <div className="max-w-xs">
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
          )}
        </div>

        {/* Two-column: Instructions + Field Designer (General tab only) */}
        {detailsTab === 'general' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Instructions */}
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
              <button
                onClick={() => setFields(prev => [...prev, blankField()])}
                className="flex items-center gap-1 text-xs text-[#2563EB] hover:underline"
              >
                <Plus size={13} />
                Add field
              </button>
            </div>

            <div className="space-y-3">
              {fields.map((field, idx) => (
                <FieldCard
                  key={field._key}
                  field={field}
                  index={idx}
                  total={fields.length}
                  onUpdate={patch => updateField(field._key, patch)}
                  onRemove={() => removeField(field._key)}
                  onMoveUp={() => moveField(field._key, -1)}
                  onMoveDown={() => moveField(field._key, 1)}
                  onAddOption={() => addOption(field._key)}
                  onUpdateOption={(i, v) => updateOption(field._key, i, v)}
                  onRemoveOption={i => removeOption(field._key, i)}
                  onConfigureTable={() => setWizardField(field._key)}
                />
              ))}
            </div>

            <button
              onClick={() => setFields(prev => [...prev, blankField()])}
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
  onUpdateOption: (idx: number, val: string) => void
  onRemoveOption: (idx: number) => void
  onConfigureTable: () => void
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
  onUpdateOption,
  onRemoveOption,
  onConfigureTable,
}: FieldCardProps) {
  const showOptions =
    field.type === 'single_choice' || field.type === 'multiple_choice'
  const showTable = field.type === 'custom_table'

  return (
    <div className="border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-3 space-y-3 bg-[#FAFAFA] dark:bg-[#0F172A]">
      {/* Row 1: type selector + move/delete */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold text-[#94A3B8] w-5 text-center shrink-0">
          {index + 1}
        </span>
        <select
          value={field.type}
          onChange={e => {
            const t = e.target.value as FieldType
            onUpdate({ type: t, options: [], tableColumns: [] })
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
        <input
          type="text"
          placeholder="Field label"
          value={field.label}
          onChange={e => onUpdate({ label: e.target.value })}
          className={`${FIELD_INPUT} w-full`}
        />
        <div className="flex items-center gap-4 flex-wrap">
          <label className="flex items-center gap-1 text-xs text-[#64748B] cursor-pointer">
            <input
              type="checkbox"
              checked={field.required}
              onChange={e => onUpdate({ required: e.target.checked })}
              className="accent-[#2563EB] w-3.5 h-3.5"
            />
            Required
          </label>
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
          </div>
        )}
      </div>

      {/* Choice options */}
      {showOptions && (
        <div className="pl-7 space-y-2">
          {field.options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                placeholder={`Option ${i + 1}`}
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
          ))}
          <button
            onClick={onAddOption}
            className="flex items-center gap-1 text-xs text-[#2563EB] hover:underline"
          >
            <Plus size={12} />
            Add option
          </button>
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
    </div>
  )
}
