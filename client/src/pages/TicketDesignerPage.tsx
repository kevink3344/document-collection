import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Save, Settings2, Trash2 } from 'lucide-react'
import MatrixLikertConfigModal from '../components/collections/MatrixLikertConfigModal'
import TableWizardModal from '../components/collections/TableWizardModal'
import RichTextEditor from '../components/common/RichTextEditor'
import {
  createTicketTemplate,
  getTicketTemplateFields,
  listTicketTemplates,
  saveTicketTemplateFields,
  updateTicketTemplate,
} from '../api/ticketTemplates'
import type {
  ColType,
  FieldDisplayStyle,
  FieldType,
  TableColumn,
  TicketField,
  TicketTemplate,
} from '../types'
import { useToast } from '../contexts/ToastContext'

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
  tableColumns: TableColumn[]
}

interface MatrixConfig {
  rows: string[]
  columns: string[]
}

const INPUT =
  'w-full border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0F172A] ' +
  'text-[#1E293B] dark:text-[#F1F5F9] placeholder-[#94A3B8] px-3 py-2 text-sm rounded ' +
  'focus:outline-none focus:ring-2 focus:ring-[#2563EB]'

const FIELD_INPUT =
  'border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0F172A] ' +
  'text-[#1E293B] dark:text-[#F1F5F9] placeholder-[#94A3B8] px-2.5 py-1.5 text-sm rounded ' +
  'focus:outline-none focus:ring-2 focus:ring-[#2563EB]'

const LABEL = 'block text-xs font-medium text-[#64748B] mb-1'
const OTHER_OPTION_MARKER = '__DCP_OTHER_OPTION__'

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  short_text: 'Short Text',
  date: 'Date',
  long_text: 'Long Text',
  single_choice: 'Single Choice',
  multiple_choice: 'Multiple Choice',
  document: 'Document',
  attachment: 'Attachment',
  signature: 'Signature',
  confirmation: 'Confirmation',
  custom_table: 'Custom Table',
  rating: 'Rating (1–5)',
  comment: 'Comment (Read-only)',
  matrix_likert_scale: 'Matrix Likert Scale',
  location: 'Location',
}

function uid(): string {
  return Math.random().toString(36).slice(2)
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
    tableColumns: [],
  }
}

