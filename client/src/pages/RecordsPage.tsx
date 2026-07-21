import { parseAttachmentValue } from '../utils/attachmentValue'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Calendar, ClipboardList, Clipboard, LayoutGrid, Lock, LockOpen, Mail, MessageSquare, Save, Table2, Tag, Trash2, User as UserIcon, Download, X } from 'lucide-react'
import { approveResponseWorkflow, getCollection, getComments, addComment, deleteComment, getResponses, listCollections, rejectResponseWorkflow, upsertStaffFields } from '../api/collections'
import {
  getCollectionTicketTemplates,
  getCollectionTickets,
  getResponseTickets,
  getTemplateTicket,
  saveTemplateTicket,
  finalizeTemplateTicket,
  getTemplateTicketHistory,
} from '../api/tickets'
import { getTicketTemplateFields } from '../api/ticketTemplates'
import { getCategoryColorClasses } from '../utils/categoryColors'
import type {
  ApprovalWorkflowStageSummary,
  ApprovalWorkflowSummary,
  Collection,
  CollectionField,
  CollectionResponse,
  SubmissionComment,
  TicketField,
  TicketResponse,
  CollectionTicketRow,
  TicketHistoryEntry,
  CollectionTicketTemplate,
  ResponseTicketSummary,
} from '../types'
import { useAuth } from '../contexts/AuthContext'

type RecordsView = 'summary' | 'individual' | 'tickets' | 'ticket-export'
type SubmissionTab = 'general' | 'comments'
type TicketDrawerTab = 'details' | 'history'

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

function ticketKey(responseId: number, templateId: number): string {
  return `${responseId}:${templateId}`
}

