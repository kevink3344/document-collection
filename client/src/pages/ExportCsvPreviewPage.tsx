import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, FileSpreadsheet, Loader2 } from 'lucide-react'
import { getCollection } from '../api/collections'
import { getExportCsvSchema, previewExportCsv } from '../api/exportCsv'
import { useToast } from '../contexts/ToastContext'
import type { Collection, ExportCsvPreviewResponse, ExportCsvSchema } from '../types'

function parseSelectionList(raw: string | null): string[] {
  if (!raw) return []
  return raw.split(',').map(value => value.trim()).filter(Boolean)
}

function parseOptionalNumber(raw: string | null): number | null {
  if (!raw) return null
  const parsed = parseInt(raw, 10)
  return Number.isNaN(parsed) ? null : parsed
}

function selectionSummary(schema: ExportCsvSchema | null, submissionKeys: string[], ticketTemplateId: number | null, ticketKeys: string[]) {
  const submissionLabels = schema?.submissionColumns
    .filter(column => submissionKeys.includes(column.key))
    .map(column => column.label) ?? []
  const ticketTemplate = schema?.ticketTemplates.find(template => template.templateId === ticketTemplateId) ?? null
  const ticketLabels = ticketTemplate?.columns
    .filter(column => ticketKeys.includes(column.key))
    .map(column => column.label) ?? []
  return { submissionLabels, ticketTemplate, ticketLabels }
}

export default function ExportCsvPreviewPage() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { showToast } = useToast()

  const collectionId = useMemo(() => {
    if (!id) return null
    const parsed = parseInt(id, 10)
    return Number.isNaN(parsed) ? null : parsed
  }, [id])

  const previewSelection = useMemo(() => {
    const searchParams = new URLSearchParams(location.search)
    const submissionColumnKeys = parseSelectionList(searchParams.get('submission') ?? searchParams.get('submissionColumnKeys'))
    const ticketColumnKeys = parseSelectionList(searchParams.get('ticket') ?? searchParams.get('ticketColumnKeys'))
    const ticketTemplateId = parseOptionalNumber(searchParams.get('ticketTemplateId'))
    return { submissionColumnKeys, ticketColumnKeys, ticketTemplateId }
  }, [location.search])

  const [collection, setCollection] = useState<Collection | null>(null)
  const [schema, setSchema] = useState<ExportCsvSchema | null>(null)
  const [preview, setPreview] = useState<ExportCsvPreviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!collectionId) {
      setError('Invalid collection.')
      setLoading(false)
      return
    }

    if (previewSelection.submissionColumnKeys.length === 0) {
      setError('No submission columns were provided for preview.')
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    setError(null)

    Promise.all([
      getCollection(collectionId),
      getExportCsvSchema(collectionId),
      previewExportCsv(collectionId, {
        submissionColumnKeys: previewSelection.submissionColumnKeys,
        ticketTemplateId: previewSelection.ticketTemplateId,
        ticketColumnKeys: previewSelection.ticketColumnKeys,
      }),
    ])
      .then(([collectionData, schemaData, previewData]) => {
        if (!active) return
        setCollection(collectionData)
        setSchema(schemaData)
        setPreview(previewData)
      })
      .catch(err => {
        if (!active) return
        const message = err instanceof Error ? err.message : 'Failed to load preview'
        setError(message)
        showToast(message, 'error')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => { active = false }
  }, [collectionId, previewSelection.submissionColumnKeys, previewSelection.ticketColumnKeys, previewSelection.ticketTemplateId, showToast])

  const summary = useMemo(() => {
    return selectionSummary(
      schema,
      previewSelection.submissionColumnKeys,
      previewSelection.ticketTemplateId,
      previewSelection.ticketColumnKeys
    )
  }, [schema, previewSelection])

  const backUrl = collectionId ? `/records/${collectionId}/export-csv${location.search}` : '/records'

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <button
          onClick={() => navigate(backUrl)}
          className="mb-4 inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Export CSV
        </button>
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      </div>
    )
  }

  if (!collection || !schema || !preview) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <p className="text-center text-gray-600 dark:text-gray-400">Preview not available.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <button
        onClick={() => navigate(backUrl)}
        className="mb-4 inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Export CSV
      </button>

      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white">
            <FileSpreadsheet className="h-6 w-6 text-indigo-600" />
            CSV Preview
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{collection.title}</p>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Previewing the same data that will be exported. Limited to the first 100 rows.
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
          <div>{preview.rowCount} total row{preview.rowCount === 1 ? '' : 's'}</div>
          {preview.truncated && <div className="mt-1 text-amber-600 dark:text-amber-400">Preview truncated to 100 rows</div>}
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Submission Columns</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {summary.submissionLabels.length > 0 ? summary.submissionLabels.map((label, index) => (
                  <span key={`${label}-${index}`} className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                    {label}
                  </span>
                )) : <span className="text-sm text-gray-500 dark:text-gray-400">None selected</span>}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Ticket Columns</p>
              {summary.ticketTemplate ? (
                <>
                  <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">Template: {summary.ticketTemplate.title}</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {summary.ticketLabels.length > 0 ? summary.ticketLabels.map((label, index) => (
                      <span key={`${label}-${index}`} className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                        {label}
                      </span>
                    )) : <span className="text-sm text-gray-500 dark:text-gray-400">No ticket columns selected</span>}
                  </div>
                </>
              ) : (
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">No ticket template selected</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
        <div className="overflow-auto">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800">
              <tr>
                {preview.headers.map(header => (
                  <th
                    key={header}
                    className="border-b border-gray-200 px-4 py-3 text-left font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.length === 0 ? (
                <tr>
                  <td colSpan={preview.headers.length} className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">
                    No rows matched the current preview selection.
                  </td>
                </tr>
              ) : (
                preview.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="odd:bg-white even:bg-gray-50 dark:odd:bg-gray-900 dark:even:bg-gray-800">
                    {row.map((cell, cellIndex) => (
                      <td
                        key={`${rowIndex}-${cellIndex}`}
                        className="border-b border-gray-100 px-4 py-3 align-top text-gray-700 whitespace-pre-wrap break-words dark:border-gray-800 dark:text-gray-200"
                      >
                        {cell || <span className="text-gray-400">—</span>}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}