function mapTicketFieldsToBuilder(fields: TicketField[]): BuilderField[] {
  if (fields.length === 0) {
    return [blankField()]
  }

  return fields.map(field => ({
    _key: uid(),
    fieldKey: field.fieldKey ?? uid(),
    type: normalizeFieldType(field.type),
    label: field.label,
    subtitle: field.subtitle ?? '',
    page: field.page ?? 1,
    required: field.required,
    options: field.options ?? [],
    displayStyle: resolveDisplayStyle(normalizeFieldType(field.type), field.displayStyle),
    tableColumns: (field.tableColumns ?? []).map(column => ({
      ...column,
      colType: normalizeColType(column.colType),
      listOptions:
        column.colType === 'list'
          ? (column.listOptions ?? []).map(option => String(option).trim()).filter(Boolean)
          : null,
    })),
  }))
}

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
}

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
}: FieldCardProps) {
  const showOptions = field.type === 'single_choice' || field.type === 'multiple_choice'
  const showTable = field.type === 'custom_table'
  const regularOptions = field.options.filter(option => option !== OTHER_OPTION_MARKER)
  const hasOtherOption = field.options.includes(OTHER_OPTION_MARKER)

  return (
    <div className="border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-3 space-y-3 bg-[#FAFAFA] dark:bg-[#0F172A]">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold text-[#94A3B8] w-5 text-center shrink-0">
          {index + 1}
        </span>
        <select
          value={field.type}
          onChange={event => {
            const nextType = event.target.value as FieldType
            onUpdate({
              type: nextType,
              options: [],
              tableColumns: [],
              displayStyle: resolveDisplayStyle(nextType),
            })
          }}
          className={`${FIELD_INPUT} flex-1`}
        >
          {(Object.entries(FIELD_TYPE_LABELS) as [FieldType, string][])
            .filter(([value]) => value !== 'document')
            .map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onMoveUp} disabled={index === 0} className="text-[#94A3B8] hover:text-[#64748B] disabled:opacity-30 transition-colors">
            <ChevronUp size={15} />
          </button>
          <button onClick={onMoveDown} disabled={index === total - 1} className="text-[#94A3B8] hover:text-[#64748B] disabled:opacity-30 transition-colors">
            <ChevronDown size={15} />
          </button>
          <button onClick={onRemove} className="text-[#94A3B8] hover:text-red-500 transition-colors ml-1">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="pl-7 space-y-2">
        {field.type === 'comment' ? (
          <RichTextEditor
            placeholder="Comment text with formatting"
            value={field.label}
            onChange={html => onUpdate({ label: html })}
            minHeightClassName="min-h-32"
          />
        ) : (
          <input
            type="text"
            placeholder="Field label"
            value={field.label}
            onChange={event => onUpdate({ label: event.target.value })}
            className={`${FIELD_INPUT} w-full`}
          />
        )}

        {field.type !== 'comment' && (
          <input
            type="text"
            placeholder="Subtitle (optional)"
            value={field.subtitle}
            onChange={event => onUpdate({ subtitle: event.target.value })}
            className={`${FIELD_INPUT} w-full text-[#64748B] dark:text-[#94A3B8]`}
          />
        )}

        <div className="flex items-center gap-4 flex-wrap">
          {field.type !== 'comment' && field.type !== 'matrix_likert_scale' && (
            <label className="flex items-center gap-1 text-xs text-[#64748B] cursor-pointer">
              <input
                type="checkbox"
                checked={field.required}
                onChange={event => onUpdate({ required: event.target.checked })}
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
              onChange={event => onUpdate({ page: Math.max(1, Number(event.target.value) || 1) })}
              className={`${FIELD_INPUT} w-16`}
            />
          </label>
        </div>

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
      </div>

      {showOptions && (
        <div className="pl-7 space-y-2">
          {field.options.map((option, indexValue) => {
            if (option === OTHER_OPTION_MARKER) return null
            const visibleIndex = regularOptions.indexOf(option)
            return (
              <div key={indexValue} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder={`Option ${visibleIndex + 1}`}
                  value={option}
                  onChange={event => onUpdateOption(indexValue, event.target.value)}
                  className={`${FIELD_INPUT} flex-1`}
                />
                <button onClick={() => onRemoveOption(indexValue)} className="text-[#94A3B8] hover:text-red-500 transition-colors">
                  <Trash2 size={13} />
                </button>
              </div>
            )
          })}
          <button onClick={onAddOption} className="flex items-center gap-1 text-xs text-[#2563EB] hover:underline">
            <Plus size={12} />
            Add option
          </button>
          {!hasOtherOption ? (
            <button onClick={onAddOtherOption} className="flex items-center gap-1 text-xs text-[#2563EB] hover:underline">
              <Plus size={12} />
              Add other option
            </button>
          ) : (
            <div className="flex items-center justify-between rounded border border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A] px-2.5 py-2 text-xs">
              <span className="text-[#64748B]">Other option enabled</span>
              <button type="button" onClick={onRemoveOtherOption} className="text-[#94A3B8] hover:text-red-500 transition-colors">
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>
      )}

      {showTable && (
        <div className="pl-7">
          <button onClick={onConfigureTable} className="flex items-center gap-1.5 text-xs bg-[#2563EB] hover:bg-[#1D4ED8] text-white px-3 py-1.5 rounded transition-colors">
            <Settings2 size={13} />
            Configure Columns
            {field.tableColumns.length > 0 && <span className="ml-1 font-medium">({field.tableColumns.length})</span>}
          </button>
        </div>
      )}

      {field.type === 'matrix_likert_scale' && (
        <div className="pl-7">
          <button onClick={onConfigureMatrix} className="flex items-center gap-1.5 text-xs bg-[#2563EB] hover:bg-[#1D4ED8] text-white px-3 py-1.5 rounded transition-colors">
            <Settings2 size={13} />
            Configure Matrix
          </button>
        </div>
      )}
    </div>
  )
}

export default function TicketDesignerPage() {
  const { showToast } = useToast()
  const [templates, setTemplates] = useState<TicketTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [fields, setFields] = useState<BuilderField[]>([blankField()])
  const [activePage, setActivePage] = useState(1)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [savingFields, setSavingFields] = useState(false)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [ticketWizardField, setTicketWizardField] = useState<string | null>(null)
  const [ticketMatrixConfigField, setTicketMatrixConfigField] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listTicketTemplates({ organizationOnly: true })
      .then(items => {
        if (cancelled) return
        setTemplates(items)
        setSelectedTemplateId(current => current ?? items[0]?.id ?? null)
      })
      .catch(err => {
        if (cancelled) return
        setLoadError((err as Error).message)
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const selectedTemplate = useMemo(
    () => templates.find(template => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  )

  useEffect(() => {
    if (!selectedTemplate) {
      setTitle('')
      setDescription('')
      setFields([blankField()])
      return
    }

    setTitle(selectedTemplate.title)
    setDescription(selectedTemplate.description ?? '')
    getTicketTemplateFields(selectedTemplate.id)
      .then(items => {
        setFields(mapTicketFieldsToBuilder(items))
        setActivePage(1)
      })
      .catch(err => {
        setFieldError((err as Error).message)
        setFields([blankField()])
      })
  }, [selectedTemplate])

  const pages = useMemo(() => {
    const values = Array.from(new Set(fields.map(field => Math.max(1, Math.floor(field.page || 1))))).sort((a, b) => a - b)
    return values.length > 0 ? values : [1]
  }, [fields])

  const visibleFields = useMemo(
    () => fields.filter(field => Math.max(1, Math.floor(field.page || 1)) === activePage),
    [activePage, fields],
  )

  function updateField(key: string, patch: Partial<BuilderField>) {
    setFields(prev => prev.map(field => (field._key === key ? { ...field, ...patch } : field)))
  }

  function removeField(key: string) {
    setFields(prev => {
      const next = prev.filter(field => field._key !== key)
      return next.length > 0 ? next : [blankField(activePage)]
    })
  }

  function moveField(key: string, direction: -1 | 1) {
    setFields(prev => {
      const currentField = prev.find(field => field._key === key)
      if (!currentField) return prev

      const samePageItems = prev
        .map((field, index) => ({ field, index }))
        .filter(({ field }) => Math.max(1, Math.floor(field.page || 1)) === Math.max(1, Math.floor(currentField.page || 1)))
      const pageIndex = samePageItems.findIndex(({ field }) => field._key === key)
      const targetPageIndex = pageIndex + direction
      if (pageIndex === -1 || targetPageIndex < 0 || targetPageIndex >= samePageItems.length) return prev

      const next = [...prev]
      const sourceIndex = samePageItems[pageIndex].index
      const targetIndex = samePageItems[targetPageIndex].index
      ;[next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]]
      return next
    })
  }

  function addOption(key: string) {
    setFields(prev => prev.map(field => (
      field._key === key ? { ...field, options: [...field.options, ''] } : field
    )))
  }

  function updateOption(key: string, index: number, value: string) {
    setFields(prev => prev.map(field => (
      field._key === key
        ? { ...field, options: field.options.map((option, optionIndex) => (optionIndex === index ? value : option)) }
        : field
    )))
  }

  function removeOption(key: string, index: number) {
    setFields(prev => prev.map(field => (
      field._key === key
        ? { ...field, options: field.options.filter((_, optionIndex) => optionIndex !== index) }
        : field
    )))
  }

  function addOtherOption(key: string) {
    setFields(prev => prev.map(field => (
      field._key === key && !field.options.includes(OTHER_OPTION_MARKER)
        ? { ...field, options: [...field.options, OTHER_OPTION_MARKER] }
        : field
    )))
  }

  function removeOtherOption(key: string) {
    setFields(prev => prev.map(field => (
      field._key === key
        ? { ...field, options: field.options.filter(option => option !== OTHER_OPTION_MARKER) }
        : field
    )))
  }

  async function handleCreateTemplate() {
    setTemplateError(null)
    try {
      const created = await createTicketTemplate(
        { title: 'Untitled Ticket', description: '' },
        { organizationOnly: true },
      )
      setTemplates(prev => [...prev, created].sort((a, b) => a.title.localeCompare(b.title)))
      setSelectedTemplateId(created.id)
      showToast('Ticket template created', 'success')
    } catch (err) {
      setTemplateError((err as Error).message)
    }
  }

  async function handleSaveTemplate() {
    if (!selectedTemplate) return
    setSavingTemplate(true)
    setTemplateError(null)
    try {
      const updated = await updateTicketTemplate(selectedTemplate.id, {
        title: title.trim(),
        description: description.trim() || null,
      })
      setTemplates(prev => prev.map(template => (template.id === updated.id ? updated : template)).sort((a, b) => a.title.localeCompare(b.title)))
      showToast('Ticket template saved', 'success')
    } catch (err) {
      setTemplateError((err as Error).message)
    } finally {
      setSavingTemplate(false)
    }
  }

  async function handleSaveFields() {
    if (!selectedTemplate) return
    setSavingFields(true)
    setFieldError(null)
    try {
      const payload = fields
        .filter(field => field.label.trim() !== '')
        .map((field, index) => ({
          fieldKey: field.fieldKey,
          type: normalizeFieldType(field.type),
          label: field.label.trim(),
          subtitle: field.subtitle.trim() || undefined,
          page: Math.max(1, Math.floor(field.page || 1)),
          required: field.required,
          options: field.options.filter(option => option.trim() !== ''),
          displayStyle: resolveDisplayStyle(field.type, field.displayStyle),
          sortOrder: index,
          tableColumns: field.tableColumns.map((column, columnIndex) => ({
            ...column,
            colType: normalizeColType(column.colType),
            listOptions:
              normalizeColType(column.colType) === 'list'
                ? (column.listOptions ?? []).map(option => option.trim()).filter(Boolean)
                : null,
            sortOrder: columnIndex,
          })),
        }))

      await saveTicketTemplateFields(selectedTemplate.id, payload)
      const refreshedTemplate = await updateTicketTemplate(selectedTemplate.id, {
        title: title.trim(),
        description: description.trim() || null,
      })
      setTemplates(prev => prev.map(template => (template.id === refreshedTemplate.id ? refreshedTemplate : template)))
      showToast('Ticket fields saved', 'success')
    } catch (err) {
      setFieldError((err as Error).message)
    } finally {
      setSavingFields(false)
    }
  }

  const wizardField = ticketWizardField ? fields.find(field => field._key === ticketWizardField) ?? null : null
  const matrixField = ticketMatrixConfigField ? fields.find(field => field._key === ticketMatrixConfigField) ?? null : null
  let matrixConfig: MatrixConfig | null = null
  if (matrixField) {
    try {
      if (matrixField.options.length > 0 && matrixField.options[0]?.startsWith('{')) {
        matrixConfig = JSON.parse(matrixField.options[0]) as MatrixConfig
      }
    } catch {
      matrixConfig = null
    }
  }

  if (loading) {
    return <div className="text-sm text-[#64748B]">Loading ticket templates…</div>
  }

  return (
    <>
      {wizardField && (
        <TableWizardModal
          columns={wizardField.tableColumns}
          onSave={columns => {
            updateField(wizardField._key, { tableColumns: columns })
            setTicketWizardField(null)
          }}
          onClose={() => setTicketWizardField(null)}
        />
      )}

      {matrixField && (
        <MatrixLikertConfigModal
          config={matrixConfig}
          onSave={config => {
            updateField(matrixField._key, { options: [JSON.stringify(config)] })
            setTicketMatrixConfigField(null)
          }}
          onClose={() => setTicketMatrixConfigField(null)}
        />
      )}

      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Forms</h1>
            <p className="text-sm text-[#64748B] mt-1">Create reusable ticket templates and assign them to collections from Add Ticket.</p>
          </div>
          <button
            type="button"
            onClick={handleCreateTemplate}
            className="inline-flex items-center gap-2 rounded bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
          >
            <Plus size={15} />
            New Ticket Template
          </button>
        </div>

        {(loadError || templateError || fieldError) && (
          <div className="rounded border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-3 text-red-700 dark:text-red-400 text-sm">
            {loadError ?? templateError ?? fieldError}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)] gap-5">
          <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-4 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">Templates</h2>
            <div className="space-y-2">
              {templates.length === 0 ? (
                <p className="text-sm text-[#64748B]">No ticket templates yet.</p>
              ) : (
                templates.map(template => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => setSelectedTemplateId(template.id)}
                    className={[
                      'w-full text-left rounded border px-3 py-2 transition-colors',
                      selectedTemplateId === template.id
                        ? 'border-[#2563EB] bg-blue-50 dark:bg-blue-900/20 text-[#2563EB]'
                        : 'border-[#E2E8F0] dark:border-[#334155] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] text-[#1E293B] dark:text-[#F1F5F9]',
                    ].join(' ')}
                  >
                    <div className="text-sm font-semibold">{template.title}</div>
                    <div className="mt-1 text-xs text-[#64748B]">{template.fieldCount} fields · {template.assignmentCount} assignments</div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="space-y-5">
            {selectedTemplate ? (
              <>
                <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-5 space-y-4">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">Template Details</h2>
                    <button
                      type="button"
                      onClick={handleSaveTemplate}
                      disabled={savingTemplate}
                      className="inline-flex items-center gap-2 rounded bg-[#0F766E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#115E59] disabled:opacity-50"
                    >
                      <Save size={14} />
                      {savingTemplate ? 'Saving…' : 'Save Template'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className={LABEL}>Title</label>
                      <input value={title} onChange={event => setTitle(event.target.value)} className={INPUT} />
                    </div>
                    <div>
                      <label className={LABEL}>Description</label>
                      <input value={description} onChange={event => setDescription(event.target.value)} className={INPUT} />
                    </div>
                  </div>
                </div>

                <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-5 space-y-4">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">Ticket Fields</h2>
                    <button
                      type="button"
                      onClick={() => setFields(prev => [...prev, blankField(activePage)])}
                      className="flex items-center gap-1 text-xs text-[#2563EB] hover:underline"
                    >
                      <Plus size={13} />
                      Add field
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {pages.map(page => (
                      <button
                        key={page}
                        type="button"
                        onClick={() => setActivePage(page)}
                        className={[
                          'px-3 py-2 text-sm font-semibold border-b-2 transition-colors rounded-t',
                          activePage === page
                            ? 'border-[#2563EB] text-[#2563EB] bg-blue-50 dark:bg-blue-900/20'
                            : 'border-transparent text-[#64748B] hover:text-[#2563EB] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]',
                        ].join(' ')}
                      >
                        Page {page}
                      </button>
                    ))}
                  </div>

                  <div className="space-y-3">
                    {visibleFields.map((field, index) => (
                      <FieldCard
                        key={field._key}
                        field={field}
                        index={index}
                        total={visibleFields.length}
                        onUpdate={patch => updateField(field._key, patch)}
                        onRemove={() => removeField(field._key)}
                        onMoveUp={() => moveField(field._key, -1)}
                        onMoveDown={() => moveField(field._key, 1)}
                        onAddOption={() => addOption(field._key)}
                        onAddOtherOption={() => addOtherOption(field._key)}
                        onRemoveOtherOption={() => removeOtherOption(field._key)}
                        onUpdateOption={(optionIndex, value) => updateOption(field._key, optionIndex, value)}
                        onRemoveOption={optionIndex => removeOption(field._key, optionIndex)}
                        onConfigureTable={() => setTicketWizardField(field._key)}
                        onConfigureMatrix={() => setTicketMatrixConfigField(field._key)}
                      />
                    ))}
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleSaveFields}
                      disabled={savingFields}
                      className="inline-flex items-center gap-2 rounded bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                    >
                      <Save size={14} />
                      {savingFields ? 'Saving…' : 'Save Fields'}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-8 text-center text-[#64748B] text-sm">
                Create or select a ticket template to begin designing fields.
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}