function getTicketButtonClasses({
  isActive,
  hasResponse,
  isClosed,
}: {
  isActive: boolean
  hasResponse: boolean
  isClosed: boolean
}): string {
  if (isClosed) {
    return isActive
      ? 'border-[#16A34A] bg-[#DCFCE7] text-[#166534] dark:border-[#4ADE80] dark:bg-[#14532D] dark:text-[#BBF7D0]'
      : 'border-[#86EFAC] bg-[#F0FDF4] text-[#166534] hover:bg-[#DCFCE7] dark:border-[#166534] dark:bg-[#052E16] dark:text-[#86EFAC] dark:hover:bg-[#14532D]'
  }

  if (hasResponse) {
    return isActive
      ? 'border-[#2563EB] bg-[#DBEAFE] text-[#1D4ED8] dark:border-[#60A5FA] dark:bg-[#1E3A8A] dark:text-[#BFDBFE]'
      : 'border-[#93C5FD] bg-[#EFF6FF] text-[#1D4ED8] hover:bg-[#DBEAFE] dark:border-[#1D4ED8] dark:bg-[#172554] dark:text-[#93C5FD] dark:hover:bg-[#1E3A8A]'
  }

  return isActive
    ? 'border-[#2563EB] text-[#2563EB] bg-blue-50 dark:bg-blue-900/20'
    : 'border-[#CBD5E1] dark:border-[#334155] text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]'
}

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

  if (field?.type === 'attachment') {
    const attachments = parseAttachmentValue(raw)
    if (attachments.length > 0) {
      return (
        <ul className="space-y-1">
          {attachments.map(attachment => (
            <li key={attachment.attachmentId}>
              <a
                href={attachment.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-[#2563EB] hover:underline break-all"
              >
                {attachment.fileName}
              </a>
            </li>
          ))}
        </ul>
      )
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

function normalizeCustomTableRows(
  rows: Array<Record<string, unknown>>,
  configuredColumns: string[],
): { columns: string[]; rows: Array<Record<string, string>> } {
  if (rows.length === 0) {
    return { columns: configuredColumns, rows: [] }
  }

  const normalizedRows = rows.map((row) => {
    const sourceKeys = Object.keys(row)
    const normalized: Record<string, string> = {}

    if (configuredColumns.length > 0) {
      configuredColumns.forEach((column, index) => {
        const directValue = row[column]
        const fallbackKey = sourceKeys[index]
        const fallbackValue = fallbackKey ? row[fallbackKey] : undefined
        const resolved = directValue ?? fallbackValue
        normalized[column] = resolved == null ? '' : String(resolved)
      })
      return normalized
    }

    sourceKeys.forEach((key) => {
      normalized[key] = row[key] == null ? '' : String(row[key])
    })
    return normalized
  })

  const columns = configuredColumns.length > 0
    ? configuredColumns
    : Object.keys(normalizedRows[0] ?? {})

  return { columns, rows: normalizedRows }
}

function renderTicketHistoryValue(fieldType: string | null | undefined, value: string | null, field?: TicketField) {
  const raw = value ?? ''
  if (!raw) {
    return <span className="text-sm text-[#94A3B8] italic">Empty</span>
  }

  if (fieldType === 'multiple_choice') {
    try {
      const items = JSON.parse(raw) as string[]
      if (Array.isArray(items)) {
        return <span className="text-sm text-[#1E293B] dark:text-[#F1F5F9]">{items.join(', ') || 'Empty'}</span>
      }
    } catch {
      // Fall back to raw rendering.
    }
  }

  if (fieldType === 'confirmation') {
    return <span className="text-sm text-[#1E293B] dark:text-[#F1F5F9]">{raw === 'true' ? 'Confirmed' : 'Not confirmed'}</span>
  }

  if (fieldType === 'signature') {
    return <span className="text-sm text-[#1E293B] dark:text-[#F1F5F9]">{raw.startsWith('data:image') ? 'Signature captured' : raw}</span>
  }

  if (fieldType === 'attachment') {
    const attachments = parseAttachmentValue(raw)
    if (attachments.length > 0) {
      return (
        <ul className="space-y-1">
          {attachments.map(attachment => (
            <li key={attachment.attachmentId}>
              <a
                href={attachment.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[#2563EB] underline hover:text-blue-700 break-all"
              >
                {attachment.fileName}
              </a>
            </li>
          ))}
        </ul>
      )
    }

    return <span className="text-sm text-[#1E293B] dark:text-[#F1F5F9]">Attachment provided</span>
  }

  if (fieldType === 'custom_table') {
    try {
      const rows = JSON.parse(raw) as Array<Record<string, unknown>>
      if (Array.isArray(rows) && rows.length > 0) {
        const configuredColumns = (field?.tableColumns ?? []).map((column) => column.name)
        const normalizedTable = normalizeCustomTableRows(rows, configuredColumns)

        return (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  {normalizedTable.columns.map((column) => (
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
                {normalizedTable.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {normalizedTable.columns.map((column) => (
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
        )
      }
    } catch {
      // Fall back to raw rendering.
    }
  }

  if (fieldType === 'matrix_likert_scale') {
    return (
      <pre className="text-xs text-[#1E293B] dark:text-[#F1F5F9] whitespace-pre-wrap break-words font-mono bg-[#F8FAFC] dark:bg-[#0F172A] rounded p-2 border border-[#E2E8F0] dark:border-[#334155]">
        {raw}
      </pre>
    )
  }

  return <span className="text-sm text-[#1E293B] dark:text-[#F1F5F9] whitespace-pre-wrap break-words">{raw}</span>
}

function formatTicketHistoryTimestamp(value: string): string {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T') + 'Z'
  const date = new Date(normalized)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
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

const _formatResponseValueForCsv = formatResponseValueForCsv
void _formatResponseValueForCsv

function formatTicketFieldValueForCsv(field: TicketField | undefined, value: string | null): string {
  const raw = value ?? ''
  if (!raw || !field) return raw
  switch (field.type) {
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
      const attachments = parseAttachmentValue(raw)
      return attachments.length > 0 ? attachments.map(a => a.fileName).join('; ') : raw
    }
    default:
      return raw
  }
}

function buildTicketsCsv(
  tickets: CollectionTicketRow[],
  templates: CollectionTicketTemplate[],
  fieldsByTemplate: Record<number, TicketField[] | 'loading'>,
): string {
  const multipleTemplates = templates.length > 1
  const fieldColumns: Array<{ header: string; templateId: number; fieldId: number; field: TicketField }> = []
  templates.forEach(template => {
    const fields = fieldsByTemplate[template.id]
    if (!fields || fields === 'loading') return
    fields.forEach(field => {
      if (field.id === undefined) return
      const header = multipleTemplates ? `${template.title}: ${field.label}` : field.label
      fieldColumns.push({ header, templateId: template.id, fieldId: field.id, field })
    })
  })

  const fixedHeaders = ['Submission', 'Submitted At', 'Status', 'Ticket Type', 'Closed By', 'Closed At']
  const allHeaders = [...fixedHeaders, ...fieldColumns.map(c => c.header)]

  const lines = tickets.map(ticket => {
    const submitter = ticket.submitterName ?? ticket.submitterEmail ?? `#${ticket.collectionResponseId}`
    const submittedAt = ticket.submittedAt ? formatSubmittedAt(ticket.submittedAt) : ''
    const status = ticket.finalized ? 'Closed' : 'Open'
    const ticketType = ticket.ticketTitle ?? ''
    const closedBy = ticket.finalizedByName ?? ''
    const closedAt = ticket.finalizedAt ? formatSubmittedAt(ticket.finalizedAt) : ''
    const fieldValues = fieldColumns.map(col => {
      if (col.templateId !== ticket.ticketTemplateId) return ''
      const val = ticket.values.find(v => v.fieldId === col.fieldId)?.value ?? null
      return formatTicketFieldValueForCsv(col.field, val)
    })
    return [submitter, submittedAt, status, ticketType, closedBy, closedAt, ...fieldValues]
      .map(toCsvCell)
      .join(',')
  })

  return [allHeaders.map(toCsvCell).join(','), ...lines].join('\n')
}

function downloadTicketsCsv(
  collection: Collection,
  tickets: CollectionTicketRow[],
  templates: CollectionTicketTemplate[],
  fieldsByTemplate: Record<number, TicketField[] | 'loading'>,
): void {
  const safeFilename = (collection.title.trim() || `collection-${collection.id}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `collection-${collection.id}`
  const blob = new Blob([buildTicketsCsv(tickets, templates, fieldsByTemplate)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeFilename}-tickets.csv`
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

function getActiveWorkflowStage(workflow?: ApprovalWorkflowSummary | null): ApprovalWorkflowStageSummary | null {
  if (!workflow || workflow.status !== 'pending') return null
  return workflow.stages.find(stage => stage.stageOrder === workflow.activeStageOrder && stage.status === 'pending') ?? null
}

function canUserActOnWorkflow(workflow: ApprovalWorkflowSummary | null | undefined, userId: number | undefined): boolean {
  if (!workflow || !userId) return false
  const activeStage = getActiveWorkflowStage(workflow)
  if (!activeStage) return false
  return activeStage.approvers.some(approver => approver.userId === userId && approver.status === 'pending')
}

export default function RecordsPage() {
  const navigate = useNavigate()
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
  const [workflowCommentDrafts, setWorkflowCommentDrafts] = useState<Record<number, string>>({})
  const [workflowActionState, setWorkflowActionState] = useState<Record<number, 'idle' | 'saving' | 'error'>>({})
  // Comments + tabs
  const [submissionTab, setSubmissionTab] = useState<Record<number, SubmissionTab>>({})
  const [commentsByResponse, setCommentsByResponse] = useState<Record<number, SubmissionComment[]>>({})
  const [newCommentText, setNewCommentText] = useState<Record<number, string>>({})
  const [commentSubmitting, setCommentSubmitting] = useState<Record<number, boolean>>({})
  // Ticket state
  const [collectionTicketTemplates, setCollectionTicketTemplates] = useState<CollectionTicketTemplate[]>([])
  const [ticketFieldsByTemplate, setTicketFieldsByTemplate] = useState<Record<number, TicketField[] | 'loading'>>({})
  const [responseTicketsByResponse, setResponseTicketsByResponse] = useState<Record<number, ResponseTicketSummary[] | 'loading'>>({})
  const [ticketsByKey, setTicketsByKey] = useState<Record<string, TicketResponse | null | 'loading'>>({})
  const [ticketEdits, setTicketEdits] = useState<Record<string, Record<number, string>>>({})
  const [ticketSaveState, setTicketSaveState] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({})
  const [ticketFinalizing, setTicketFinalizing] = useState<Record<string, boolean>>({})
  const [showFinalizeConfirm, setShowFinalizeConfirm] = useState<string | null>(null)
  const [ticketDrawer, setTicketDrawer] = useState<{ responseId: number; templateId: number; tab: TicketDrawerTab } | null>(null)
  const [ticketHistoryByKey, setTicketHistoryByKey] = useState<Record<string, TicketHistoryEntry[] | 'loading'>>({})
  const [ticketHistoryError, setTicketHistoryError] = useState<Record<string, string | null>>({})
  // All-tickets view
  const [allTickets, setAllTickets] = useState<CollectionTicketRow[]>([])
  const [ticketsLoading, setTicketsLoading] = useState(false)
  const [ticketTemplateFilter, setTicketTemplateFilter] = useState<number | 'all'>('all')
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
      setCollectionTicketTemplates([])
      return
    }

    setLoadingResponses(true)
    setError(null)
    setSelectedCollection(null)
    setResponses([])
    setCollectionTicketTemplates([])
    let cancelled = false

    Promise.all([
      getCollection(selectedCollectionId),
      getResponses(selectedCollectionId),
    ])
      .then(async ([collection, responseItems]) => {
        if (cancelled) return

        const responseTicketEntries = responseItems.length > 0
          ? await Promise.all(
              responseItems.map(async response => {
                try {
                  const items = await getResponseTickets(selectedCollectionId, response.id)
                  return [response.id, items] as const
                } catch (err) {
                  console.error('[RecordsPage] loadResponseTickets:', err)
                  return [response.id, [] as ResponseTicketSummary[]] as const
                }
              })
            )
          : []

        if (cancelled) return

        setSelectedCollection(collection)
        setResponses(responseItems)
        setResponseTicketsByResponse(Object.fromEntries(responseTicketEntries))
      })
      .catch(err => {
        if (cancelled) return
        setError((err as Error).message)
      })
      .finally(() => {
        if (cancelled) return
        setLoadingResponses(false)
      })

    getCollectionTicketTemplates(selectedCollectionId)
      .then(items => {
        if (cancelled) return
        setCollectionTicketTemplates(items)
      })
      .catch(() => {
        if (cancelled) return
        setCollectionTicketTemplates([])
      })

    // Reset tickets view when switching collections
    setAllTickets([])
    setTicketTemplateFilter('all')
    setTicketStatusFilter('all')
    setTicketDrawer(null)
    setTicketFieldsByTemplate({})
    setResponseTicketsByResponse({})
    setTicketsByKey({})
    setTicketEdits({})
    setTicketSaveState({})
    setTicketFinalizing({})
    setTicketHistoryByKey({})
    setTicketHistoryError({})

    return () => {
      cancelled = true
    }
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

  function loadTicketFields(templateId: number, force = false) {
    if (!force && ticketFieldsByTemplate[templateId] !== undefined) return
    setTicketFieldsByTemplate(prev => ({ ...prev, [templateId]: 'loading' }))
    getTicketTemplateFields(templateId)
      .then(fields => setTicketFieldsByTemplate(prev => ({ ...prev, [templateId]: fields })))
      .catch(() => setTicketFieldsByTemplate(prev => ({ ...prev, [templateId]: [] })))
  }

  function loadResponseTickets(responseId: number, force = false) {
    if (!selectedCollectionId) return
    if (!force && responseTicketsByResponse[responseId] !== undefined) return
    setResponseTicketsByResponse(prev => ({ ...prev, [responseId]: 'loading' }))
    getResponseTickets(selectedCollectionId, responseId)
      .then(items => setResponseTicketsByResponse(prev => ({ ...prev, [responseId]: items })))
      .catch(err => {
        console.error('[RecordsPage] loadResponseTickets:', err)
        setResponseTicketsByResponse(prev => ({ ...prev, [responseId]: [] }))
      })
  }

  function loadTicketRecord(responseId: number, templateId: number, force = false) {
    if (!selectedCollectionId) return
    const key = ticketKey(responseId, templateId)
    if (!force && ticketsByKey[key] !== undefined) return
    setTicketsByKey(prev => ({ ...prev, [key]: 'loading' }))
    getTemplateTicket(selectedCollectionId, responseId, templateId)
      .then(ticket => {
        setTicketsByKey(prev => ({ ...prev, [key]: ticket }))
        if (ticket) {
          const initialEdits: Record<number, string> = {}
          for (const value of ticket.values) {
            initialEdits[value.fieldId] = value.value ?? ''
          }
          setTicketEdits(prev => ({ ...prev, [key]: initialEdits }))
        }
      })
      .catch(() => setTicketsByKey(prev => ({ ...prev, [key]: null })))
  }

  function loadTicketHistoryForResponse(responseId: number, templateId: number, force = false) {
    if (!selectedCollectionId) return
    const key = ticketKey(responseId, templateId)
    if (!force && ticketHistoryByKey[key] !== undefined) return
    setTicketHistoryByKey(prev => ({ ...prev, [key]: 'loading' }))
    setTicketHistoryError(prev => ({ ...prev, [key]: null }))
    getTemplateTicketHistory(selectedCollectionId, responseId, templateId)
      .then(entries => setTicketHistoryByKey(prev => ({ ...prev, [key]: entries })))
      .catch(err => {
        setTicketHistoryByKey(prev => ({ ...prev, [key]: [] }))
        setTicketHistoryError(prev => ({ ...prev, [key]: (err as Error).message }))
      })
  }

  function openTicketDrawer(responseId: number, templateId: number, tab: TicketDrawerTab = 'details') {
    setTicketDrawer({ responseId, templateId, tab })
    loadResponseTickets(responseId)
    loadTicketFields(templateId)
    loadTicketRecord(responseId, templateId)
    loadTicketHistoryForResponse(responseId, templateId)
  }

  async function handleSaveTicketDraft(responseId: number, templateId: number) {
    if (!selectedCollectionId) return
    const key = ticketKey(responseId, templateId)
    setTicketSaveState(prev => ({ ...prev, [key]: 'saving' }))
    const edits = ticketEdits[key] ?? {}
    const ticketFields = ticketFieldsByTemplate[templateId]
    const resolvedFields = ticketFields === 'loading' ? [] : (ticketFields ?? [])
    const values = resolvedFields
      .filter(f => f.id !== undefined)
      .map(f => ({ fieldId: f.id as number, value: edits[f.id as number] ?? '' }))
    try {
      const ticket = await saveTemplateTicket(selectedCollectionId, responseId, templateId, values)
      setTicketsByKey(prev => ({ ...prev, [key]: ticket }))
      loadResponseTickets(responseId, true)
      loadTicketHistoryForResponse(responseId, templateId, true)
      setTicketSaveState(prev => ({ ...prev, [key]: 'saved' }))
      setTimeout(() => setTicketSaveState(prev => ({ ...prev, [key]: 'idle' })), 2500)
    } catch {
      setTicketSaveState(prev => ({ ...prev, [key]: 'error' }))
    }
  }

  async function handleFinalizeTicket(responseId: number, templateId: number) {
    if (!selectedCollectionId) return
    const key = ticketKey(responseId, templateId)
    setTicketFinalizing(prev => ({ ...prev, [key]: true }))
    try {
      const edits = ticketEdits[key] ?? {}
      const ticketFields = ticketFieldsByTemplate[templateId]
      const resolvedFields = ticketFields === 'loading' ? [] : (ticketFields ?? [])
      const values = resolvedFields
        .filter(field => field.id !== undefined)
        .map(field => ({ fieldId: field.id as number, value: edits[field.id as number] ?? '' }))

      await saveTemplateTicket(selectedCollectionId, responseId, templateId, values)
      const ticket = await finalizeTemplateTicket(selectedCollectionId, responseId, templateId)
      setTicketsByKey(prev => ({ ...prev, [key]: ticket }))
      loadResponseTickets(responseId, true)
      loadTicketHistoryForResponse(responseId, templateId, true)
      setAllTickets(prev => prev.map(row =>
        row.collectionResponseId === responseId && row.ticketTemplateId === templateId
          ? { ...row, finalized: ticket.finalized, finalizedAt: ticket.finalizedAt, finalizedByName: ticket.finalizedByName }
          : row
      ))
      setShowFinalizeConfirm(null)
    } catch {
      // ignore; ticket remains
    } finally {
      setTicketFinalizing(prev => ({ ...prev, [key]: false }))
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

  async function handleWorkflowDecision(responseId: number, decision: 'approve' | 'reject') {
    if (!selectedCollection?.id) return
    setWorkflowActionState(prev => ({ ...prev, [responseId]: 'saving' }))
    try {
      const comment = (workflowCommentDrafts[responseId] ?? '').trim()
      const summary = decision === 'approve'
        ? await approveResponseWorkflow(selectedCollection.id, responseId, comment)
        : await rejectResponseWorkflow(selectedCollection.id, responseId, comment)

      setResponses(prev => prev.map(response => (
        response.id === responseId
          ? { ...response, workflow: summary }
          : response
      )))
      setWorkflowCommentDrafts(prev => ({ ...prev, [responseId]: '' }))
      setWorkflowActionState(prev => ({ ...prev, [responseId]: 'idle' }))
    } catch (err) {
      console.error('[RecordsPage] workflowDecision:', err)
      setWorkflowActionState(prev => ({ ...prev, [responseId]: 'error' }))
    }
  }

  const collectionsWithResponses = useMemo(
    () => collections.filter(item => (item.responseCount ?? 0) > 0),
    [collections]
  )

  const activeTicketResponse = useMemo(
    () => ticketDrawer ? responses.find(response => response.id === ticketDrawer.responseId) ?? null : null,
    [responses, ticketDrawer]
  )

  const activeTicketTemplateId = ticketDrawer?.templateId ?? null
  const activeTicketKey = activeTicketResponse && activeTicketTemplateId !== null
    ? ticketKey(activeTicketResponse.id, activeTicketTemplateId)
    : null

  const activeTicketData = activeTicketKey ? ticketsByKey[activeTicketKey] : undefined
  const activeTicketEdits = activeTicketKey ? (ticketEdits[activeTicketKey] ?? {}) : {}
  const activeTicketSave = activeTicketKey ? (ticketSaveState[activeTicketKey] ?? 'idle') : 'idle'
  const activeTicketFinalizing = activeTicketKey ? (ticketFinalizing[activeTicketKey] ?? false) : false
  const activeTicketFinalized = activeTicketData && activeTicketData !== 'loading' && activeTicketData.finalized ? activeTicketData : null
  const activeTicketDraft = activeTicketData && activeTicketData !== 'loading' && !activeTicketData.finalized ? activeTicketData : null
  const activeTicketHistory = activeTicketKey ? ticketHistoryByKey[activeTicketKey] : undefined
  const activeTicketHistoryError = activeTicketKey ? ticketHistoryError[activeTicketKey] : null
  const activeTicketFields = activeTicketTemplateId !== null && ticketFieldsByTemplate[activeTicketTemplateId] !== 'loading'
    ? (ticketFieldsByTemplate[activeTicketTemplateId] ?? [])
    : []

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

  const filteredTickets = useMemo(
    () =>
      allTickets.filter(ticket => {
        const matchesTemplate =
          ticketTemplateFilter === 'all' || ticket.ticketTemplateId === ticketTemplateFilter
        const matchesStatus =
          ticketStatusFilter === 'all' ||
          (ticketStatusFilter === 'closed' ? ticket.finalized : !ticket.finalized)
        return matchesTemplate && matchesStatus
      }),
    [allTickets, ticketTemplateFilter, ticketStatusFilter],
  )

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
              onClick={() => selectedCollection && navigate(`/records/${selectedCollection.id}/export-csv`)}
              disabled={!selectedCollection}
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
                  <UserIcon size={15} className="shrink-0 text-[#2563EB] dark:text-white" aria-label="Authentication required" />
                )}
              </h2>
              <p className="text-sm text-[#64748B]">
                {responses.length} submitted item{responses.length !== 1 ? 's' : ''}
              </p>
            </div>
            {view !== 'ticket-export' && (
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
                {collectionTicketTemplates.length > 0 && (
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
            )}
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

        function cellDisplay(f: CollectionField, value: string | null | undefined) {
          const raw = value ?? ''
          if (!raw) return '—'
          if (f.type === 'signature') return '[Signature]'
          if (f.type === 'attachment') {
            const attachments = parseAttachmentValue(raw)
            if (attachments.length > 0) {
              return (
                <div className="space-y-1">
                  {attachments.map(attachment => (
                    <a
                      key={attachment.attachmentId}
                      href={attachment.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-[#2563EB] underline hover:text-blue-700 truncate"
                      title={attachment.fileName}
                    >
                      {attachment.fileName}
                    </a>
                  ))}
                </div>
              )
            }

            return (
              <a
                href={raw}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#2563EB] underline hover:text-blue-700 truncate block"
                title={raw}
              >
                View attachment
              </a>
            )
          }
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
            const activeTab = submissionTab[response.id] === 'comments' ? 'comments' : 'general'
            const comments = commentsByResponse[response.id] ?? []
            const workflow = response.workflow ?? null
            const activeWorkflowStage = getActiveWorkflowStage(workflow)
            const canActOnWorkflow = canUserActOnWorkflow(workflow, user?.id)
            const isWorkflowSaving = workflowActionState[response.id] === 'saving'
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
                      <UserIcon size={12} />
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

              {workflow && (
                <div className="rounded border border-[#DBEAFE] dark:border-[#1D4ED8] bg-[#F8FBFF] dark:bg-[#0F172A] p-4 space-y-3">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-[#2563EB]">Approval Workflow</p>
                      <p className="text-sm text-[#1E293B] dark:text-[#F1F5F9]">
                        Status: {workflow.status.replace(/_/g, ' ')}
                        {activeWorkflowStage ? ` · Current stage: ${activeWorkflowStage.stageName}` : ''}
                      </p>
                    </div>
                    {canActOnWorkflow && (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                        Your approval is required
                      </span>
                    )}
                  </div>

                  {activeWorkflowStage && (
                    <div className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                      Approvers: {activeWorkflowStage.approvers.map(approver => `${approver.userName ?? approver.assignmentValue} (${approver.status})`).join(', ')}
                    </div>
                  )}

                  {canActOnWorkflow && (
                    <div className="space-y-3 border-t border-[#DBEAFE] dark:border-[#1D4ED8] pt-3">
                      <textarea
                        rows={2}
                        value={workflowCommentDrafts[response.id] ?? ''}
                        onChange={e => {
                          setWorkflowCommentDrafts(prev => ({ ...prev, [response.id]: e.target.value }))
                          if (workflowActionState[response.id] === 'error') {
                            setWorkflowActionState(prev => ({ ...prev, [response.id]: 'idle' }))
                          }
                        }}
                        placeholder="Optional approval comment"
                        className="w-full resize-none rounded border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#0F172A] px-3 py-2 text-sm text-[#1E293B] dark:text-[#F1F5F9] placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleWorkflowDecision(response.id, 'approve')}
                          disabled={isWorkflowSaving}
                          className="inline-flex items-center rounded bg-[#16A34A] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#15803D] disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleWorkflowDecision(response.id, 'reject')}
                          disabled={isWorkflowSaving}
                          className="inline-flex items-center rounded bg-[#DC2626] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#B91C1C] disabled:opacity-50"
                        >
                          Reject
                        </button>
                        {workflowActionState[response.id] === 'error' && (
                          <span className="text-xs text-red-600 dark:text-red-400">Failed to update approval. Try again.</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

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
              </div>

              {collectionTicketTemplates.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {collectionTicketTemplates.map(template => {
                    const responseTickets = responseTicketsByResponse[response.id]
                    const summary = responseTickets !== 'loading'
                      ? (responseTickets ?? []).find(item => item.templateId === template.id)
                      : undefined
                    const isActive = ticketDrawer?.responseId === response.id && ticketDrawer?.templateId === template.id
                    const hasResponse = Boolean(summary?.response)
                    const isClosed = Boolean(summary?.response?.finalized)

                    return (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => openTicketDrawer(response.id, template.id)}
                        className={[
                          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] text-xs font-medium border transition-colors',
                          getTicketButtonClasses({ isActive, hasResponse, isClosed }),
                        ].join(' ')}
                      >
                        <Clipboard size={12} />
                        {template.title}
                        {summary?.response?.finalized && <Lock size={10} className="text-green-600" />}
                      </button>
                    )
                  })}
                </div>
              )}

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
                          {field?.label || answer.fieldLabel || `Field #${answer.fieldId}`}
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
            </section>
            )
          })}
        </div>
      )}

      {ticketDrawer && activeTicketResponse && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close ticket panel"
            onClick={() => { setTicketDrawer(null); setShowFinalizeConfirm(null) }}
            className="absolute inset-0 bg-slate-950/35"
          />
          <aside className="absolute right-0 top-0 h-full w-full max-w-2xl bg-white dark:bg-[#0F172A] border-l border-[#E2E8F0] dark:border-[#334155] shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b border-[#E2E8F0] dark:border-[#334155] flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-[#94A3B8]">
                  <Clipboard size={13} />
                  {collectionTicketTemplates.find(template => template.id === activeTicketTemplateId)?.title ?? 'Ticket'}
                </div>
                <h2 className="mt-2 text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Submission #{activeTicketResponse.id}</h2>
                <p className="mt-1 text-sm text-[#64748B]">
                  {activeTicketResponse.respondentName || 'Anonymous'}
                  {activeTicketResponse.respondentEmail ? ` · ${activeTicketResponse.respondentEmail}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setTicketDrawer(null); setShowFinalizeConfirm(null) }}
                className="w-9 h-9 rounded-md flex items-center justify-center text-[#64748B] hover:text-[#1E293B] hover:bg-[#F8FAFC] dark:hover:bg-[#1E293B] dark:hover:text-[#F1F5F9] transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-3 border-b border-[#E2E8F0] dark:border-[#334155] flex flex-wrap gap-2">
              {collectionTicketTemplates.map(template => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => openTicketDrawer(activeTicketResponse.id, template.id, ticketDrawer.tab)}
                  className={[
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] text-xs font-medium border transition-colors',
                    activeTicketTemplateId === template.id
                      ? 'border-[#2563EB] text-[#2563EB] bg-blue-50 dark:bg-blue-900/20'
                      : 'border-[#CBD5E1] dark:border-[#334155] text-[#64748B] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]',
                  ].join(' ')}
                >
                  <Clipboard size={12} />
                  {template.title}
                </button>
              ))}
            </div>

            <div className="px-5 border-b border-[#E2E8F0] dark:border-[#334155] flex gap-1">
              <button
                type="button"
                onClick={() => setTicketDrawer(prev => prev ? { ...prev, tab: 'details' } : prev)}
                className={`px-3 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${ticketDrawer.tab === 'details' ? 'border-[#2563EB] text-[#2563EB]' : 'border-transparent text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9]'}`}
              >
                Details
              </button>
              <button
                type="button"
                onClick={() => {
                  setTicketDrawer(prev => prev ? { ...prev, tab: 'history' } : prev)
                  if (activeTicketTemplateId !== null) {
                    loadTicketHistoryForResponse(activeTicketResponse.id, activeTicketTemplateId)
                  }
                }}
                className={`px-3 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${ticketDrawer.tab === 'history' ? 'border-[#2563EB] text-[#2563EB]' : 'border-transparent text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9]'}`}
              >
                History
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {ticketDrawer.tab === 'details' && activeTicketData === 'loading' && (
                <p className="text-sm text-[#94A3B8]">Loading ticket…</p>
              )}

              {ticketDrawer.tab === 'details' && activeTicketFinalized && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 font-medium">
                    <Lock size={14} />
                    Ticket closed
                    {activeTicketFinalized.finalizedAt && (
                      <span className="text-xs text-[#94A3B8] font-normal ml-1">
                        {formatTicketHistoryTimestamp(activeTicketFinalized.finalizedAt)}
                        {activeTicketFinalized.finalizedByName ? ` by ${activeTicketFinalized.finalizedByName}` : ''}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => activeTicketTemplateId !== null ? void handleFinalizeTicket(activeTicketResponse.id, activeTicketTemplateId) : undefined}
                      disabled={activeTicketFinalizing}
                      className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-[#CBD5E1] dark:border-[#334155] text-[#64748B] dark:text-[#94A3B8] text-xs font-medium hover:bg-[#F8FAFC] dark:hover:bg-[#1E293B] disabled:opacity-50 transition-colors"
                    >
                      <LockOpen size={12} />
                      {activeTicketFinalizing ? 'Re-opening…' : 'Re-open'}
                    </button>
                  </div>
                  <div className="space-y-4">
                    {activeTicketFields.map(field => {
                      if (field.id === undefined) return null
                      const val = activeTicketFinalized.values.find(v => v.fieldId === field.id)?.value ?? ''
                      return (
                        <div key={field.id}>
                          <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">
                            {field.label}
                            {field.required && <span className="text-red-500 ml-0.5">*</span>}
                          </label>
                          <div className="rounded border border-[#E2E8F0] dark:border-[#334155] px-3 py-2.5 bg-[#F8FAFC] dark:bg-[#0F172A] min-h-[42px]">
                            {renderTicketHistoryValue(field.type, val || null, field)}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {ticketDrawer.tab === 'details' && !activeTicketFinalized && activeTicketData !== 'loading' && (
                <div className="space-y-4">
                  {activeTicketFields.map(field => {
                    if (field.id === undefined) return null
                    return (
                      <div key={field.id}>
                        <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">
                          {field.label}
                          {field.required && <span className="text-red-500 ml-0.5">*</span>}
                        </label>
                        <TicketFieldEditor
                          field={field}
                          value={activeTicketEdits[field.id] ?? (activeTicketDraft ? (activeTicketDraft.values.find(v => v.fieldId === field.id)?.value ?? '') : '')}
                          onChange={v => setTicketEdits(prev => ({
                            ...prev,
                            [activeTicketKey ?? ticketKey(activeTicketResponse.id, activeTicketTemplateId ?? 0)]: {
                              ...(prev[activeTicketKey ?? ticketKey(activeTicketResponse.id, activeTicketTemplateId ?? 0)] ?? {}),
                              [field.id as number]: v,
                            },
                          }))}
                        />
                      </div>
                    )
                  })}
                  {activeTicketSave === 'error' && (
                    <p className="text-xs text-red-500">Failed to save. Please try again.</p>
                  )}
                  <div className="flex items-center gap-3 pt-1 flex-wrap">
                    <button
                      type="button"
                      onClick={() => activeTicketTemplateId !== null ? void handleSaveTicketDraft(activeTicketResponse.id, activeTicketTemplateId) : undefined}
                      disabled={activeTicketSave === 'saving'}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
                    >
                      <Save size={13} />
                      {activeTicketSave === 'saving' ? 'Saving…' : activeTicketSave === 'saved' ? 'Saved!' : 'Save Draft'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowFinalizeConfirm(activeTicketKey)}
                      disabled={activeTicketFinalizing}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-green-600 text-green-700 dark:text-green-400 text-sm font-medium hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 transition-colors"
                    >
                      <Lock size={13} />
                      Close
                    </button>
                  </div>
                  {showFinalizeConfirm === activeTicketKey && (
                    <div className="rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-3">
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Close this ticket?</p>
                      <p className="text-xs text-amber-700 dark:text-amber-400">Closing marks the ticket as done. It can be re-opened at any time.</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => activeTicketTemplateId !== null ? void handleFinalizeTicket(activeTicketResponse.id, activeTicketTemplateId) : undefined}
                          disabled={activeTicketFinalizing}
                          className="px-3 py-1.5 rounded bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          {activeTicketFinalizing ? 'Closing…' : 'Yes, Close'}
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

              {ticketDrawer.tab === 'history' && activeTicketHistory === 'loading' && (
                <p className="text-sm text-[#94A3B8]">Loading history…</p>
              )}

              {ticketDrawer.tab === 'history' && activeTicketHistory !== 'loading' && (
                <div className="space-y-3">
                  {activeTicketHistoryError && (
                    <div className="rounded border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                      {activeTicketHistoryError}
                    </div>
                  )}

                  {(activeTicketHistory ?? []).length === 0 && (
                    <div className="rounded border border-dashed border-[#CBD5E1] dark:border-[#334155] px-4 py-6 text-sm text-[#94A3B8] text-center">
                      No ticket history yet.
                    </div>
                  )}

                  {(activeTicketHistory ?? []).map(entry => {
                    const isFieldChange = entry.eventType === 'field_changed'
                    const eventLabel = entry.eventType === 'ticket_closed'
                      ? 'Closed ticket'
                      : entry.eventType === 'ticket_reopened'
                        ? 'Re-opened ticket'
                        : `Updated ${entry.fieldLabel ?? 'field'}`

                    return (
                      <div key={entry.id} className="rounded-lg border border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A] p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 text-sm font-medium text-[#1E293B] dark:text-[#F1F5F9]">
                              <ClipboardList size={14} className="text-[#2563EB]" />
                              {eventLabel}
                            </div>
                            <p className="mt-1 text-xs text-[#64748B]">
                              {entry.changedByName ?? 'Unknown user'} · {formatTicketHistoryTimestamp(entry.changedAt)}
                            </p>
                          </div>
                          <span className="inline-flex items-center rounded-[2px] bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] px-2 py-0.5 text-[11px] font-medium text-[#64748B]">
                            {entry.eventType === 'field_changed' ? 'Field change' : 'Status'}
                          </span>
                        </div>

                        {isFieldChange ? (
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="rounded border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#1E293B] p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8] mb-2">Previous</p>
                              {renderTicketHistoryValue(entry.fieldType, entry.oldValue)}
                            </div>
                            <div className="rounded border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#1E293B] p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8] mb-2">New</p>
                              {renderTicketHistoryValue(entry.fieldType, entry.newValue)}
                            </div>
                          </div>
                        ) : (
                          <div className="rounded border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#1E293B] p-3 text-sm text-[#1E293B] dark:text-[#F1F5F9]">
                            {renderTicketHistoryValue(entry.fieldType, entry.newValue)}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* ── Tickets view ─────────────────────────────────────────────────── */}
      {view === 'tickets' && selectedCollection && (
        <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
          {(() => {
            return (
              <>
                <div className="px-5 py-3 border-b border-[#E2E8F0] dark:border-[#334155] space-y-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-medium text-[#475569] dark:text-[#94A3B8]">Tickets:</span>
                    <button
                      type="button"
                      onClick={() => setTicketTemplateFilter('all')}
                      className={[
                        'px-3 py-1 rounded-[2px] text-xs font-medium transition-colors',
                        ticketTemplateFilter === 'all'
                          ? 'bg-[#2563EB] text-white'
                          : 'bg-[#F1F5F9] dark:bg-[#0F172A] text-[#475569] dark:text-[#94A3B8] hover:bg-[#E2E8F0] dark:hover:bg-[#1E293B]',
                      ].join(' ')}
                    >
                      All
                    </button>
                    {collectionTicketTemplates.map(template => (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => setTicketTemplateFilter(template.id)}
                        className={[
                          'px-3 py-1 rounded-[2px] text-xs font-medium transition-colors',
                          ticketTemplateFilter === template.id
                            ? 'bg-[#2563EB] text-white'
                            : 'bg-[#F1F5F9] dark:bg-[#0F172A] text-[#475569] dark:text-[#94A3B8] hover:bg-[#E2E8F0] dark:hover:bg-[#1E293B]',
                        ].join(' ')}
                      >
                        {template.title}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
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
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-xs text-[#94A3B8]">
                        {filteredTickets.length} ticket{filteredTickets.length !== 1 ? 's' : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const temps =
                            ticketTemplateFilter === 'all'
                              ? collectionTicketTemplates
                              : collectionTicketTemplates.filter(t => t.id === ticketTemplateFilter)
                          temps.forEach(t => loadTicketFields(t.id))
                          setView('ticket-export')
                        }}
                        disabled={filteredTickets.length === 0}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-[#2563EB] text-[#2563EB] text-xs font-medium hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 transition-colors"
                      >
                        <Download size={12} />
                        Export
                      </button>
                    </div>
                  </div>
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

                {!ticketsLoading && allTickets.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A]">
                          <th className="text-left px-4 py-2.5 font-medium text-[#64748B] text-xs uppercase tracking-wide whitespace-nowrap">Submission</th>
                          <th className="text-left px-4 py-2.5 font-medium text-[#64748B] text-xs uppercase tracking-wide whitespace-nowrap">Submitted</th>
                          <th className="text-left px-4 py-2.5 font-medium text-[#64748B] text-xs uppercase tracking-wide whitespace-nowrap">Status</th>
                          <th className="text-left px-4 py-2.5 font-medium text-[#64748B] text-xs uppercase tracking-wide whitespace-nowrap">Ticket</th>
                          <th className="text-left px-4 py-2.5 font-medium text-[#64748B] text-xs uppercase tracking-wide whitespace-nowrap max-w-[260px]">Values</th>
                          <th className="text-left px-4 py-2.5 font-medium text-[#64748B] text-xs uppercase tracking-wide whitespace-nowrap">Closed by</th>
                          <th className="px-4 py-2.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTickets.map((ticket, i) => {
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
                              <td className="px-4 py-3 text-[#1E293B] dark:text-[#F1F5F9] whitespace-nowrap">{ticket.ticketTitle ?? 'Ticket'}</td>
                              <td className="px-4 py-3 text-[#475569] dark:text-[#94A3B8] max-w-[260px] truncate">
                                {ticket.values.length > 0
                                  ? `${ticket.values.filter(value => value.value && value.value.trim() !== '').length} populated field${ticket.values.filter(value => value.value && value.value.trim() !== '').length === 1 ? '' : 's'}`
                                  : <span className="text-[#CBD5E1] italic">—</span>}
                              </td>
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
                                      if (ticket.ticketTemplateId) {
                                        openTicketDrawer(ticket.collectionResponseId, ticket.ticketTemplateId)
                                      }
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
                  </div>
                )}

                {!ticketsLoading && allTickets.length > 0 && filteredTickets.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-32 gap-2 text-[#94A3B8] border-t border-[#E2E8F0] dark:border-[#334155]">
                    <Clipboard size={28} className="opacity-40" />
                    <p className="text-sm">No tickets match the selected filters.</p>
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}

      {/* ── Ticket export preview ─────────────────────────────────────────── */}
      {view === 'ticket-export' && selectedCollection && (() => {
        const exportTemplates =
          ticketTemplateFilter === 'all'
            ? collectionTicketTemplates
            : collectionTicketTemplates.filter(t => t.id === ticketTemplateFilter)
        const multipleTemplates = exportTemplates.length > 1
        const exportFieldColumns: Array<{ header: string; templateId: number; fieldId: number; field: TicketField }> = []
        exportTemplates.forEach(template => {
          const fields = ticketFieldsByTemplate[template.id]
          if (!fields || fields === 'loading') return
          fields.forEach(field => {
            if (field.id === undefined) return
            const header = multipleTemplates ? `${template.title}: ${field.label}` : field.label
            exportFieldColumns.push({ header, templateId: template.id, fieldId: field.id, field })
          })
        })
        const fieldsLoading = exportTemplates.some(
          t => ticketFieldsByTemplate[t.id] === 'loading' || ticketFieldsByTemplate[t.id] === undefined,
        )
        const activeTemplateName =
          ticketTemplateFilter !== 'all'
            ? collectionTicketTemplates.find(t => t.id === ticketTemplateFilter)?.title ?? null
            : null

        return (
          <div className="space-y-4">
            <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setView('tickets')}
                  className="inline-flex items-center gap-1.5 text-sm text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9] transition-colors"
                >
                  ← Back to Tickets
                </button>
                <span className="text-[#CBD5E1] dark:text-[#475569] select-none">|</span>
                <span className="text-sm font-medium text-[#1E293B] dark:text-[#F1F5F9]">
                  {selectedCollection.title}
                </span>
                {(activeTemplateName || ticketStatusFilter !== 'all') && (
                  <span className="text-xs text-[#64748B]">
                    —
                    {activeTemplateName ? ` Template: ${activeTemplateName}` : ''}
                    {ticketStatusFilter !== 'all'
                      ? ` · Status: ${ticketStatusFilter.charAt(0).toUpperCase() + ticketStatusFilter.slice(1)}`
                      : ''}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() =>
                  downloadTicketsCsv(selectedCollection, filteredTickets, exportTemplates, ticketFieldsByTemplate)
                }
                disabled={filteredTickets.length === 0 || fieldsLoading}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded bg-[#2563EB] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                <Download size={14} />
                Export to CSV
              </button>
            </div>

            <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
              {filteredTickets.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 gap-2 text-[#94A3B8]">
                  <Clipboard size={28} className="opacity-40" />
                  <p className="text-sm">No tickets to preview.</p>
                </div>
              ) : fieldsLoading ? (
                <div className="flex items-center justify-center h-32 text-[#64748B] text-sm">
                  Loading ticket fields…
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A]">
                        <th className="text-left px-4 py-2.5 font-medium text-[#64748B] text-xs uppercase tracking-wide whitespace-nowrap">Submission</th>
                        <th className="text-left px-4 py-2.5 font-medium text-[#64748B] text-xs uppercase tracking-wide whitespace-nowrap">Submitted At</th>
                        <th className="text-left px-4 py-2.5 font-medium text-[#64748B] text-xs uppercase tracking-wide whitespace-nowrap">Status</th>
                        <th className="text-left px-4 py-2.5 font-medium text-[#64748B] text-xs uppercase tracking-wide whitespace-nowrap">Ticket Type</th>
                        <th className="text-left px-4 py-2.5 font-medium text-[#64748B] text-xs uppercase tracking-wide whitespace-nowrap">Closed By</th>
                        <th className="text-left px-4 py-2.5 font-medium text-[#64748B] text-xs uppercase tracking-wide whitespace-nowrap">Closed At</th>
                        {exportFieldColumns.map(col => (
                          <th
                            key={`${col.templateId}-${col.fieldId}`}
                            className="text-left px-4 py-2.5 font-medium text-[#64748B] text-xs uppercase tracking-wide whitespace-nowrap"
                          >
                            {col.header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTickets.map((ticket, i) => {
                        const submitter =
                          ticket.submitterName ?? ticket.submitterEmail ?? `#${ticket.collectionResponseId}`
                        const submittedLabel = ticket.submittedAt ? formatSubmittedAt(ticket.submittedAt) : '—'
                        const closedAtLabel = ticket.finalizedAt ? formatSubmittedAt(ticket.finalizedAt) : '—'
                        return (
                          <tr
                            key={ticket.id}
                            className={[
                              'border-b border-[#E2E8F0] dark:border-[#334155] last:border-0',
                              i % 2 === 1 ? 'bg-[#F8FAFC] dark:bg-[#0F172A]/50' : '',
                            ].join(' ')}
                          >
                            <td className="px-4 py-3 text-[#1E293B] dark:text-[#F1F5F9] font-medium whitespace-nowrap">
                              {submitter}
                            </td>
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
                            <td className="px-4 py-3 text-[#1E293B] dark:text-[#F1F5F9] whitespace-nowrap">
                              {ticket.ticketTitle ?? '—'}
                            </td>
                            <td className="px-4 py-3 text-[#64748B] whitespace-nowrap text-xs">
                              {ticket.finalizedByName ?? '—'}
                            </td>
                            <td className="px-4 py-3 text-[#64748B] whitespace-nowrap text-xs">{closedAtLabel}</td>
                            {exportFieldColumns.map(col => {
                              const val =
                                col.templateId === ticket.ticketTemplateId
                                  ? (ticket.values.find(v => v.fieldId === col.fieldId)?.value ?? null)
                                  : null
                              return (
                                <td
                                  key={`${col.templateId}-${col.fieldId}`}
                                  className="px-4 py-3 text-[#475569] dark:text-[#94A3B8] max-w-[200px] truncate"
                                >
                                  {formatTicketFieldValueForCsv(col.field, val) || '—'}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}