import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Download,
  FileSpreadsheet,
  Loader2,
  Save,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { getCollection } from '../api/collections'
import {
  getExportCsvSchema,
  exportCollectionCsv,
  listExportCsvPresets,
  saveExportCsvPreset,
  deleteExportCsvPreset,
} from '../api/exportCsv'
import { useToast } from '../contexts/ToastContext'
import type { Collection, ExportCsvColumn, ExportCsvPreset, ExportCsvSchema } from '../types'

interface PanelState {
  allChecked: boolean
  selected: Set<string>
}

export default function ExportCsvPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { showToast } = useToast()

  const [collection, setCollection] = useState<Collection | null>(null)
  const [schema, setSchema] = useState<ExportCsvSchema | null>(null)
  const [presets, setPresets] = useState<ExportCsvPreset[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const [submissionPanel, setSubmissionPanel] = useState<PanelState>({ allChecked: true, selected: new Set() })
  const [ticketTemplateId, setTicketTemplateId] = useState<number | null>(null)
  const [ticketPanel, setTicketPanel] = useState<PanelState>({ allChecked: true, selected: new Set() })
  const [submissionExpanded, setSubmissionExpanded] = useState(true)
  const [ticketExpanded, setTicketExpanded] = useState(true)
  const [presetsExpanded, setPresetsExpanded] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [savingPreset, setSavingPreset] = useState(false)

  const collectionId = useMemo(() => {
    if (!id) return null
    const parsed = parseInt(id, 10)
    return isNaN(parsed) ? null : parsed
  }, [id])

  useEffect(() => {
    if (!collectionId) return
    let active = true
    setLoading(true)
    Promise.all([
      getCollection(collectionId),
      getExportCsvSchema(collectionId),
    ])
      .then(([col, sch]) => {
        if (!active) return
        setCollection(col)
        setSchema(sch)
        setSubmissionPanel({ allChecked: true, selected: new Set(sch.submissionColumns.map(c => c.key)) })
        const defaultTemplate = sch.ticketTemplates[0] ?? null
        setTicketTemplateId(defaultTemplate?.templateId ?? null)
        if (defaultTemplate) {
          setTicketPanel({ allChecked: true, selected: new Set(defaultTemplate.columns.map(c => c.key)) })
        }
        // Load presets independently — failure here should not block the main page
        listExportCsvPresets(collectionId)
          .then(saved => { if (active) setPresets(saved) })
          .catch(() => { /* presets unavailable — not critical */ })
      })
      .catch(err => {
        if (!active) return
        showToast(err instanceof Error ? err.message : 'Failed to load export page', 'error')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [collectionId, showToast])

  const selectedTemplate = useMemo(() => {
    return schema?.ticketTemplates.find(t => t.templateId === ticketTemplateId) ?? null
  }, [schema, ticketTemplateId])

  const availableTicketTemplates = useMemo(() => schema?.ticketTemplates ?? [], [schema])

  useEffect(() => {
    if (selectedTemplate) {
      setTicketPanel(prev => {
        const validKeys = new Set(selectedTemplate.columns.map(c => c.key))
        const nextSelected = new Set([...prev.selected].filter(k => validKeys.has(k)))
        if (prev.allChecked && nextSelected.size === validKeys.size) {
          return { allChecked: true, selected: new Set(validKeys) }
        }
        if (nextSelected.size === 0) {
          return { allChecked: false, selected: new Set() }
        }
        return { allChecked: false, selected: nextSelected }
      })
    } else {
      setTicketPanel({ allChecked: false, selected: new Set() })
    }
  }, [selectedTemplate])

  const submissionColumns = useMemo(() => schema?.submissionColumns ?? [], [schema])
  const ticketColumns = useMemo(() => selectedTemplate?.columns ?? [], [selectedTemplate])

  const selectedSubmissionKeys = useMemo(() => {
    if (submissionPanel.allChecked) return submissionColumns.map(c => c.key)
    return submissionColumns.map(c => c.key).filter(k => submissionPanel.selected.has(k))
  }, [submissionPanel, submissionColumns])

  const selectedTicketKeys = useMemo(() => {
    if (ticketPanel.allChecked) return ticketColumns.map(c => c.key)
    return ticketColumns.map(c => c.key).filter(k => ticketPanel.selected.has(k))
  }, [ticketPanel, ticketColumns])

  const canExport = selectedSubmissionKeys.length > 0 && (ticketTemplateId === null || selectedTicketKeys.length > 0)

  function toggleAllSubmission(checked: boolean) {
    setSubmissionPanel({
      allChecked: checked,
      selected: checked ? new Set(submissionColumns.map(c => c.key)) : new Set(),
    })
  }

  function toggleSubmissionKey(key: string, checked: boolean) {
    setSubmissionPanel(prev => {
      const next = new Set(prev.selected)
      if (checked) next.add(key)
      else next.delete(key)
      const allKeys = submissionColumns.map(c => c.key)
      const allChecked = allKeys.length > 0 && allKeys.every(k => next.has(k))
      return { allChecked, selected: allChecked ? new Set(allKeys) : next }
    })
  }

  function toggleAllTicket(checked: boolean) {
    setTicketPanel({
      allChecked: checked,
      selected: checked ? new Set(ticketColumns.map(c => c.key)) : new Set(),
    })
  }

  function toggleTicketKey(key: string, checked: boolean) {
    setTicketPanel(prev => {
      const next = new Set(prev.selected)
      if (checked) next.add(key)
      else next.delete(key)
      const allKeys = ticketColumns.map(c => c.key)
      const allChecked = allKeys.length > 0 && allKeys.every(k => next.has(k))
      return { allChecked, selected: allChecked ? new Set(allKeys) : next }
    })
  }

  async function handleExport() {
    if (!collectionId || !canExport) return
    setExporting(true)
    try {
      const blob = await exportCollectionCsv(collectionId, {
        submissionColumnKeys: selectedSubmissionKeys,
        ticketTemplateId,
        ticketColumnKeys: selectedTicketKeys,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${toSafeFilename(collection?.title ?? 'export')}-export.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      showToast('CSV exported successfully', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Export failed', 'error')
    } finally {
      setExporting(false)
    }
  }

  async function handleSavePreset() {
    if (!collectionId) return
    setSavingPreset(true)
    try {
      const saved = await saveExportCsvPreset({
        collectionId,
        name: presetName.trim() || undefined,
        allSubmissionColumns: submissionPanel.allChecked,
        submissionColumns: selectedSubmissionKeys,
        ticketTemplateId,
        allTicketColumns: ticketPanel.allChecked,
        ticketColumns: selectedTicketKeys,
      })
      setPresets(prev => [...prev, saved].sort((a, b) => a.name.localeCompare(b.name)))
      setPresetName('')
      showToast('Preset saved', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save preset', 'error')
    } finally {
      setSavingPreset(false)
    }
  }

  async function handleDeletePreset(presetId: number) {
    if (!confirm('Delete this saved preset?')) return
    try {
      await deleteExportCsvPreset(presetId)
      setPresets(prev => prev.filter(p => p.id !== presetId))
      showToast('Preset deleted', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete preset', 'error')
    }
  }

  function applyPreset(preset: ExportCsvPreset) {
    setSubmissionPanel({
      allChecked: preset.allSubmissionColumns,
      selected: new Set(preset.submissionColumns),
    })
    if (preset.ticketTemplateId) {
      const template = schema?.ticketTemplates.find(t => t.templateId === preset.ticketTemplateId)
      if (template) {
        setTicketTemplateId(template.templateId)
        setTicketPanel({
          allChecked: preset.allTicketColumns,
          selected: new Set(preset.ticketColumns),
        })
      }
    } else {
      setTicketTemplateId(null)
      setTicketPanel({ allChecked: false, selected: new Set() })
    }
    showToast('Preset applied', 'success')
  }

  function renderColumnCheckbox(column: ExportCsvColumn, checked: boolean, onChange: (checked: boolean) => void) {
    return (
      <label
        key={column.key}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
      >
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
        />
        <span className="text-sm text-gray-700 dark:text-gray-200">{column.label}</span>
      </label>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    )
  }

  if (!collection || !schema) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-center text-gray-600 dark:text-gray-400">Collection not found.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <button
        onClick={() => navigate('/records')}
        className="mb-4 inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Records
      </button>

      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <FileSpreadsheet className="h-6 w-6 text-indigo-600" />
            Export CSV
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {collection.title}
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={!canExport || exporting}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Download CSV
        </button>
      </div>

      {/* Presets */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
        <button
          onClick={() => setPresetsExpanded(v => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left font-medium text-gray-900 dark:text-white"
        >
          Saved Presets
          {presetsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {presetsExpanded && (
          <div className="border-t border-gray-200 px-4 py-4 dark:border-gray-700">
            {presets.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No saved presets yet.</p>
            ) : (
              <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {presets.map(preset => (
                  <div
                    key={preset.id}
                    className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800"
                  >
                    <button
                      onClick={() => applyPreset(preset)}
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                    >
                      {preset.name}
                    </button>
                    <button
                      onClick={() => handleDeletePreset(preset.id)}
                      className="text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                      title="Delete preset"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Save current selection as preset
                </label>
                <input
                  type="text"
                  value={presetName}
                  onChange={e => setPresetName(e.target.value)}
                  placeholder="Preset name (optional)"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
              </div>
              <button
                onClick={handleSavePreset}
                disabled={savingPreset}
                className="inline-flex items-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-gray-700 dark:hover:bg-gray-600"
              >
                {savingPreset ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Preset
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Submission columns */}
        <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          <button
            onClick={() => setSubmissionExpanded(v => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <span className="font-medium text-gray-900 dark:text-white">Submission Columns</span>
            {submissionExpanded ? <ChevronUp className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
          </button>
          {submissionExpanded && (
            <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
              <label className="mb-3 flex items-center gap-2 rounded-md bg-indigo-50 px-2 py-2 dark:bg-indigo-900/20">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  checked={submissionPanel.allChecked}
                  onChange={e => toggleAllSubmission(e.target.checked)}
                />
                <span className="text-sm font-medium text-indigo-900 dark:text-indigo-200">All Submission Columns</span>
              </label>
              <div className="grid gap-1 sm:grid-cols-2">
                {submissionColumns.map(column =>
                  renderColumnCheckbox(
                    column,
                    submissionPanel.allChecked || submissionPanel.selected.has(column.key),
                    checked => toggleSubmissionKey(column.key, checked)
                  )
                )}
              </div>
            </div>
          )}
        </div>

        {/* Ticket columns */}
        <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          <button
            onClick={() => setTicketExpanded(v => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <span className="font-medium text-gray-900 dark:text-white">Ticket Columns</span>
            {ticketExpanded ? <ChevronUp className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
          </button>
          {ticketExpanded && (
            <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Ticket template
                </label>
                <select
                  value={ticketTemplateId ?? ''}
                  onChange={e => {
                    const value = e.target.value
                    setTicketTemplateId(value ? parseInt(value, 10) : null)
                  }}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                >
                  {availableTicketTemplates.length === 0 && <option value="">No ticket templates</option>}
                  {availableTicketTemplates.map(t => (
                    <option key={t.templateId} value={t.templateId}>{t.title}</option>
                  ))}
                </select>
              </div>

              {selectedTemplate && (
                <>
                  <label className="mb-3 flex items-center gap-2 rounded-md bg-indigo-50 px-2 py-2 dark:bg-indigo-900/20">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      checked={ticketPanel.allChecked}
                      onChange={e => toggleAllTicket(e.target.checked)}
                    />
                    <span className="text-sm font-medium text-indigo-900 dark:text-indigo-200">All Ticket Columns</span>
                  </label>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {ticketColumns.map(column =>
                      renderColumnCheckbox(
                        column,
                        ticketPanel.allChecked || ticketPanel.selected.has(column.key),
                        checked => toggleTicketKey(column.key, checked)
                      )
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Preview */}
      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">Selected columns</h2>
        <div className="flex flex-wrap gap-2">
          {selectedSubmissionKeys.length === 0 && selectedTicketKeys.length === 0 && (
            <span className="text-sm text-gray-500 dark:text-gray-400">No columns selected.</span>
          )}
          {selectedSubmissionKeys.map(key => {
            const label = submissionColumns.find(c => c.key === key)?.label ?? key
            return <Badge key={key} label={label} color="indigo" />
          })}
          {selectedTicketKeys.map(key => {
            const label = ticketColumns.find(c => c.key === key)?.label ?? key
            return <Badge key={key} label={label} color="emerald" />
          })}
        </div>
      </div>
    </div>
  )
}

function Badge({ label, color }: { label: string; color: 'indigo' | 'emerald' }) {
  const colorClasses = color === 'indigo'
    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colorClasses}`}>
      {label}
    </span>
  )
}

function toSafeFilename(title: string): string {
  return (title.trim() || 'export')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'export'
}
