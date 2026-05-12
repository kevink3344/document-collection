import { useEffect, useMemo, useState } from 'react'
import { Calendar, ClipboardList, Mail, Tag, User, Download } from 'lucide-react'
import { getCollection, getResponses, listCollections } from '../api/collections'
import { getCategoryColorClasses } from '../utils/categoryColors'
import type { Collection, CollectionField, CollectionResponse } from '../types'

type RecordsView = 'summary' | 'individual'

interface SummaryDatum {
  label: string
  count: number
  color: string
}

type SummaryFieldType = Extract<
  CollectionField['type'],
  'single_choice' | 'multiple_choice' | 'confirmation' | 'signature' | 'attachment'
>

interface SummaryCard {
  fieldId: number
  label: string
  fieldType: SummaryFieldType
  total: number
  totalLabel: string
  data: SummaryDatum[]
}

interface TableSummaryCard {
  fieldId: number
  label: string
  columns: string[]
  rows: Array<Record<string, string>>
}

const SURVEY_ID_COLUMN = 'Survey Id'
const OTHER_OPTION_MARKER = '__DCP_OTHER_OPTION__'

const CHART_COLORS = ['#2563EB', '#0F766E', '#D97706', '#DC2626', '#7C3AED', '#0891B2']

function formatSubmittedAt(value: string): string {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T') + 'Z'
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatFieldType(type: CollectionField['type']): string {
  switch (type) {
    case 'date':
      return 'Date'
    case 'single_choice':
      return 'Single choice'
    case 'multiple_choice':
      return 'Multiple choice'
    case 'confirmation':
      return 'Confirmation'
    case 'signature':
      return 'Signature'
    case 'attachment':
      return 'Attachment'
    case 'custom_table':
      return 'Custom table'
    case 'short_text':
      return 'Short text'
    case 'long_text':
      return 'Long text'
    default:
      return type
  }
}

function hasMeaningfulValue(value: string | null | undefined): boolean {
  return Boolean(value && value.trim() !== '')
}

function buildConicGradient(data: SummaryDatum[]): string {
  const total = data.reduce((sum, item) => sum + item.count, 0)
  if (total === 0) {
    return 'conic-gradient(#E2E8F0 0deg 360deg)'
  }

  let current = 0
  const segments = data
    .filter(item => item.count > 0)
    .map(item => {
      const start = current
      const sweep = (item.count / total) * 360
      current += sweep
      return `${item.color} ${start}deg ${current}deg`
    })

  if (segments.length === 0) {
    return 'conic-gradient(#E2E8F0 0deg 360deg)'
  }

  return `conic-gradient(${segments.join(', ')})`
}

function formatSummaryLabel(label: string): string {
  return label === OTHER_OPTION_MARKER ? 'Other' : label
}

function SummaryBarChart({ data }: { data: SummaryDatum[] }) {
  const max = Math.max(...data.map(item => item.count), 1)

  return (
    <div className="rounded border border-[#E2E8F0] dark:border-[#334155] p-4 h-full flex flex-col">
      <div className="h-64 flex items-end gap-2 sm:gap-4 border-l border-b border-[#CBD5E1] dark:border-[#475569] px-3 sm:px-4 pb-4 pt-4">
        {data.map(item => (
          <div key={item.label} className="flex-1 min-w-0 flex flex-col items-center justify-end gap-2 h-full">
            <span className="text-xs text-[#64748B]">{item.count}</span>
            <div
              className="w-full max-w-[160px] rounded-t"
              style={{
                height: `${Math.max((item.count / max) * 180, item.count > 0 ? 12 : 2)}px`,
                backgroundColor: item.color,
              }}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 pt-4">
        {data.map(item => (
          <div
            key={`${item.label}-legend`}
            className="inline-flex items-start gap-2 text-sm text-[#1E293B] dark:text-[#F1F5F9]"
          >
            <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="leading-tight break-words">
              {formatSummaryLabel(item.label)} - {item.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SummaryDonutChart({ data, totalLabel }: { data: SummaryDatum[]; totalLabel: string }) {
  const total = data.reduce((sum, item) => sum + item.count, 0)

  return (
    <div className="rounded border border-[#E2E8F0] dark:border-[#334155] p-4 h-full flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
        <div
          className="relative h-44 w-44 rounded-full shrink-0"
          style={{ background: buildConicGradient(data) }}
        >
          <div className="absolute inset-[28px] rounded-full bg-white dark:bg-[#1E293B] flex items-center justify-center text-center px-2">
            <div>
              <p className="text-2xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">{total}</p>
              <p className="text-xs text-[#64748B] uppercase tracking-wide">{totalLabel}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 pt-2">
        {data.map(item => (
          <div
            key={item.label}
            className="inline-flex items-start gap-2 text-sm text-[#1E293B] dark:text-[#F1F5F9]"
          >
            <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="leading-tight break-words">
              {formatSummaryLabel(item.label)} - {item.count} {totalLabel}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface TrendlineDataPoint {
  date: string
  count: number
}

function buildSubmissionTrendline(responses: CollectionResponse[]): TrendlineDataPoint[] {
  const countByDate = new Map<string, number>()

  responses.forEach(response => {
    const normalized = response.submittedAt.includes('T')
      ? response.submittedAt
      : response.submittedAt.replace(' ', 'T') + 'Z'
    const date = new Date(normalized)

    if (!Number.isNaN(date.getTime())) {
      const [dateStr] = date.toISOString().split('T')
      if (dateStr) {
        countByDate.set(dateStr, (countByDate.get(dateStr) ?? 0) + 1)
      }
    }
  })

  const sorted = Array.from(countByDate.entries())
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, count]) => ({ date, count }))

  return sorted
}

function TrendlineChart({ responses }: { responses: CollectionResponse[] }) {
  const data = buildSubmissionTrendline(responses)

  if (data.length === 0) {
    return (
      <div className="rounded border border-[#E2E8F0] dark:border-[#334155] p-4 bg-[#F8FAFC] dark:bg-[#0F172A] h-64 flex items-center justify-center">
        <p className="text-sm text-[#64748B]">No submission data available.</p>
      </div>
    )
  }

  const maxCount = Math.max(...data.map(p => p.count))
  const padding = 40
  const chartWidth = 800
  const chartHeight = 280
  const graphWidth = chartWidth - 2 * padding
  const graphHeight = chartHeight - 2 * padding

  const points: Array<{ x: number; y: number; date: string; count: number }> = []
  data.forEach((point, index) => {
    const x = padding + (index / (data.length - 1 || 1)) * graphWidth
    const y = chartHeight - padding - (point.count / maxCount) * graphHeight
    points.push({ x, y, date: point.date, count: point.count })
  })

  const pathD =
    points.length > 0
      ? `M ${points.map(p => `${p.x} ${p.y}`).join(' L ')}`
      : ''

  return (
    <div className="rounded border border-[#E2E8F0] dark:border-[#334155] p-4">
      <h3 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9] mb-4">Submission Trendline</h3>
      <div className="overflow-x-auto">
        <svg
          width={chartWidth}
          height={chartHeight}
          className="mx-auto"
          style={{ minWidth: '100%', height: 'auto' }}
        >
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((fraction, i) => {
            const y = chartHeight - padding - fraction * graphHeight
            return (
              <line
                key={`grid-${i}`}
                x1={padding}
                y1={y}
                x2={chartWidth - padding}
                y2={y}
                stroke="#E2E8F0"
                strokeDasharray="4,2"
                strokeWidth="0.5"
              />
            )
          })}

          {/* Y-axis */}
          <line
            x1={padding}
            y1={padding}
            x2={padding}
            y2={chartHeight - padding}
            stroke="#CBD5E1"
            strokeWidth="1"
          />

          {/* X-axis */}
          <line
            x1={padding}
            y1={chartHeight - padding}
            x2={chartWidth - padding}
            y2={chartHeight - padding}
            stroke="#CBD5E1"
            strokeWidth="1"
          />

          {/* Y-axis labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((fraction, i) => {
            const y = chartHeight - padding - fraction * graphHeight
            const label = Math.round(fraction * maxCount)
            return (
              <text
                key={`y-label-${i}`}
                x={padding - 8}
                y={y + 4}
                fontSize="12"
                textAnchor="end"
                fill="#64748B"
              >
                {label}
              </text>
            )
          })}

          {/* Line path */}
          {pathD && (
            <path
              d={pathD}
              stroke="#2563EB"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Data points */}
          {points.map((p, i) => (
            <circle
              key={`point-${i}`}
              cx={p.x}
              cy={p.y}
              r="4"
              fill="#2563EB"
            />
          ))}

          {/* X-axis labels (every 2nd or 3rd to avoid crowding) */}
          {points.map((p, i) => {
            const showLabel = data.length <= 7 || i % Math.ceil(data.length / 7) === 0 || i === data.length - 1
            if (!showLabel) return null
            const dateObj = new Date(p.date + 'T00:00:00Z')
            const dateStr = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' })
            return (
              <text
                key={`x-label-${i}`}
                x={p.x}
                y={chartHeight - padding + 20}
                fontSize="12"
                textAnchor="middle"
                fill="#64748B"
              >
                {dateStr}
              </text>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

function renderResponseValue(field: CollectionField | undefined, value: string | null) {
  const raw = value ?? ''
  if (!raw) {
    return <p className="text-sm text-[#94A3B8]">No value submitted</p>
  }

  if (field?.type === 'multiple_choice') {
    try {
      const items = JSON.parse(raw) as string[]
      if (Array.isArray(items) && items.length > 0) {
        return <p className="text-sm text-[#1E293B] dark:text-[#F1F5F9]">{items.join(', ')}</p>
      }
    } catch {
      // Fall through to raw rendering.
    }
  }

  if (field?.type === 'confirmation') {
    return (
      <p className="text-sm text-[#1E293B] dark:text-[#F1F5F9]">
        {raw === 'true' ? 'Confirmed' : 'Not confirmed'}
      </p>
    )
  }

  if (field?.type === 'custom_table') {
    try {
      const rows = JSON.parse(raw) as Array<Record<string, string>>
      const columns = field.tableColumns ?? []
      if (Array.isArray(rows) && rows.length > 0 && columns.length > 0) {
        return (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  {columns.map(column => (
                    <th
                      key={column.name}
                      className="text-left text-xs font-medium text-[#64748B] border border-[#E2E8F0] dark:border-[#334155] px-2 py-1.5 bg-[#F8FAFC] dark:bg-[#0F172A]"
                    >
                      {column.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {columns.map(column => (
                      <td
                        key={column.name}
                        className="border border-[#E2E8F0] dark:border-[#334155] px-2 py-1.5 text-[#1E293B] dark:text-[#F1F5F9]"
                      >
                        {row[column.name] || '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    } catch {
      // Fall through to raw rendering.
    }
  }

  const isUrlLike = raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:')
  const isImageLike = raw.startsWith('data:image/') || /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(raw)

  if (field?.type === 'signature' && isUrlLike && isImageLike) {
    return (
      <div className="space-y-2">
        <img
          src={raw}
          alt="Submitted signature"
          className="max-h-40 w-auto border border-[#CBD5E1] dark:border-[#334155] bg-white rounded"
        />
        <a
          href={raw}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-[#2563EB] hover:underline"
        >
          Open full image
        </a>
      </div>
    )
  }

  if (isUrlLike) {
    return (
      <a
        href={raw}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-[#2563EB] hover:underline break-all"
      >
        Open submitted file
      </a>
    )
  }

  return <p className="text-sm text-[#1E293B] dark:text-[#F1F5F9] whitespace-pre-wrap">{raw}</p>
}

function toCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function toCsv(table: TableSummaryCard): string {
  const header = table.columns.map(toCsvCell).join(',')
  const lines = table.rows.map(row =>
    table.columns.map(col => toCsvCell(row[col] ?? '')).join(',')
  )
  return [header, ...lines].join('\n')
}

function downloadCsv(table: TableSummaryCard): void {
  const filenameBase = table.label.trim() || `table-${table.fieldId}`
  const safeFilename = filenameBase
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `table-${table.fieldId}`
  const blob = new Blob([toCsv(table)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeFilename}-entries.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export default function RecordsPage() {
  const [collections, setCollections] = useState<Collection[]>([])
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(null)
  const [selectedCollection, setSelectedCollection] = useState<Collection | null>(null)
  const [responses, setResponses] = useState<CollectionResponse[]>([])
  const [view, setView] = useState<RecordsView>('summary')
  const [loadingCollections, setLoadingCollections] = useState(true)
  const [loadingResponses, setLoadingResponses] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listCollections()
      .then(items => {
        setCollections(items)
        const firstWithResponses = items.find(item => (item.responseCount ?? 0) > 0)
        setSelectedCollectionId(firstWithResponses?.id ?? items[0]?.id ?? null)
      })
      .catch(err => setError((err as Error).message))
      .finally(() => setLoadingCollections(false))
  }, [])

  useEffect(() => {
    if (selectedCollectionId === null) {
      setSelectedCollection(null)
      setResponses([])
      return
    }

    setLoadingResponses(true)
    setError(null)

    Promise.all([
      getCollection(selectedCollectionId),
      getResponses(selectedCollectionId),
    ])
      .then(([collection, responseItems]) => {
        setSelectedCollection(collection)
        setResponses(responseItems)
      })
      .catch(err => setError((err as Error).message))
      .finally(() => setLoadingResponses(false))
  }, [selectedCollectionId])

  const collectionsWithResponses = useMemo(
    () => collections.filter(item => (item.responseCount ?? 0) > 0),
    [collections]
  )

  const fieldMap = useMemo(() => {
    const map = new Map<number, CollectionField>()
    selectedCollection?.fields.forEach(field => {
      if (field.id !== undefined) {
        map.set(field.id, field)
      }
    })
    return map
  }, [selectedCollection])

  const summaryCards = useMemo((): SummaryCard[] => {
    if (!selectedCollection || responses.length === 0) return [] as SummaryCard[]

    const valuesByField = new Map<number, Map<number, string | null>>()
    responses.forEach(response => {
      response.values.forEach(answer => {
        const fieldValues = valuesByField.get(answer.fieldId) ?? new Map<number, string | null>()
        fieldValues.set(response.id, answer.value)
        valuesByField.set(answer.fieldId, fieldValues)
      })
    })

    return selectedCollection.fields
      .filter(field => field.id !== undefined)
      .map(field => {
        const fieldId = field.id as number
        const fieldValues = valuesByField.get(fieldId) ?? new Map<number, string | null>()

        switch (field.type) {
          case 'single_choice': {
            const counts = new Map<string, number>()
            ;(field.options ?? []).forEach(option => counts.set(option, 0))

            let answeredCount = 0
            responses.forEach(response => {
              const raw = fieldValues.get(response.id)
              if (hasMeaningfulValue(raw)) {
                answeredCount += 1
                counts.set(raw as string, (counts.get(raw as string) ?? 0) + 1)
              }
            })

            const data = Array.from(counts.entries()).map(([label, count], index) => ({
              label,
              count,
              color: CHART_COLORS[index % CHART_COLORS.length],
            }))

            const noResponseCount = responses.length - answeredCount
            if (noResponseCount > 0) {
              data.push({
                label: 'No response',
                count: noResponseCount,
                color: CHART_COLORS[data.length % CHART_COLORS.length],
              })
            }

            return data.some(item => item.count > 0)
              ? {
                  fieldId,
                  label: field.label,
                  fieldType: field.type,
                  total: responses.length,
                  totalLabel: 'entries',
                  data,
                }
              : null
          }

          case 'multiple_choice': {
            const counts = new Map<string, number>()
            ;(field.options ?? []).forEach(option => counts.set(option, 0))

            responses.forEach(response => {
              const raw = fieldValues.get(response.id)
              if (!hasMeaningfulValue(raw)) return
              try {
                const selections = JSON.parse(raw as string) as string[]
                if (!Array.isArray(selections)) return
                selections.forEach(selection => {
                  counts.set(selection, (counts.get(selection) ?? 0) + 1)
                })
              } catch {
                // Ignore malformed multi-choice values.
              }
            })

            const data = Array.from(counts.entries()).map(([label, count], index) => ({
              label,
              count,
              color: CHART_COLORS[index % CHART_COLORS.length],
            }))
            const totalSelections = data.reduce((sum, item) => sum + item.count, 0)

            return totalSelections > 0
              ? {
                  fieldId,
                  label: field.label,
                  fieldType: field.type,
                  total: totalSelections,
                  totalLabel: 'selections',
                  data,
                }
              : null
          }

          case 'confirmation': {
            let confirmed = 0
            responses.forEach(response => {
              if (fieldValues.get(response.id) === 'true') {
                confirmed += 1
              }
            })

            const data = [
              { label: 'Confirmed', count: confirmed, color: CHART_COLORS[0] },
              { label: 'Not confirmed', count: responses.length - confirmed, color: CHART_COLORS[1] },
            ]

            return {
              fieldId,
              label: field.label,
              fieldType: field.type,
              total: responses.length,
              totalLabel: 'entries',
              data,
            }
          }

          case 'signature': {
            let signed = 0
            responses.forEach(response => {
              if (hasMeaningfulValue(fieldValues.get(response.id))) {
                signed += 1
              }
            })

            return {
              fieldId,
              label: field.label,
              fieldType: field.type,
              total: responses.length,
              totalLabel: 'entries',
              data: [
                { label: 'Signed', count: signed, color: CHART_COLORS[0] },
                { label: 'Not signed', count: responses.length - signed, color: CHART_COLORS[1] },
              ],
            }
          }

          case 'attachment': {
            let attached = 0
            responses.forEach(response => {
              if (hasMeaningfulValue(fieldValues.get(response.id))) {
                attached += 1
              }
            })

            return {
              fieldId,
              label: field.label,
              fieldType: field.type,
              total: responses.length,
              totalLabel: 'entries',
              data: [
                { label: 'Attached', count: attached, color: CHART_COLORS[0] },
                { label: 'Not attached', count: responses.length - attached, color: CHART_COLORS[1] },
              ],
            }
          }

          default:
            return null
        }
      })
      .filter((card): card is SummaryCard => card !== null)
  }, [responses, selectedCollection])

  const tableSummaryCards = useMemo((): TableSummaryCard[] => {
    if (!selectedCollection || responses.length === 0) return []

    return selectedCollection.fields
      .filter(field => field.type === 'custom_table' && field.id !== undefined)
      .map(field => {
        const fieldId = field.id as number
        const tableColumns = (field.tableColumns ?? []).map(col => col.name)
        const columns = [SURVEY_ID_COLUMN, ...tableColumns]
        const rows: Array<Record<string, string>> = []

        responses.forEach(response => {
          const answer = response.values.find(v => v.fieldId === fieldId)
          if (!answer?.value) return
          try {
            const parsed = JSON.parse(answer.value) as Array<Record<string, unknown>>
            if (!Array.isArray(parsed)) return
            parsed.forEach(rawRow => {
              if (!rawRow || typeof rawRow !== 'object') return
              const normalized: Record<string, string> = {}
              normalized[SURVEY_ID_COLUMN] = String(response.id)
              tableColumns.forEach(column => {
                const value = rawRow[column]
                normalized[column] = value == null ? '' : String(value)
              })
              rows.push(normalized)
            })
          } catch {
            // Ignore malformed custom table payloads.
          }
        })

        return {
          fieldId,
          label: field.label,
          columns,
          rows,
        }
      })
  }, [responses, selectedCollection])

  if (loadingCollections) {
    return (
      <div className="flex items-center justify-center h-40 text-[#64748B]">
        Loading records…
      </div>
    )
  }

  if (error && collections.length === 0) {
    return (
      <div className="rounded border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4 text-red-700 dark:text-red-400 text-sm">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Records</h1>
          <p className="text-sm text-[#64748B] mt-0.5">
            Review submitted items by collection.
          </p>
        </div>

        <div className="w-full md:max-w-xs">
          <label className="block text-xs font-medium uppercase tracking-wide text-[#64748B] mb-1">
            Collection
          </label>
          <select
            value={selectedCollectionId ?? ''}
            onChange={e => setSelectedCollectionId(Number(e.target.value))}
            className="w-full border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0F172A] text-[#1E293B] dark:text-[#F1F5F9] px-3 py-2 text-sm rounded focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            disabled={collections.length === 0}
          >
            {collections.map(collection => (
              <option key={collection.id} value={collection.id}>
                {collection.title} ({collection.responseCount ?? 0})
              </option>
            ))}
          </select>
        </div>
      </div>

      {collections.length === 0 && (
        <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-8 text-center">
          <ClipboardList size={40} className="mx-auto mb-3 text-[#CBD5E1]" />
          <p className="text-sm text-[#64748B]">No collections available yet.</p>
        </div>
      )}

      {collections.length > 0 && collectionsWithResponses.length === 0 && !loadingResponses && (
        <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-8 text-center">
          <ClipboardList size={40} className="mx-auto mb-3 text-[#CBD5E1]" />
          <p className="text-sm text-[#64748B]">No submitted items yet.</p>
        </div>
      )}

      {selectedCollection && (
        <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
          <div className="border-l-4 border-[#2563EB] px-5 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              {selectedCollection.category && (() => {
                const colors = getCategoryColorClasses(selectedCollection.category)
                return (
                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-[2px] ${colors.badge}`}>
                    <Tag size={9} />
                    {selectedCollection.category}
                  </span>
                )
              })()}
              <h2 className="text-xl font-bold text-[#1E293B] dark:text-[#F1F5F9] tracking-tight flex items-center gap-1.5">
                {selectedCollection.title}
                {!selectedCollection.anonymous && (
                  <User size={15} className="shrink-0 text-[#2563EB] dark:text-white" aria-label="Authentication required" />
                )}
              </h2>
              <p className="text-sm text-[#64748B]">
                {responses.length} submitted item{responses.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="inline-flex rounded overflow-hidden border border-[#CBD5E1] dark:border-[#334155] w-fit">
              <button
                type="button"
                onClick={() => setView('summary')}
                className={[
                  'px-4 py-2 text-sm font-medium transition-colors',
                  view === 'summary'
                    ? 'bg-[#2563EB] text-white'
                    : 'bg-white dark:bg-[#1E293B] text-[#1E293B] dark:text-[#F1F5F9] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]',
                ].join(' ')}
              >
                Summary
              </button>
              <button
                type="button"
                onClick={() => setView('individual')}
                className={[
                  'px-4 py-2 text-sm font-medium transition-colors border-l border-[#CBD5E1] dark:border-[#334155]',
                  view === 'individual'
                    ? 'bg-[#2563EB] text-white'
                    : 'bg-white dark:bg-[#1E293B] text-[#1E293B] dark:text-[#F1F5F9] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]',
                ].join(' ')}
              >
                Individual
              </button>
            </div>
          </div>
          {error && (
            <div className="rounded border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-3 text-red-700 dark:text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>
      )}

      {loadingResponses && selectedCollectionId !== null && (
        <div className="flex items-center justify-center h-32 text-[#64748B]">
          Loading submitted items…
        </div>
      )}

      {!loadingResponses && selectedCollection && responses.length > 0 && view === 'summary' && (
        <div className="space-y-6">
          <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-5">
            <TrendlineChart responses={responses} />
          </section>

          {tableSummaryCards.map(table => (
            <section
              key={`table-summary-${table.fieldId}`}
              className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-5 space-y-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-xl text-[#1E293B] dark:text-[#F1F5F9]">{table.label}</h3>
                  <p className="text-sm uppercase tracking-wide text-[#64748B]">
                    Custom table
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="px-3 py-2 rounded bg-[#F8FAFC] dark:bg-[#0F172A] border border-[#E2E8F0] dark:border-[#334155] text-sm text-[#1E293B] dark:text-[#F1F5F9]">
                    Total Count: <span className="font-semibold">{table.rows.length}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadCsv(table)}
                    disabled={table.rows.length === 0}
                    className="inline-flex items-center gap-1.5 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-2 rounded transition-colors"
                  >
                    <Download size={14} />
                    Export CSV
                  </button>
                </div>
              </div>

              {table.columns.length <= 1 ? (
                <p className="text-sm text-[#64748B]">This table has no configured columns.</p>
              ) : table.rows.length === 0 ? (
                <p className="text-sm text-[#64748B]">No table rows submitted yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr>
                        {table.columns.map(column => (
                          <th
                            key={column}
                            className="text-left text-xs font-medium text-[#64748B] border border-[#E2E8F0] dark:border-[#334155] px-2 py-1.5 bg-[#F8FAFC] dark:bg-[#0F172A]"
                          >
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row, rowIndex) => (
                        <tr key={`${table.fieldId}-${rowIndex}`}>
                          {table.columns.map(column => (
                            <td
                              key={column}
                              className="border border-[#E2E8F0] dark:border-[#334155] px-2 py-1.5 text-[#1E293B] dark:text-[#F1F5F9]"
                            >
                              {row[column] || '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}

          {summaryCards.length === 0 ? (
            <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-8 text-center">
              <ClipboardList size={40} className="mx-auto mb-3 text-[#CBD5E1]" />
              <p className="text-sm text-[#64748B]">
                No chart summaries are available for this collection yet.
              </p>
            </div>
          ) : (
            summaryCards.map(card => (
              <section
                key={card.fieldId}
                className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-5 space-y-4"
              >
                <div>
                  <h3 className="text-xl text-[#1E293B] dark:text-[#F1F5F9]">{card.label}</h3>
                  <p className="text-sm uppercase tracking-wide text-[#64748B]">
                    {formatFieldType(card.fieldType)}
                  </p>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                  <SummaryBarChart data={card.data} />
                  <SummaryDonutChart data={card.data} totalLabel={card.totalLabel} />
                </div>
              </section>
            ))
          )}
        </div>
      )}

      {!loadingResponses && selectedCollection && responses.length > 0 && view === 'individual' && (
        <div className="space-y-4">
          {responses.map(response => (
            <section
              key={response.id}
              className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-5 space-y-4"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">
                    Submission #{response.id}
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#64748B]">
                    <span className="flex items-center gap-1">
                      <Calendar size={12} />
                      {formatSubmittedAt(response.submittedAt)}
                    </span>
                    <span className="flex items-center gap-1">
                      <User size={12} />
                      {response.respondentName || 'Anonymous'}
                    </span>
                    {response.respondentEmail && (
                      <span className="flex items-center gap-1">
                        <Mail size={12} />
                        {response.respondentEmail}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {response.values.length === 0 ? (
                <p className="text-sm text-[#64748B]">No field values were submitted.</p>
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {response.values.map(answer => {
                    const field = fieldMap.get(answer.fieldId)
                    return (
                      <div
                        key={`${response.id}-${answer.fieldId}`}
                        className="rounded border border-[#E2E8F0] dark:border-[#334155] p-4 bg-[#F8FAFC] dark:bg-[#0F172A]"
                      >
                        <p className="text-xs font-medium uppercase tracking-wide text-[#64748B] mb-2">
                          {field?.label || `Field #${answer.fieldId}`}
                        </p>
                        {renderResponseValue(field, answer.value)}
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}