import { useEffect, useMemo, useRef, useState } from 'react'
import { Calendar, ClipboardList, Clipboard, LayoutGrid, Lock, LockOpen, Mail, MessageSquare, Save, Table2, Tag, Trash2, User, Download } from 'lucide-react'
import { getCollection, getComments, addComment, deleteComment, getResponses, listCollections, upsertStaffFields } from '../api/collections'
import { getTicketFields, getTicket, saveTicket, finalizeTicket, getCollectionTickets } from '../api/tickets'
import { getCategoryColorClasses } from '../utils/categoryColors'
import type { Collection, CollectionField, CollectionResponse, SubmissionComment, TicketField, TicketResponse, CollectionTicketRow } from '../types'
import { useAuth } from '../contexts/AuthContext'

type RecordsView = 'summary' | 'individual' | 'tickets'

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
        return (
          <ul className="space-y-0.5">
            {items.map((item, i) => (
              <li key={i} className="flex items-start gap-1.5 text-sm text-[#1E293B] dark:text-[#F1F5F9]">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#64748B] shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        )
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

function formatResponseValueForCsv(field: CollectionField | undefined, rawValue: string | null): string {
  const value = rawValue ?? ''
  if (!field || value.trim() === '') {
    return value
  }

  switch (field.type) {
    case 'multiple_choice': {
      try {
        const selections = JSON.parse(value) as string[]
        return Array.isArray(selections) ? selections.join('; ') : value
      } catch {
        return value
      }
    }
    case 'confirmation':
      return value === 'true' ? 'Confirmed' : 'Not confirmed'
    case 'custom_table': {
      try {
        const rows = JSON.parse(value) as Array<Record<string, string>>
        return Array.isArray(rows) ? JSON.stringify(rows) : value
      } catch {
        return value
      }
    }
    case 'signature':
      return value.startsWith('data:image') ? '[signature captured]' : value
    default:
      return value
  }
}

function buildCollectionCsv(collection: Collection, responses: CollectionResponse[]): string {
  const fields = [...collection.fields].sort((left, right) => {
    if (left.page !== right.page) return left.page - right.page
    return left.sortOrder - right.sortOrder
  })
  const includeRespondentColumns = !collection.anonymous

  const labelCounts = new Map<string, number>()
  const fieldColumns = fields.map((field) => {
    const baseLabel = field.label.trim() || `Field ${field.id ?? ''}`.trim()
    const nextCount = (labelCounts.get(baseLabel) ?? 0) + 1
    labelCounts.set(baseLabel, nextCount)
    return {
      fieldId: field.id,
      header: nextCount === 1 ? baseLabel : `${baseLabel} (${nextCount})`,
      field,
    }
  })

  const header = [
    'Submission ID',
    'Submitted At',
    ...(includeRespondentColumns ? ['Respondent Name', 'Respondent Email'] : []),
    ...fieldColumns.map((column) => column.header),
  ]

  const lines = responses.map((response) => {
    const valueMap = new Map(response.values.map((entry) => [entry.fieldId, entry.value]))
    return [
      String(response.id),
      response.submittedAt,
      ...(includeRespondentColumns ? [response.respondentName ?? '', response.respondentEmail ?? ''] : []),
      ...fieldColumns.map((column) => {
        if (column.fieldId === undefined) return ''
        return formatResponseValueForCsv(column.field, valueMap.get(column.fieldId) ?? '')
      }),
    ]
      .map(toCsvCell)
      .join(',')
  })

  return [header.map(toCsvCell).join(','), ...lines].join('\n')
}

function downloadCollectionCsv(collection: Collection, responses: CollectionResponse[]): void {
  const safeFilename = (collection.title.trim() || `collection-${collection.id}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `collection-${collection.id}`
  const blob = new Blob([buildCollectionCsv(collection, responses)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeFilename}-records.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

const STAFF_INPUT =
  'w-full border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0F172A] ' +
  'text-[#1E293B] dark:text-[#F1F5F9] placeholder-[#94A3B8] px-2.5 py-1.5 text-sm rounded ' +
  'focus:outline-none focus:ring-2 focus:ring-amber-400'

function StaffFieldEditor({
  field,
  value,
  onChange,
}: {
  field: CollectionField
  value: string
  onChange: (v: string) => void
}) {
  if (
    field.type === 'comment' ||
    field.type === 'custom_table' ||
    field.type === 'matrix_likert_scale'
  ) {
    return <p className="text-xs text-[#94A3B8] italic">Complex field — view only</p>
  }

  if (field.type === 'long_text') {
    return (
      <textarea
        className={STAFF_INPUT}
        rows={3}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Enter value…"
      />
    )
  }

  if (field.type === 'date') {
    return (
      <input
        type="date"
        className={STAFF_INPUT}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    )
  }

  if (field.type === 'confirmation') {
    return (
      <label className="flex items-center gap-2 text-sm text-[#1E293B] dark:text-[#F1F5F9] cursor-pointer">
        <input
          type="checkbox"
          checked={value === 'true'}
          onChange={e => onChange(e.target.checked ? 'true' : 'false')}
          className="accent-amber-500"
        />
        Confirmed
      </label>
    )
  }

  if (field.type === 'single_choice') {
    const options = field.options ?? []
    return (
      <select className={STAFF_INPUT} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">— select —</option>
        {options.map(opt => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    )
  }

  if (field.type === 'multiple_choice') {
    const options = field.options ?? []
    let selected: string[] = []
    try {
      const parsed = JSON.parse(value) as unknown
      selected = Array.isArray(parsed) ? parsed.map(String) : value ? [value] : []
    } catch {
      selected = value ? [value] : []
    }
    return (
      <div className="flex flex-col gap-1">
        {options.map(opt => (
          <label
            key={opt}
            className="flex items-center gap-2 text-sm text-[#1E293B] dark:text-[#F1F5F9] cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selected.includes(opt)}
              onChange={e => {
                const next = e.target.checked
                  ? [...selected, opt]
                  : selected.filter(s => s !== opt)
                onChange(JSON.stringify(next))
              }}
              className="accent-amber-500"
            />
            {opt}
          </label>
        ))}
      </div>
    )
  }

  if (field.type === 'rating') {
    const num = Number(value) || 0
    return (
      <div className="flex items-center gap-1 flex-wrap">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(String(n))}
            className={[
              'w-8 h-8 rounded text-sm font-medium transition-colors',
              n <= num
                ? 'bg-amber-400 text-white'
                : 'bg-[#F1F5F9] dark:bg-[#334155] text-[#64748B] hover:bg-amber-100',
            ].join(' ')}
          >
            {n}
          </button>
        ))}
        {num > 0 && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-xs text-[#94A3B8] ml-1 hover:text-red-400 transition-colors"
          >
            Clear
          </button>
        )}
      </div>
    )
  }

  // short_text, signature, attachment
  return (
    <input
      type="text"
      className={STAFF_INPUT}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="Enter value…"
    />
  )
}

const TICKET_INPUT =
  'w-full border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0F172A] ' +
  'text-[#1E293B] dark:text-[#F1F5F9] placeholder-[#94A3B8] px-2.5 py-1.5 text-sm rounded ' +
  'focus:outline-none focus:ring-2 focus:ring-[#2563EB]'

function TicketFieldEditor({
  field,
  value,
  onChange,
}: {
  field: TicketField
  value: string
  onChange: (v: string) => void
}) {
  if (
    field.type === 'comment' ||
    field.type === 'custom_table' ||
    field.type === 'matrix_likert_scale'
  ) {
    return <p className="text-xs text-[#94A3B8] italic">Complex field — view only</p>
  }

  if (field.type === 'long_text') {
    return (
      <textarea
        className={TICKET_INPUT}
        rows={3}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Enter value…"
      />
    )
  }

  if (field.type === 'date') {
    return (
      <input
        type="date"
        className={TICKET_INPUT}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    )
  }

  if (field.type === 'confirmation') {
    return (
      <label className="flex items-center gap-2 text-sm text-[#1E293B] dark:text-[#F1F5F9] cursor-pointer">
        <input
          type="checkbox"
          checked={value === 'true'}
          onChange={e => onChange(e.target.checked ? 'true' : 'false')}
          className="accent-[#2563EB]"
        />
        Confirmed
      </label>
    )
  }

  if (field.type === 'single_choice') {
    const options = field.options ?? []
    return (
      <select className={TICKET_INPUT} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">— select —</option>
        {options.map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    )
  }

  if (field.type === 'multiple_choice') {
    const options = field.options ?? []
    let selected: string[] = []
    try {
      const parsed = JSON.parse(value) as unknown
      selected = Array.isArray(parsed) ? parsed.map(String) : value ? [value] : []
    } catch {
      selected = value ? [value] : []
    }
    return (
      <div className="flex flex-col gap-1">
        {options.map(opt => (
          <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(opt)}
              onChange={e => {
                const next = e.target.checked ? [...selected, opt] : selected.filter(s => s !== opt)
                onChange(JSON.stringify(next))
              }}
              className="accent-[#2563EB]"
            />
            {opt}
          </label>
        ))}
      </div>
    )
  }

  if (field.type === 'rating') {
    const num = Number(value) || 0
    return (
      <div className="flex items-center gap-1 flex-wrap">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(String(n))}
            className={[
              'w-8 h-8 rounded text-sm font-medium transition-colors',
              n <= num
                ? 'bg-[#2563EB] text-white'
                : 'bg-[#F1F5F9] dark:bg-[#334155] text-[#64748B] hover:bg-blue-100',
            ].join(' ')}
          >
            {n}
          </button>
        ))}
        {num > 0 && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-xs text-[#94A3B8] ml-1 hover:text-red-400 transition-colors"
          >
            Clear
          </button>
        )}
      </div>
    )
  }

  return (
    <input
      type="text"
      className={TICKET_INPUT}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="Enter value…"
    />
  )
}

export default function RecordsPage() {
  const { user } = useAuth()
  const [collections, setCollections] = useState<Collection[]>([])
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(null)
  const [selectedCollection, setSelectedCollection] = useState<Collection | null>(null)
  const [responses, setResponses] = useState<CollectionResponse[]>([])
  const [view, setView] = useState<RecordsView>('summary')
  const [individualLayout, setIndividualLayout] = useState<'card' | 'table'>('card')
  const [loadingCollections, setLoadingCollections] = useState(true)
  const [loadingResponses, setLoadingResponses] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedStaffResponseId, setExpandedStaffResponseId] = useState<number | null>(null)
  const [staffEdits, setStaffEdits] = useState<Record<number, Record<number, string>>>({})
  const [staffSaveState, setStaffSaveState] = useState<Record<number, 'idle' | 'saving' | 'saved' | 'error'>>({})
  // Comments + tabs
  const [submissionTab, setSubmissionTab] = useState<Record<number, 'general' | 'comments' | 'ticket'>>({})
  const [commentsByResponse, setCommentsByResponse] = useState<Record<number, SubmissionComment[]>>({})
  const [newCommentText, setNewCommentText] = useState<Record<number, string>>({})
  const [commentSubmitting, setCommentSubmitting] = useState<Record<number, boolean>>({})
  // Ticket state
  const [ticketFieldsForCollection, setTicketFieldsForCollection] = useState<TicketField[]>([])
  const [ticketsByResponse, setTicketsByResponse] = useState<Record<number, TicketResponse | null | 'loading'>>({})
  const [ticketEdits, setTicketEdits] = useState<Record<number, Record<number, string>>>({})
  const [ticketSaveState, setTicketSaveState] = useState<Record<number, 'idle' | 'saving' | 'saved' | 'error'>>({})
  const [ticketFinalizing, setTicketFinalizing] = useState<Record<number, boolean>>({})
  const [showFinalizeConfirm, setShowFinalizeConfirm] = useState<number | null>(null)
  // All-tickets view
  const [allTickets, setAllTickets] = useState<CollectionTicketRow[]>([])
  const [ticketsLoading, setTicketsLoading] = useState(false)
  const [ticketStatusFilter, setTicketStatusFilter] = useState<'all' | 'open' | 'closed'>('all')
  const commentPollRef = useRef<Record<number, ReturnType<typeof setInterval>>>({})
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
      setTicketFieldsForCollection([])
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

    getTicketFields(selectedCollectionId)
      .then(fields => setTicketFieldsForCollection(fields))
      .catch(() => setTicketFieldsForCollection([]))

    // Reset tickets view when switching collections
    setAllTickets([])
    setTicketStatusFilter('all')
  }, [selectedCollectionId])

  useEffect(() => {
    if (view !== 'tickets' || !selectedCollectionId) return
    setTicketsLoading(true)
    getCollectionTickets(selectedCollectionId)
      .then(rows => setAllTickets(rows))
      .catch(() => setAllTickets([]))
      .finally(() => setTicketsLoading(false))
  }, [view, selectedCollectionId])

  const staffFields = useMemo(
    () => (selectedCollection?.fields ?? []).filter(f => f.staffOnly),
    [selectedCollection]
  )

  // ── Ticket helpers ─────────────────────────────────────────────────────────

  function openTicketTab(responseId: number) {
    setSubmissionTab(prev => ({ ...prev, [responseId]: 'ticket' }))
    if (ticketsByResponse[responseId] !== undefined) return
    setTicketsByResponse(prev => ({ ...prev, [responseId]: 'loading' }))
    if (!selectedCollectionId) return
    getTicket(selectedCollectionId, responseId)
      .then(ticket => {
        setTicketsByResponse(prev => ({ ...prev, [responseId]: ticket }))
        if (ticket) {
          const initialEdits: Record<number, string> = {}
          for (const v of ticket.values) {
            initialEdits[v.fieldId] = v.value ?? ''
          }
          setTicketEdits(prev => ({ ...prev, [responseId]: initialEdits }))
        }
      })
      .catch(() => setTicketsByResponse(prev => ({ ...prev, [responseId]: null })))
  }

  async function handleSaveTicketDraft(responseId: number) {
    if (!selectedCollectionId) return
    setTicketSaveState(prev => ({ ...prev, [responseId]: 'saving' }))
    const edits = ticketEdits[responseId] ?? {}
    const values = ticketFieldsForCollection
      .filter(f => f.id !== undefined)
      .map(f => ({ fieldId: f.id as number, value: edits[f.id as number] ?? '' }))
    try {
      const ticket = await saveTicket(selectedCollectionId, responseId, values)
      setTicketsByResponse(prev => ({ ...prev, [responseId]: ticket }))
      setTicketSaveState(prev => ({ ...prev, [responseId]: 'saved' }))
      setTimeout(() => setTicketSaveState(prev => ({ ...prev, [responseId]: 'idle' })), 2500)
    } catch {
      setTicketSaveState(prev => ({ ...prev, [responseId]: 'error' }))
    }
  }

  async function handleFinalizeTicket(responseId: number) {
    if (!selectedCollectionId) return
    setTicketFinalizing(prev => ({ ...prev, [responseId]: true }))
    try {
      const ticket = await finalizeTicket(selectedCollectionId, responseId)
      setTicketsByResponse(prev => ({ ...prev, [responseId]: ticket }))
      setShowFinalizeConfirm(null)
    } catch {
      // ignore; ticket remains
    } finally {
      setTicketFinalizing(prev => ({ ...prev, [responseId]: false }))
    }
  }

  // ── Comments helpers ───────────────────────────────────────────────────────

  function loadComments(responseId: number) {
    if (!selectedCollection?.id) return
    getComments(selectedCollection.id, responseId)
      .then(items => setCommentsByResponse(prev => ({ ...prev, [responseId]: items })))
      .catch(() => {/* silently ignore poll errors */})
  }

  function openCommentsTab(responseId: number) {
    setSubmissionTab(prev => ({ ...prev, [responseId]: 'comments' }))
    loadComments(responseId)
    // Start 60-second poll if not already running
    if (!commentPollRef.current[responseId]) {
      commentPollRef.current[responseId] = setInterval(() => loadComments(responseId), 60_000)
    }
  }

  function closeCommentsTab(responseId: number) {
    setSubmissionTab(prev => ({ ...prev, [responseId]: 'general' }))
    clearInterval(commentPollRef.current[responseId])
    delete commentPollRef.current[responseId]
  }

  // Clean up all intervals when collection changes or unmount
  useEffect(() => {
    return () => {
      Object.values(commentPollRef.current).forEach(clearInterval)
      commentPollRef.current = {}
    }
  }, [selectedCollectionId])

  async function handleAddComment(responseId: number) {
    if (!selectedCollection?.id) return
    const text = (newCommentText[responseId] ?? '').trim()
    if (!text) return
    setCommentSubmitting(prev => ({ ...prev, [responseId]: true }))
    try {
      const comment = await addComment(selectedCollection.id, responseId, text)
      setCommentsByResponse(prev => ({ ...prev, [responseId]: [...(prev[responseId] ?? []), comment] }))
      setNewCommentText(prev => ({ ...prev, [responseId]: '' }))
    } catch (err) {
      console.error('[RecordsPage] addComment:', err)
    } finally {
      setCommentSubmitting(prev => ({ ...prev, [responseId]: false }))
    }
  }

  async function handleDeleteComment(responseId: number, commentId: number) {
    if (!selectedCollection?.id) return
    try {
      await deleteComment(selectedCollection.id, responseId, commentId)
      setCommentsByResponse(prev => ({
        ...prev,
        [responseId]: (prev[responseId] ?? []).filter(c => c.id !== commentId),
      }))
    } catch (err) {
      console.error('[RecordsPage] deleteComment:', err)
    }
  }

  async function handleSaveStaffNotes(responseId: number) {
    if (!selectedCollection?.id) return
    const edits = staffEdits[responseId] ?? {}
    const values = Object.entries(edits).map(([fieldId, value]) => ({
      fieldId: Number(fieldId),
      value,
    }))
    setStaffSaveState(prev => ({ ...prev, [responseId]: 'saving' }))
    try {
      await upsertStaffFields(selectedCollection.id, responseId, values)
      const updated = await getResponses(selectedCollection.id)
      setResponses(updated)
      setStaffSaveState(prev => ({ ...prev, [responseId]: 'saved' }))
      setTimeout(() => {
        setStaffSaveState(prev => ({ ...prev, [responseId]: 'idle' }))
      }, 2000)
    } catch (err) {
      console.error('[RecordsPage] saveStaffNotes:', err)
      setStaffSaveState(prev => ({ ...prev, [responseId]: 'error' }))
    }
  }

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

        <div className="w-full md:max-w-xl">
          <label className="block text-xs font-medium uppercase tracking-wide text-[#64748B] mb-1">
            Collection
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
            <button
              type="button"
              onClick={() => selectedCollection && downloadCollectionCsv(selectedCollection, responses)}
              disabled={!selectedCollection || responses.length === 0}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded bg-[#2563EB] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              <Download size={14} />
              Export CSV
            </button>
          </div>
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
            <div className="flex items-center gap-3 flex-wrap">
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
                {ticketFieldsForCollection.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setView('tickets')}
                    className={[
                      'px-4 py-2 text-sm font-medium transition-colors border-l border-[#CBD5E1] dark:border-[#334155] flex items-center gap-1.5',
                      view === 'tickets'
                        ? 'bg-[#2563EB] text-white'
                        : 'bg-white dark:bg-[#1E293B] text-[#1E293B] dark:text-[#F1F5F9] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]',
                    ].join(' ')}
                  >
                    <Clipboard size={13} />
                    Tickets
                  </button>
                )}
              </div>
              {view === 'individual' && (
                <div className="inline-flex rounded overflow-hidden border border-[#CBD5E1] dark:border-[#334155] w-fit">
                  <button
                    type="button"
                    onClick={() => setIndividualLayout('card')}
                    title="Card view"
                    className={[
                      'px-3 py-2 text-sm font-medium transition-colors flex items-center gap-1.5',
                      individualLayout === 'card'
                        ? 'bg-[#2563EB] text-white'
                        : 'bg-white dark:bg-[#1E293B] text-[#1E293B] dark:text-[#F1F5F9] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]',
                    ].join(' ')}
                  >
                    <LayoutGrid size={14} />
                    Card
                  </button>
                  <button
                    type="button"
                    onClick={() => setIndividualLayout('table')}
                    title="Table view"
                    className={[
                      'px-3 py-2 text-sm font-medium transition-colors border-l border-[#CBD5E1] dark:border-[#334155] flex items-center gap-1.5',
                      individualLayout === 'table'
                        ? 'bg-[#2563EB] text-white'
                        : 'bg-white dark:bg-[#1E293B] text-[#1E293B] dark:text-[#F1F5F9] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]',
                    ].join(' ')}
                  >
                    <Table2 size={14} />
                    Table
                  </button>
                </div>
              )}
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

      {!loadingResponses && selectedCollection && responses.length > 0 && view === 'individual' && individualLayout === 'table' && (() => {
        const regularFields = selectedCollection.fields.filter(f => !f.staffOnly && f.id !== undefined)
        const staffOnlyFields = selectedCollection.fields.filter(f => f.staffOnly && f.id !== undefined)

        function cellDisplay(f: CollectionField, value: string | null | undefined): string {
          const raw = value ?? ''
          if (!raw) return '—'
          if (f.type === 'signature') return '[Signature]'
          if (f.type === 'attachment') return '[Attachment]'
          if (f.type === 'custom_table') return '[Table]'
          if (f.type === 'confirmation') return raw === 'true' ? 'Yes' : 'No'
          return raw
        }

        const thClass = 'text-left text-xs font-medium border-b px-3 py-2.5 whitespace-nowrap'
        const tdClass = 'border-b px-3 py-2 max-w-[200px] truncate'

        return (
          <div className="overflow-x-auto rounded-lg border border-[#E2E8F0] dark:border-[#334155]">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[#F8FAFC] dark:bg-[#0F172A]">
                  <th className={`${thClass} text-[#64748B] border-[#E2E8F0] dark:border-[#334155]`}>#</th>
                  <th className={`${thClass} text-[#64748B] border-[#E2E8F0] dark:border-[#334155]`}>Date</th>
                  <th className={`${thClass} text-[#64748B] border-[#E2E8F0] dark:border-[#334155]`}>Respondent</th>
                  {regularFields.map(f => (
                    <th key={f.id} className={`${thClass} text-[#64748B] border-[#E2E8F0] dark:border-[#334155]`}>
                      {f.label}
                    </th>
                  ))}
                  {staffOnlyFields.map(f => (
                    <th key={f.id} className={`${thClass} text-amber-600 dark:text-amber-500 border-[#E2E8F0] dark:border-[#334155]`}>
                      <span className="flex items-center gap-1">
                        <Lock size={11} />
                        {f.label}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {responses.map((response, rowIdx) => (
                  <tr
                    key={response.id}
                    className={rowIdx % 2 === 0 ? 'bg-white dark:bg-[#1E293B]' : 'bg-[#F8FAFC] dark:bg-[#0F172A]'}
                  >
                    <td className={`${tdClass} text-[#1E293B] dark:text-[#F1F5F9] border-[#E2E8F0] dark:border-[#334155] whitespace-nowrap`}>{response.id}</td>
                    <td className={`${tdClass} text-[#64748B] border-[#E2E8F0] dark:border-[#334155] whitespace-nowrap`}>{formatSubmittedAt(response.submittedAt)}</td>
                    <td className={`${tdClass} text-[#64748B] border-[#E2E8F0] dark:border-[#334155] whitespace-nowrap`}>
                      {response.respondentName || 'Anonymous'}
                      {response.respondentEmail ? ` (${response.respondentEmail})` : ''}
                    </td>
                    {regularFields.map(f => (
                      <td key={f.id} className={`${tdClass} text-[#1E293B] dark:text-[#F1F5F9] border-[#E2E8F0] dark:border-[#334155]`}>
                        {cellDisplay(f, response.values.find(v => v.fieldId === f.id)?.value)}
                      </td>
                    ))}
                    {staffOnlyFields.map(f => (
                      <td key={f.id} className={`${tdClass} text-amber-700 dark:text-amber-400 border-[#E2E8F0] dark:border-[#334155] bg-amber-50/40 dark:bg-amber-900/10`}>
                        {cellDisplay(f, response.values.find(v => v.fieldId === f.id)?.value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })()}

      {!loadingResponses && selectedCollection && responses.length > 0 && view === 'individual' && individualLayout === 'card' && (
        <div className="space-y-4">
          {responses.map(response => {
            const activeTab = submissionTab[response.id] ?? 'general'
            const comments = commentsByResponse[response.id] ?? []
            const ticketData = ticketsByResponse[response.id]
            const ticketEditsForResponse = ticketEdits[response.id] ?? {}
            const ticketSave = ticketSaveState[response.id] ?? 'idle'
            const isTicketFinalizing = ticketFinalizing[response.id] ?? false
            const finalizedTicket = ticketData && ticketData !== 'loading' && ticketData.finalized ? ticketData : null
            const draftTicket = ticketData && ticketData !== 'loading' && !ticketData.finalized ? ticketData : null
            return (
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

              {/* Tab bar */}
              <div className="flex gap-1 border-b border-[#E2E8F0] dark:border-[#334155]">
                <button
                  type="button"
                  onClick={() => closeCommentsTab(response.id)}
                  className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors -mb-px ${activeTab === 'general' ? 'border-[#2563EB] text-[#2563EB]' : 'border-transparent text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9]'}`}
                >
                  General
                </button>
                <button
                  type="button"
                  onClick={() => openCommentsTab(response.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border-b-2 transition-colors -mb-px ${activeTab === 'comments' ? 'border-[#2563EB] text-[#2563EB]' : 'border-transparent text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9]'}`}
                >
                  <MessageSquare size={13} />
                  Comments{comments.length > 0 && <span className="ml-0.5 text-xs bg-[#2563EB] text-white rounded-full px-1.5 py-0.5 leading-none">{comments.length}</span>}
                </button>
                {ticketFieldsForCollection.length > 0 && (
                  <button
                    type="button"
                    onClick={() => openTicketTab(response.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border-b-2 transition-colors -mb-px ${activeTab === 'ticket' ? 'border-[#2563EB] text-[#2563EB]' : 'border-transparent text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9]'}`}
                  >
                    <Clipboard size={13} />
                    Ticket
                    {(() => {
                      const t = ticketsByResponse[response.id]
                      if (t && t !== 'loading' && t.finalized) return <Lock size={11} className="text-green-600" />
                      return null
                    })()}
                  </button>
                )}
              </div>

              {/* General tab */}
              {activeTab === 'general' && (
                <>
              {response.values.length === 0 ? (
                <p className="text-sm text-[#64748B]">No field values were submitted.</p>
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {response.values
                    .filter(answer => {
                      const f = fieldMap.get(answer.fieldId)
                      return !f?.staffOnly
                    })
                    .map(answer => {
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

              {staffFields.length > 0 && (
                <div className="border-t border-amber-200 dark:border-amber-800 pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400">
                      <Lock size={14} />
                      Staff Notes
                    </div>
                    {expandedStaffResponseId !== response.id && (
                      <button
                        type="button"
                        onClick={() => {
                          const init: Record<number, string> = {}
                          staffFields.forEach(field => {
                            if (field.id !== undefined) {
                              const existing = response.values.find(v => v.fieldId === field.id)
                              init[field.id] = existing?.value ?? ''
                            }
                          })
                          setStaffEdits(prev => ({ ...prev, [response.id]: init }))
                          setExpandedStaffResponseId(response.id)
                        }}
                        className="text-xs px-2.5 py-1 rounded border border-amber-400 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                      >
                        Edit
                      </button>
                    )}
                    {expandedStaffResponseId === response.id && (
                      <button
                        type="button"
                        onClick={() => setExpandedStaffResponseId(null)}
                        className="text-xs text-[#94A3B8] hover:text-[#64748B] transition-colors"
                      >
                        Collapse
                      </button>
                    )}
                  </div>

                  {expandedStaffResponseId !== response.id ? (
                    // Read-only preview
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      {staffFields.map(field => {
                        if (field.id === undefined) return null
                        const answer = response.values.find(v => v.fieldId === field.id)
                        return (
                          <div
                            key={`staff-ro-${response.id}-${field.id}`}
                            className="rounded border border-amber-200 dark:border-amber-800 p-3 bg-amber-50/40 dark:bg-amber-900/10"
                          >
                            <p className="text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-500 mb-1.5">
                              {field.label || `Field #${field.id}`}
                            </p>
                            {answer?.value
                              ? renderResponseValue(field, answer.value)
                              : <p className="text-xs text-[#94A3B8] italic">Not set</p>}
                            {answer?.staffUpdatedByName && (
                              <p className="text-xs text-[#94A3B8] mt-1.5">
                                Updated by {answer.staffUpdatedByName}
                                {answer.staffUpdatedAt && (
                                  <> · {new Date(answer.staffUpdatedAt).toLocaleString()}</>
                                )}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    // Editable panel
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                        {staffFields.map(field => {
                          if (field.id === undefined) return null
                          const currentValue = (staffEdits[response.id] ?? {})[field.id] ?? ''
                          return (
                            <div
                              key={`staff-edit-${response.id}-${field.id}`}
                              className="rounded border border-amber-200 dark:border-amber-800 p-3 bg-amber-50/40 dark:bg-amber-900/10"
                            >
                              <p className="text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-500 mb-1.5">
                                {field.label || `Field #${field.id}`}
                              </p>
                              <StaffFieldEditor
                                field={field}
                                value={currentValue}
                                onChange={v =>
                                  setStaffEdits(prev => ({
                                    ...prev,
                                    [response.id]: {
                                      ...(prev[response.id] ?? {}),
                                      [field.id as number]: v,
                                    },
                                  }))
                                }
                              />
                            </div>
                          )
                        })}
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => void handleSaveStaffNotes(response.id)}
                          disabled={staffSaveState[response.id] === 'saving'}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                        >
                          <Save size={13} />
                          {staffSaveState[response.id] === 'saving' ? 'Saving…' : 'Save Staff Notes'}
                        </button>
                        {staffSaveState[response.id] === 'saved' && (
                          <span className="text-xs text-green-600 dark:text-green-400">Saved!</span>
                        )}
                        {staffSaveState[response.id] === 'error' && (
                          <span className="text-xs text-red-500">Failed to save. Try again.</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
                </>
              )}

              {/* Comments tab */}
              {activeTab === 'comments' && (
                <div className="space-y-4">
                  {comments.length === 0 ? (
                    <p className="text-sm text-[#94A3B8] italic">No comments yet. Be the first to add one.</p>
                  ) : (
                    <div className="space-y-3">
                      {comments.map(comment => {
                        const isOwn = comment.userId === user?.id
                        const canDelete = isOwn || user?.role === 'administrator' || user?.role === 'super_admin'
                        const initials = comment.userName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                        const normalized = comment.createdAt.includes('T') ? comment.createdAt : comment.createdAt.replace(' ', 'T') + 'Z'
                        const dateLabel = new Date(normalized).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
                        return (
                          <div key={comment.id} className="flex gap-3">
                            <div className="w-8 h-8 rounded-full bg-[#2563EB] text-white flex items-center justify-center text-xs font-semibold shrink-0">
                              {initials}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-[#1E293B] dark:text-[#F1F5F9]">{comment.userName}</span>
                                <span className="text-xs text-[#94A3B8]">{dateLabel}</span>
                                {canDelete && (
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteComment(response.id, comment.id)}
                                    className="ml-auto text-[#CBD5E1] hover:text-red-400 transition-colors"
                                    title="Delete comment"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </div>
                              <p className="mt-0.5 text-sm text-[#475569] dark:text-[#94A3B8] whitespace-pre-wrap break-words">{comment.body}</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <div className="flex gap-2 pt-1 border-t border-[#E2E8F0] dark:border-[#334155]">
                    <textarea
                      rows={2}
                      placeholder="Add a comment…"
                      value={newCommentText[response.id] ?? ''}
                      onChange={e => setNewCommentText(prev => ({ ...prev, [response.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleAddComment(response.id) } }}
                      className="flex-1 resize-none rounded border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0F172A] text-sm text-[#1E293B] dark:text-[#F1F5F9] placeholder-[#94A3B8] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                    />
                    <button
                      type="button"
                      disabled={!(newCommentText[response.id] ?? '').trim() || commentSubmitting[response.id]}
                      onClick={() => void handleAddComment(response.id)}
                      className="self-end px-3 py-2 rounded bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-40 text-white text-sm font-medium transition-colors"
                    >
                      {commentSubmitting[response.id] ? '…' : 'Post'}
                    </button>
                  </div>
                </div>
              )}

              {/* Ticket tab */}
              {activeTab === 'ticket' && ticketData === 'loading' && (
                <p className="text-sm text-[#94A3B8]">Loading ticket…</p>
              )}
              {activeTab === 'ticket' && finalizedTicket && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 font-medium">
                    <Lock size={14} />
                    Ticket closed
                    {finalizedTicket.finalizedAt && (
                      <span className="text-xs text-[#94A3B8] font-normal ml-1">
                        {new Date(finalizedTicket.finalizedAt.includes('T') ? finalizedTicket.finalizedAt : finalizedTicket.finalizedAt.replace(' ', 'T') + 'Z').toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        {finalizedTicket.finalizedByName ? ` by ${finalizedTicket.finalizedByName}` : ''}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleFinalizeTicket(response.id)}
                      disabled={isTicketFinalizing}
                      className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-[#CBD5E1] dark:border-[#334155] text-[#64748B] dark:text-[#94A3B8] text-xs font-medium hover:bg-[#F8FAFC] dark:hover:bg-[#1E293B] disabled:opacity-50 transition-colors"
                    >
                      <LockOpen size={12} />
                      {isTicketFinalizing ? 'Re-opening…' : 'Re-open'}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {ticketFieldsForCollection.map(field => {
                      if (field.id === undefined) return null
                      const val = finalizedTicket.values.find(v => v.fieldId === field.id)?.value ?? ''
                      return (
                        <div key={field.id} className="rounded border border-[#E2E8F0] dark:border-[#334155] p-3 bg-[#F8FAFC] dark:bg-[#0F172A]">
                          <p className="text-xs font-medium uppercase tracking-wide text-[#64748B] mb-1">{field.label}</p>
                          <p className="text-sm text-[#1E293B] dark:text-[#F1F5F9] whitespace-pre-wrap break-words">{val || <span className="text-[#94A3B8] italic">—</span>}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              {activeTab === 'ticket' && !finalizedTicket && ticketData !== 'loading' && (
                <div className="space-y-4">
                  {ticketFieldsForCollection.map(field => {
                    if (field.id === undefined) return null
                    return (
                      <div key={field.id}>
                        <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">
                          {field.label}
                          {field.required && <span className="text-red-500 ml-0.5">*</span>}
                        </label>
                        <TicketFieldEditor
                          field={field}
                          value={ticketEditsForResponse[field.id] ?? (draftTicket ? (draftTicket.values.find(v => v.fieldId === field.id)?.value ?? '') : '')}
                          onChange={v => setTicketEdits(prev => ({
                            ...prev,
                            [response.id]: { ...(prev[response.id] ?? {}), [field.id as number]: v },
                          }))}
                        />
                      </div>
                    )
                  })}
                  {ticketSave === 'error' && (
                    <p className="text-xs text-red-500">Failed to save. Please try again.</p>
                  )}
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => void handleSaveTicketDraft(response.id)}
                      disabled={ticketSave === 'saving'}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
                    >
                      <Save size={13} />
                      {ticketSave === 'saving' ? 'Saving…' : ticketSave === 'saved' ? 'Saved!' : 'Save Draft'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowFinalizeConfirm(response.id)}
                      disabled={isTicketFinalizing}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-green-600 text-green-700 dark:text-green-400 text-sm font-medium hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 transition-colors"
                    >
                      <Lock size={13} />
                      Close
                    </button>
                  </div>
                  {showFinalizeConfirm === response.id && (
                    <div className="rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-3">
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Close this ticket?</p>
                      <p className="text-xs text-amber-700 dark:text-amber-400">Closing marks the ticket as done. It can be re-opened at any time.</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handleFinalizeTicket(response.id)}
                          disabled={isTicketFinalizing}
                          className="px-3 py-1.5 rounded bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          {isTicketFinalizing ? 'Closing…' : 'Yes, Close'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowFinalizeConfirm(null)}
                          className="px-3 py-1.5 rounded border border-[#CBD5E1] dark:border-[#334155] text-[#64748B] text-sm font-medium hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
            )
          })}
        </div>
      )}

      {/* ── Tickets view ─────────────────────────────────────────────────── */}
      {view === 'tickets' && selectedCollection && (
        <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
          {/* Filter bar */}
          <div className="px-5 py-3 border-b border-[#E2E8F0] dark:border-[#334155] flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-[#475569] dark:text-[#94A3B8]">Status:</span>
            {(['all', 'open', 'closed'] as const).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setTicketStatusFilter(f)}
                className={[
                  'px-3 py-1 rounded-[2px] text-xs font-medium transition-colors',
                  ticketStatusFilter === f
                    ? 'bg-[#2563EB] text-white'
                    : 'bg-[#F1F5F9] dark:bg-[#0F172A] text-[#475569] dark:text-[#94A3B8] hover:bg-[#E2E8F0] dark:hover:bg-[#1E293B]',
                ].join(' ')}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
            <span className="ml-auto text-xs text-[#94A3B8]">
              {allTickets.filter(t => ticketStatusFilter === 'all' || (ticketStatusFilter === 'closed' ? t.finalized : !t.finalized)).length} ticket{allTickets.length !== 1 ? 's' : ''}
            </span>
          </div>

          {ticketsLoading && (
            <div className="flex items-center justify-center h-32 text-[#64748B] text-sm">
              Loading tickets…
            </div>
          )}

          {!ticketsLoading && allTickets.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-[#94A3B8]">
              <Clipboard size={28} className="opacity-40" />
              <p className="text-sm">No tickets have been filled in yet.</p>
            </div>
          )}

          {!ticketsLoading && allTickets.length > 0 && (() => {
            const filtered = allTickets.filter(t =>
              ticketStatusFilter === 'all' ||
              (ticketStatusFilter === 'closed' ? t.finalized : !t.finalized)
            )
            return (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A]">
                      <th className="text-left px-4 py-2.5 font-medium text-[#64748B] text-xs uppercase tracking-wide whitespace-nowrap">Submission</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[#64748B] text-xs uppercase tracking-wide whitespace-nowrap">Submitted</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[#64748B] text-xs uppercase tracking-wide whitespace-nowrap">Status</th>
                      {ticketFieldsForCollection.map(f => (
                        <th key={f.id} className="text-left px-4 py-2.5 font-medium text-[#64748B] text-xs uppercase tracking-wide whitespace-nowrap max-w-[180px]">
                          {f.label}
                        </th>
                      ))}
                      <th className="text-left px-4 py-2.5 font-medium text-[#64748B] text-xs uppercase tracking-wide whitespace-nowrap">Closed by</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((ticket, i) => {
                      const submitter = ticket.submitterName ?? ticket.submitterEmail ?? `#${ticket.collectionResponseId}`
                      const submittedLabel = ticket.submittedAt
                        ? new Date(ticket.submittedAt.includes('T') ? ticket.submittedAt : ticket.submittedAt.replace(' ', 'T') + 'Z')
                            .toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric' })
                        : '—'
                      return (
                        <tr
                          key={ticket.id}
                          className={[
                            'border-b border-[#E2E8F0] dark:border-[#334155] last:border-0',
                            i % 2 === 1 ? 'bg-[#F8FAFC] dark:bg-[#0F172A]/50' : '',
                          ].join(' ')}
                        >
                          <td className="px-4 py-3 text-[#1E293B] dark:text-[#F1F5F9] font-medium whitespace-nowrap">{submitter}</td>
                          <td className="px-4 py-3 text-[#64748B] whitespace-nowrap">{submittedLabel}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {ticket.finalized ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[2px] text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                                <Lock size={10} />
                                Closed
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[2px] text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                                Open
                              </span>
                            )}
                          </td>
                          {ticketFieldsForCollection.map(f => {
                            const val = f.id !== undefined
                              ? (ticket.values.find(v => v.fieldId === f.id)?.value ?? '')
                              : ''
                            return (
                              <td key={f.id} className="px-4 py-3 text-[#475569] dark:text-[#94A3B8] max-w-[180px] truncate">
                                {val || <span className="text-[#CBD5E1] italic">—</span>}
                              </td>
                            )
                          })}
                          <td className="px-4 py-3 text-[#64748B] whitespace-nowrap text-xs">
                            {ticket.finalized && ticket.finalizedByName ? ticket.finalizedByName : '—'}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => {
                                setView('individual')
                                setIndividualLayout('card')
                                setTimeout(() => {
                                  setSubmissionTab(prev => ({ ...prev, [ticket.collectionResponseId]: 'ticket' }))
                                }, 50)
                              }}
                              className="text-xs text-[#2563EB] hover:underline"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {filtered.length === 0 && (
                  <p className="text-sm text-[#94A3B8] text-center py-8">No tickets match this filter.</p>
                )}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}