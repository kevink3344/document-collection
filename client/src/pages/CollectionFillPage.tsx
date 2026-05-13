import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { Calendar, Tag, User, CheckCircle, AlertCircle, Maximize2, X, History, ArrowLeft } from 'lucide-react'
import { getPublicCollection, submitResponse } from '../api/collections'
import { updateMySubmission } from '../api/mySubmissions'
import { getPublicSetting } from '../api/settings'
import { toEmbedUrl } from '../utils/docPreviewUrl'
import { sanitizeRichText } from '../utils/richText'
import { useAuth } from '../contexts/AuthContext'
import RichTextEditor from '../components/common/RichTextEditor'
import QRCode from 'qrcode'
import type { Collection, CollectionField } from '../types'

// ── Style tokens ──────────────────────────────────────────────

const INPUT =
  'w-full border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0F172A] ' +
  'text-[#1E293B] dark:text-[#F1F5F9] placeholder-[#94A3B8] px-3 py-2 text-sm rounded ' +
  'focus:outline-none focus:ring-2 focus:ring-[#2563EB]'

const LABEL = 'block text-sm font-medium text-[#1E293B] dark:text-[#F1F5F9] mb-1'
const OTHER_OPTION_MARKER = '__DCP_OTHER_OPTION__'
const OTHER_RESPONSE_PREFIX = '__DCP_OTHER__::'

function normalizePage(page: number | string | null | undefined): number {
  const n = typeof page === 'number' ? page : Number(page)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}

// ── Draft persistence ─────────────────────────────────────────

interface FormDraft {
  respName: string
  respEmail: string
  values: Record<number, string>
  currentPageIdx: number
  savedAt: string
}

function draftKey(slug: string) {
  return `dcp_draft_${slug}`
}

function loadDraft(slug: string): FormDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(slug))
    if (!raw) return null
    return JSON.parse(raw) as FormDraft
  } catch {
    return null
  }
}

function saveDraft(slug: string, draft: Omit<FormDraft, 'savedAt'>) {
  try {
    const full: FormDraft = { ...draft, savedAt: new Date().toISOString() }
    localStorage.setItem(draftKey(slug), JSON.stringify(full))
  } catch {
    // Ignore storage quota errors silently.
  }
}

function clearDraft(slug: string) {
  try {
    localStorage.removeItem(draftKey(slug))
  } catch {
    // ignore
  }
}

function hasOtherOption(field: CollectionField): boolean {
  return (field.options ?? []).includes(OTHER_OPTION_MARKER)
}

function encodeOtherResponse(text: string): string {
  return `${OTHER_RESPONSE_PREFIX}${text}`
}

function decodeOtherResponse(value: string): string {
  return value.startsWith(OTHER_RESPONSE_PREFIX)
    ? value.slice(OTHER_RESPONSE_PREFIX.length)
    : ''
}

function isOtherResponse(value: string): boolean {
  return value.startsWith(OTHER_RESPONSE_PREFIX)
}

function getFieldLogicKey(field: CollectionField, fallbackIndex: number): string {
  return field.fieldKey?.trim() || `field-${field.id ?? fallbackIndex}`
}

function sortFields(fields: CollectionField[]): CollectionField[] {
  return [...fields].sort((left, right) => {
    const leftPage = normalizePage(left.page)
    const rightPage = normalizePage(right.page)
    if (leftPage !== rightPage) return leftPage - rightPage
    return left.sortOrder - right.sortOrder
  })
}

function resolveSingleChoiceBranchTarget(field: CollectionField, value: string): string | null {
  if (field.type !== 'single_choice' || !value || isOtherResponse(value)) return null
  const match = (field.branchRules ?? []).find(rule => rule.value === value)
  return match?.targetFieldKey ?? null
}

function computeVisibleFields(fields: CollectionField[], values: Record<number, string>): CollectionField[] {
  const ordered = sortFields(fields)
  const logicKeyToIndex = new Map(ordered.map((field, index) => [getFieldLogicKey(field, index), index]))
  const visibleIndexes = new Set<number>()
  let index = 0
  let guard = 0

  while (index < ordered.length && guard < ordered.length * 2) {
    guard += 1
    const field = ordered[index]
    visibleIndexes.add(index)

    if (field.id !== undefined) {
      const targetKey = resolveSingleChoiceBranchTarget(field, values[field.id] ?? '')
      if (targetKey) {
        const targetIndex = logicKeyToIndex.get(targetKey)
        if (targetIndex !== undefined && targetIndex > index) {
          index = targetIndex
          continue
        }
      }
    }

    index += 1
  }

  return ordered.filter((_, idx) => visibleIndexes.has(idx))
}

// ── Signature canvas ──────────────────────────────────────────

function SignaturePad({
  value,
  onChange,
}: {
  value: string
  onChange: (dataUrl: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    if (value) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0)
      img.src = value
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const getPos = (
    e: React.MouseEvent | React.TouchEvent
  ): { x: number; y: number } => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    if ('touches' in e) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      }
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    drawing.current = true
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = getPos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current) return
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    e.preventDefault()
    const { x, y } = getPos(e)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#1E293B'
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  const stopDraw = () => {
    if (!drawing.current) return
    drawing.current = false
    onChange(canvasRef.current?.toDataURL('image/png') ?? '')
  }

  const clear = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    onChange('')
  }

  return (
    <div className="space-y-1">
      <canvas
        ref={canvasRef}
        width={400}
        height={140}
        className="w-full rounded border border-[#E2E8F0] dark:border-[#334155] cursor-crosshair touch-none bg-white"
        onMouseDown={startDraw}
        onMouseMove={draw}
        onMouseUp={stopDraw}
        onMouseLeave={stopDraw}
        onTouchStart={startDraw}
        onTouchMove={draw}
        onTouchEnd={stopDraw}
      />
      <button
        type="button"
        onClick={clear}
        className="text-xs text-[#94A3B8] hover:text-[#64748B] transition-colors"
      >
        Clear signature
      </button>
    </div>
  )
}

interface MatrixLikertScaleInputProps {
  field: CollectionField
  value: string
  onChange: (v: string) => void
  disabled: boolean
}

function MatrixLikertScaleInput({ field, value, onChange, disabled }: MatrixLikertScaleInputProps) {
  let config: { rows: string[]; columns: string[] } | null = null
  try {
    if (field.options && field.options.length > 0 && typeof field.options[0] === 'string') {
      config = JSON.parse(field.options[0])
    }
  } catch {
    // Fail silently
  }

  if (!config) {
    return <div className="text-xs text-red-500">Invalid matrix configuration</div>
  }

  let responses: Record<number, string> = {}
  try {
    responses = value ? (JSON.parse(value) as Record<number, string>) : {}
  } catch {
    responses = {}
  }

  function handleRowSelect(rowIdx: number, colLabel: string) {
    const updated = { ...responses, [rowIdx]: colLabel }
    onChange(JSON.stringify(updated))
  }

  const fieldNameSeed = String(field.id ?? field.label ?? 'matrix')

  function radioGroupName(view: 'mobile' | 'desktop', rowIdx: number) {
    return `matrix-${fieldNameSeed}-${view}-row-${rowIdx}`
  }

  return (
    <div className="space-y-3">
      <div className="md:hidden space-y-3">
        {config.rows.map((row, rowIdx) => (
          <div
            key={rowIdx}
            className="rounded-lg border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#0B1220] p-3"
          >
            <p className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">{row}</p>
            <div className="mt-2 space-y-2">
              {config.columns.map((col, colIdx) => (
                <label
                  key={colIdx}
                  className="flex items-start gap-2 rounded border border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A] px-3 py-2"
                >
                  <input
                    type="radio"
                    name={radioGroupName('mobile', rowIdx)}
                    value={col}
                    checked={responses[rowIdx] === col}
                    onChange={() => handleRowSelect(rowIdx, col)}
                    className="mt-0.5 accent-[#2563EB]"
                    disabled={disabled}
                  />
                  <span className="text-sm text-[#334155] dark:text-[#CBD5E1]">{col}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="hidden md:block overflow-x-auto">
        <table className="border-collapse border border-[#CBD5E1] dark:border-[#334155] text-sm w-full">
          <thead>
            <tr>
              <th className="border border-[#CBD5E1] dark:border-[#334155] bg-[#F1F5F9] dark:bg-[#0F172A] p-3 text-left font-semibold text-[#1E293B] dark:text-[#F1F5F9]" />
              {config.columns.map((col, i) => (
                <th
                  key={i}
                  className="border border-[#CBD5E1] dark:border-[#334155] bg-[#F1F5F9] dark:bg-[#0F172A] p-3 text-left font-semibold text-[#1E293B] dark:text-[#F1F5F9] max-w-xs"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {config.rows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                <td className="border border-[#CBD5E1] dark:border-[#334155] bg-[#F1F5F9] dark:bg-[#0F172A] p-3 font-medium text-[#1E293B] dark:text-[#F1F5F9]">
                  {row}
                </td>
                {config.columns.map((col, colIdx) => (
                  <td
                    key={colIdx}
                    className="border border-[#CBD5E1] dark:border-[#334155] p-3 text-center"
                  >
                    <label className="flex items-center justify-center cursor-pointer">
                      <input
                        type="radio"
                        name={radioGroupName('desktop', rowIdx)}
                        value={col}
                        checked={responses[rowIdx] === col}
                        onChange={() => handleRowSelect(rowIdx, col)}
                        className="accent-[#2563EB]"
                        disabled={disabled}
                      />
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Custom table input ────────────────────────────────────────

interface TableRow {
  [colName: string]: string
}

function CustomTableInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: CollectionField
  value: string
  onChange: (v: string) => void
  disabled: boolean
}) {
  const columns = field.tableColumns ?? []
  const [rows, setRows] = useState<TableRow[]>(() => {
    try {
      const parsed = value ? (JSON.parse(value) as TableRow[]) : []
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : [{}]
    } catch {
      return [{}]
    }
  })
  const [editorOpen, setEditorOpen] = useState(false)
  const [draftRows, setDraftRows] = useState<TableRow[]>([])
  const [hasDraftChanges, setHasDraftChanges] = useState(false)

  useEffect(() => {
    if (editorOpen) return
    try {
      const parsed = value ? (JSON.parse(value) as TableRow[]) : []
      setRows(Array.isArray(parsed) && parsed.length > 0 ? parsed : [{}])
    } catch {
      setRows([{}])
    }
  }, [value, editorOpen])

  const update = useCallback(
    (newRows: TableRow[]) => {
      setRows(newRows)
      onChange(JSON.stringify(newRows))
    },
    [onChange]
  )

  function setCell(rowIdx: number, col: string, val: string) {
    update(rows.map((r, i) => (i === rowIdx ? { ...r, [col]: val } : r)))
  }

  function getListOptions(colName: string): string[] {
    const column = columns.find(c => c.name === colName)
    if (!column || column.colType !== 'list') return []
    return (column.listOptions ?? []).map(opt => opt.trim()).filter(Boolean)
  }

  function openEditor() {
    setDraftRows(rows.map(row => ({ ...row })))
    setHasDraftChanges(false)
    setEditorOpen(true)
  }

  function closeEditor() {
    if (hasDraftChanges) {
      const shouldDiscard = window.confirm('Discard unsaved table edits?')
      if (!shouldDiscard) return
    }
    setEditorOpen(false)
  }

  function setDraftCell(rowIdx: number, col: string, val: string) {
    setDraftRows(prev => prev.map((row, i) => (i === rowIdx ? { ...row, [col]: val } : row)))
    setHasDraftChanges(true)
  }

  function addDraftRow() {
    setDraftRows(prev => [...prev, {}])
    setHasDraftChanges(true)
  }

  function removeDraftRow(rowIdx: number) {
    setDraftRows(prev => {
      if (prev.length === 1) return prev
      return prev.filter((_, i) => i !== rowIdx)
    })
    setHasDraftChanges(true)
  }

  function saveDraftRows() {
    update(draftRows.length > 0 ? draftRows : [{}])
    setEditorOpen(false)
    setHasDraftChanges(false)
  }

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-[#64748B]">{rows.length} row{rows.length !== 1 ? 's' : ''}</p>
          <button
            type="button"
            onClick={openEditor}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 text-xs border border-[#CBD5E1] dark:border-[#334155] text-[#475569] dark:text-[#CBD5E1] px-2.5 py-1 rounded-[2px] hover:bg-[#F8FAFC] dark:hover:bg-[#1E293B] transition-colors disabled:opacity-50"
          >
            <Maximize2 size={12} />
            Spreadsheet mode
          </button>
        </div>

        <div className="overflow-x-auto border border-[#E2E8F0] dark:border-[#334155] rounded-[2px]">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                {columns.map(col => (
                  <th
                    key={col.name}
                    className="text-left text-xs font-medium text-[#64748B] border-b border-[#E2E8F0] dark:border-[#334155] px-2 py-1.5 bg-[#F8FAFC] dark:bg-[#0F172A]"
                  >
                    {col.name}
                  </th>
                ))}
                <th className="w-8 border-b border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A]" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {columns.map(col => (
                    <td
                      key={col.name}
                      className="border-b border-[#E2E8F0] dark:border-[#334155] p-1"
                    >
                      {col.colType === 'checkbox' ? (
                        <input
                          type="checkbox"
                          checked={row[col.name] === 'true'}
                          onChange={e =>
                            setCell(ri, col.name, e.target.checked ? 'true' : 'false')
                          }
                          className="accent-[#2563EB] w-4 h-4"
                          disabled={disabled}
                        />
                      ) : (
                        col.colType === 'list' ? (
                          <select
                            value={row[col.name] ?? ''}
                            onChange={e => setCell(ri, col.name, e.target.value)}
                            className="w-full bg-transparent text-[#1E293B] dark:text-[#F1F5F9] text-sm focus:outline-none px-1"
                            disabled={disabled}
                          >
                            <option value="">Select…</option>
                            {getListOptions(col.name).map(option => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={col.colType === 'number' ? 'number' : col.colType === 'date' ? 'date' : 'text'}
                            value={row[col.name] ?? ''}
                            onChange={e => setCell(ri, col.name, e.target.value)}
                            className="w-full bg-transparent text-[#1E293B] dark:text-[#F1F5F9] text-sm focus:outline-none px-1"
                            disabled={disabled}
                          />
                        )
                      )}
                    </td>
                  ))}
                  <td className="border-b border-[#E2E8F0] dark:border-[#334155] text-center">
                    <button
                      type="button"
                      onClick={() => update(rows.filter((_, i) => i !== ri))}
                      disabled={rows.length === 1 || disabled}
                      className="text-[#94A3B8] hover:text-red-500 disabled:opacity-30 transition-colors text-xs px-1"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          onClick={() => update([...rows, {}])}
          className="text-xs text-[#2563EB] hover:underline"
          disabled={disabled}
        >
          + Add row
        </button>
      </div>

      {editorOpen && (
        <div className="fixed inset-0 z-50 bg-[#FAFAFA] dark:bg-[#0F172A] flex flex-col">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0F172A]">
            <div>
              <h3 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">{field.label}</h3>
              <p className="text-xs text-[#64748B]">Spreadsheet mode</p>
            </div>
            <button
              type="button"
              onClick={closeEditor}
              className="w-8 h-8 rounded-[2px] flex items-center justify-center text-[#64748B] hover:bg-[#F1F5F9] dark:hover:bg-[#1E293B]"
              aria-label="Close spreadsheet mode"
            >
              <X size={15} />
            </button>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-3">
            {columns.length > 3 && (
              <p className="text-xs text-[#64748B] md:hidden">
                Mobile view uses row cards for easier editing with many columns.
              </p>
            )}

            {columns.length > 3 ? (
              <>
                <div className="md:hidden space-y-3">
                  {draftRows.map((row, rowIndex) => (
                    <div
                      key={`card-row-${rowIndex}`}
                      className="rounded-[2px] border border-[#E2E8F0] dark:border-[#334155] p-3 space-y-2 bg-[#F8FAFC] dark:bg-[#0F172A]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-[#64748B]">Row {rowIndex + 1}</span>
                        <button
                          type="button"
                          onClick={() => removeDraftRow(rowIndex)}
                          disabled={draftRows.length === 1}
                          className="text-xs text-red-500 disabled:opacity-30"
                        >
                          Remove
                        </button>
                      </div>
                      {columns.map(col => (
                        <label key={col.name} className="block space-y-1">
                          <span className="text-xs text-[#64748B]">{col.name}</span>
                          {col.colType === 'checkbox' ? (
                            <input
                              type="checkbox"
                              checked={row[col.name] === 'true'}
                              onChange={e =>
                                setDraftCell(
                                  rowIndex,
                                  col.name,
                                  e.target.checked ? 'true' : 'false'
                                )
                              }
                              className="accent-[#2563EB] w-4 h-4"
                            />
                          ) : (
                            col.colType === 'list' ? (
                              <select
                                value={row[col.name] ?? ''}
                                onChange={e => setDraftCell(rowIndex, col.name, e.target.value)}
                                className={INPUT}
                              >
                                <option value="">Select…</option>
                                {getListOptions(col.name).map(option => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type={col.colType === 'number' ? 'number' : col.colType === 'date' ? 'date' : 'text'}
                                value={row[col.name] ?? ''}
                                onChange={e => setDraftCell(rowIndex, col.name, e.target.value)}
                                className={INPUT}
                              />
                            )
                          )}
                        </label>
                      ))}
                    </div>
                  ))}
                </div>

                <div className="hidden md:block overflow-x-auto">
                  <table className="min-w-full w-max text-sm border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr>
                        {columns.map(col => (
                          <th
                            key={col.name}
                            className="text-left text-xs font-medium text-[#64748B] border border-[#E2E8F0] dark:border-[#334155] px-2 py-1.5 bg-[#F8FAFC] dark:bg-[#0F172A]"
                          >
                            {col.name}
                          </th>
                        ))}
                        <th className="w-16 border border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A]" />
                      </tr>
                    </thead>
                    <tbody>
                      {draftRows.map((row, rowIndex) => (
                        <tr key={`table-row-${rowIndex}`}>
                          {columns.map(col => (
                            <td key={col.name} className="border border-[#E2E8F0] dark:border-[#334155] p-1">
                              {col.colType === 'checkbox' ? (
                                <input
                                  type="checkbox"
                                  checked={row[col.name] === 'true'}
                                  onChange={e =>
                                    setDraftCell(
                                      rowIndex,
                                      col.name,
                                      e.target.checked ? 'true' : 'false'
                                    )
                                  }
                                  className="accent-[#2563EB] w-4 h-4"
                                />
                              ) : (
                                col.colType === 'list' ? (
                                  <select
                                    value={row[col.name] ?? ''}
                                    onChange={e => setDraftCell(rowIndex, col.name, e.target.value)}
                                    className="min-w-[140px] w-full bg-transparent text-[#1E293B] dark:text-[#F1F5F9] text-sm focus:outline-none px-1"
                                  >
                                    <option value="">Select…</option>
                                    {getListOptions(col.name).map(option => (
                                      <option key={option} value={option}>
                                        {option}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    type={col.colType === 'number' ? 'number' : col.colType === 'date' ? 'date' : 'text'}
                                    value={row[col.name] ?? ''}
                                    onChange={e => setDraftCell(rowIndex, col.name, e.target.value)}
                                    className="min-w-[140px] w-full bg-transparent text-[#1E293B] dark:text-[#F1F5F9] text-sm focus:outline-none px-1"
                                  />
                                )
                              )}
                            </td>
                          ))}
                          <td className="border border-[#E2E8F0] dark:border-[#334155] text-center">
                            <button
                              type="button"
                              onClick={() => removeDraftRow(rowIndex)}
                              disabled={draftRows.length === 1}
                              className="text-[#94A3B8] hover:text-red-500 disabled:opacity-30 transition-colors text-xs px-1"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full w-max text-sm border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      {columns.map(col => (
                        <th
                          key={col.name}
                          className="text-left text-xs font-medium text-[#64748B] border border-[#E2E8F0] dark:border-[#334155] px-2 py-1.5 bg-[#F8FAFC] dark:bg-[#0F172A]"
                        >
                          {col.name}
                        </th>
                      ))}
                      <th className="w-16 border border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A]" />
                    </tr>
                  </thead>
                  <tbody>
                    {draftRows.map((row, rowIndex) => (
                      <tr key={`simple-row-${rowIndex}`}>
                        {columns.map(col => (
                          <td key={col.name} className="border border-[#E2E8F0] dark:border-[#334155] p-1">
                            {col.colType === 'checkbox' ? (
                              <input
                                type="checkbox"
                                checked={row[col.name] === 'true'}
                                onChange={e =>
                                  setDraftCell(
                                    rowIndex,
                                    col.name,
                                    e.target.checked ? 'true' : 'false'
                                  )
                                }
                                className="accent-[#2563EB] w-4 h-4"
                              />
                            ) : (
                              col.colType === 'list' ? (
                                <select
                                  value={row[col.name] ?? ''}
                                  onChange={e => setDraftCell(rowIndex, col.name, e.target.value)}
                                  className="min-w-[140px] w-full bg-transparent text-[#1E293B] dark:text-[#F1F5F9] text-sm focus:outline-none px-1"
                                >
                                  <option value="">Select…</option>
                                  {getListOptions(col.name).map(option => (
                                    <option key={option} value={option}>
                                      {option}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type={col.colType === 'number' ? 'number' : col.colType === 'date' ? 'date' : 'text'}
                                  value={row[col.name] ?? ''}
                                  onChange={e => setDraftCell(rowIndex, col.name, e.target.value)}
                                  className="min-w-[140px] w-full bg-transparent text-[#1E293B] dark:text-[#F1F5F9] text-sm focus:outline-none px-1"
                                />
                              )
                            )}
                          </td>
                        ))}
                        <td className="border border-[#E2E8F0] dark:border-[#334155] text-center">
                          <button
                            type="button"
                            onClick={() => removeDraftRow(rowIndex)}
                            disabled={draftRows.length === 1}
                            className="text-[#94A3B8] hover:text-red-500 disabled:opacity-30 transition-colors text-xs px-1"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0F172A]">
            <button
              type="button"
              onClick={addDraftRow}
              className="text-xs text-[#2563EB] hover:underline"
            >
              + Add row
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={closeEditor}
                className="border border-[#CBD5E1] dark:border-[#334155] text-[#475569] dark:text-[#94A3B8] px-3 py-1.5 text-xs rounded-[2px] hover:bg-[#F8FAFC] dark:hover:bg-[#1E293B]"
              >
                Back to form
              </button>
              <button
                type="button"
                onClick={saveDraftRows}
                className="bg-[#2563EB] hover:bg-blue-700 text-white px-3 py-1.5 text-xs rounded-[2px]"
              >
                Save rows
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Main fill page ────────────────────────────────────────────

export default function CollectionFillPage() {
  const { slug } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const isPreview = searchParams.get('preview') === 'true'
  const editResponseId = useMemo(() => {
    const raw = searchParams.get('edit')
    if (!raw) return null
    const n = parseInt(raw, 10)
    return Number.isNaN(n) ? null : n
  }, [searchParams])
  const { user } = useAuth()

  const [collection, setCollection] = useState<Collection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Respondent identity
  const [respName, setRespName] = useState('')
  const [respEmail, setRespEmail] = useState('')

  // Field values: fieldId → string (JSON for complex types)
  const [values, setValues] = useState<Record<number, string>>({})

  // Submission
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [currentPageIdx, setCurrentPageIdx] = useState(0)
  const [pageError, setPageError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'instructions' | 'questions'>('questions')
  const [isReviewing, setIsReviewing] = useState(false)
  const [formStartedAt, setFormStartedAt] = useState(() => Date.now())
  const [showQrCode, setShowQrCode] = useState(false)
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null)

  // Draft persistence
  const [showResumeBanner, setShowResumeBanner] = useState(false)
  const [pendingDraft, setPendingDraft] = useState<FormDraft | null>(null)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    getPublicCollection(slug, { preview: isPreview })
      .then(col => {
        setCollection(col)
        setCurrentPageIdx(0)
        setPageError(null)
        setSubmitError(null)
        setIsReviewing(false)
        setFormStartedAt(Date.now())
        setActiveTab(col.instructions?.trim() || col.instructionsDocUrl ? 'instructions' : 'questions')
        // Initialise default values
        const defaults: Record<number, string> = {}
        col.fields.forEach(f => {
          if (f.id !== undefined) defaults[f.id] = ''
        })
        setValues(defaults)
        // Check for a saved draft; otherwise pre-fill from logged-in user
        const draft = loadDraft(slug)
        if (draft && editResponseId) {
          // Edit mode: auto-apply draft without showing the resume banner
          setRespName(draft.respName || (user?.name ?? ''))
          setRespEmail(draft.respEmail || (user?.email ?? ''))
          setValues(draft.values)
          setCurrentPageIdx(draft.currentPageIdx)
        } else if (draft) {
          setPendingDraft(draft)
          setShowResumeBanner(true)
        } else if (!col.anonymous) {
          if (user?.name) setRespName(user.name)
          if (user?.email) setRespEmail(user.email)
        }
      })
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false))
  }, [slug, isPreview])

  useEffect(() => {
    getPublicSetting('qr_code_enabled')
      .then(value => setShowQrCode(value === 'true'))
      .catch(() => setShowQrCode(false))
  }, [])

  useEffect(() => {
    if (!showQrCode || !collection || !slug) {
      setQrCodeDataUrl(null)
      return
    }

    const surveyUrl = `${window.location.origin}/fill/${collection.slug}`
    QRCode.toDataURL(surveyUrl, {
      width: 132,
      margin: 1,
      color: {
        dark: '#1E293B',
        light: '#FFFFFF',
      },
    })
      .then(setQrCodeDataUrl)
      .catch(() => setQrCodeDataUrl(null))
  }, [collection, showQrCode, slug])

  function setValue(fieldId: number, val: string) {
    setValues(prev => ({ ...prev, [fieldId]: val }))
  }

  const orderedFields = useMemo(() => {
    if (!collection) return [] as CollectionField[]
    return sortFields(collection.fields)
  }, [collection])

  const visibleFields = useMemo(
    () => computeVisibleFields(orderedFields, values),
    [orderedFields, values]
  )

  const pageNumbers = useMemo(() => {
    const pages = new Set<number>()
    visibleFields.forEach(f => pages.add(normalizePage(f.page)))
    const sorted = Array.from(pages).sort((a, b) => a - b)
    return sorted.length > 0 ? sorted : [1]
  }, [visibleFields])

  const totalPages = pageNumbers.length
  const currentPageNumber = pageNumbers[Math.min(currentPageIdx, totalPages - 1)]
  const fieldsOnCurrentPage = visibleFields.filter(
    f => normalizePage(f.page) === currentPageNumber
  )
  const isLastPage = currentPageIdx === totalPages - 1
  const progressRatio = Math.max(0, Math.min(1, (currentPageIdx + 1) / totalPages))
  const progressPercent = Math.round(progressRatio * 100)
  const estimatedTimeRemainingLabel = useMemo(() => {
    const elapsedMs = Math.max(0, Date.now() - formStartedAt)
    const elapsedMinutes = elapsedMs / 60000
    const remainingPages = Math.max(0, totalPages - (currentPageIdx + 1))
    const fallbackMinutes = Math.max(1, Math.ceil(Math.max(remainingPages, 0.5) * 0.75))

    if (progressRatio < 0.2 || elapsedMinutes < 0.25) {
      return `~${fallbackMinutes} min remaining`
    }

    const totalEstimatedMinutes = elapsedMinutes / progressRatio
    const remainingMinutes = Math.max(1, Math.ceil(totalEstimatedMinutes - elapsedMinutes))
    return `~${remainingMinutes} min remaining`
  }, [currentPageIdx, formStartedAt, progressRatio, totalPages])

  useEffect(() => {
    if (currentPageIdx > totalPages - 1) {
      setCurrentPageIdx(Math.max(0, totalPages - 1))
    }
  }, [currentPageIdx, totalPages])

  useEffect(() => {
    const visibleIds = new Set(visibleFields.map(field => field.id).filter((id): id is number => id !== undefined))
    setValues(prev => {
      let changed = false
      const next = { ...prev }
      Object.keys(next).forEach(key => {
        const fieldId = Number(key)
        if (!visibleIds.has(fieldId) && next[fieldId] !== '') {
          next[fieldId] = ''
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [visibleFields])

  // Auto-save draft whenever form state changes, but only after the
  // resume banner has been handled (so we don't overwrite a pending draft).
  useEffect(() => {
    if (!collection || !slug || isPreview || showResumeBanner || submitted || editResponseId) return
    const handle = window.setTimeout(() => {
      saveDraft(slug, { respName, respEmail, values, currentPageIdx })
      setLastSavedAt(new Date().toISOString())
    }, 800)
    return () => window.clearTimeout(handle)
  }, [values, respName, respEmail, currentPageIdx, collection, slug, isPreview, showResumeBanner, submitted])

  function handleResumeDraft() {
    if (!pendingDraft) return
    setRespName(pendingDraft.respName)
    setRespEmail(pendingDraft.respEmail)
    setValues(pendingDraft.values)
    setCurrentPageIdx(pendingDraft.currentPageIdx)
    setIsReviewing(false)
    setFormStartedAt(Date.now())
    setActiveTab('questions')
    setLastSavedAt(pendingDraft.savedAt)
    setPendingDraft(null)
    setShowResumeBanner(false)
  }

  function handleStartFresh() {
    if (slug) clearDraft(slug)
    if (!collection?.anonymous) {
      setRespName(user?.name ?? '')
      setRespEmail(user?.email ?? '')
    }
    setIsReviewing(false)
    setFormStartedAt(Date.now())
    setActiveTab(collection?.instructions?.trim() || collection?.instructionsDocUrl ? 'instructions' : 'questions')
    setLastSavedAt(null)
    setPendingDraft(null)
    setShowResumeBanner(false)
  }

  function getIdentityValidationError(): string | null {
    if (!editResponseId && !collection?.anonymous && (!respName.trim() || !respEmail.trim())) {
      return 'Please enter your name and email address.'
    }
    return null
  }

  function getFirstInvalidVisibleField(): CollectionField | null {
    return visibleFields.find(field => {
      const val = field.id !== undefined ? values[field.id] ?? '' : ''
      return getFieldValidationError(field, val) !== null
    }) ?? null
  }

  function isRequiredFieldFilled(field: CollectionField, value: string): boolean {
    if (!field.required) return true
    switch (field.type) {
      case 'single_choice': {
        if (!value.trim()) return false
        if (hasOtherOption(field) && isOtherResponse(value)) {
          return decodeOtherResponse(value).trim() !== ''
        }
        return true
      }
      case 'multiple_choice':
        try {
          const selected = (JSON.parse(value || '[]') as string[]).filter(Boolean)
          if (selected.length === 0) return false
          const other = selected.find(item => isOtherResponse(item))
          if (!other) return true
          return decodeOtherResponse(other).trim() !== ''
        } catch {
          return false
        }
      case 'confirmation':
        return value === 'true'
      default:
        return value.trim() !== ''
    }
  }

  function getFieldValidationError(field: CollectionField, value: string): string | null {
    if (field.type === 'single_choice' && hasOtherOption(field) && isOtherResponse(value)) {
      if (decodeOtherResponse(value).trim() === '') {
        return 'Please enter a value for Other.'
      }
    }

    if (field.type === 'multiple_choice' && hasOtherOption(field)) {
      try {
        const selected = (JSON.parse(value || '[]') as string[]).filter(Boolean)
        const other = selected.find(item => isOtherResponse(item))
        if (other && decodeOtherResponse(other).trim() === '') {
          return 'Please enter a value for Other.'
        }
      } catch {
        // ignore malformed value, required validator handles invalid JSON
      }
    }

    if (!isRequiredFieldFilled(field, value)) {
      return 'Please complete all required fields on this page.'
    }

    return null
  }

  function handleNextPage() {
    if (!collection) return
    setPageError(null)
    setSubmitError(null)
    setIsReviewing(false)
    setActiveTab('questions')

    if (!collection.anonymous && !editResponseId && currentPageIdx === 0) {
      if (!respName.trim() || !respEmail.trim()) {
        setPageError('Please enter your name and email before continuing.')
        return
      }
    }

    const firstFieldError = fieldsOnCurrentPage.find(field => {
      const val = field.id !== undefined ? values[field.id] ?? '' : ''
      return getFieldValidationError(field, val) !== null
    })
    if (firstFieldError) {
      const val = firstFieldError.id !== undefined ? values[firstFieldError.id] ?? '' : ''
      setPageError(getFieldValidationError(firstFieldError, val) ?? 'Please complete all required fields on this page.')
      return
    }

    setCurrentPageIdx(prev => Math.min(prev + 1, totalPages - 1))
  }

  function handleStartReview() {
    if (!collection) return

    setPageError(null)
    setSubmitError(null)
    setActiveTab('questions')

    const identityError = getIdentityValidationError()
    if (identityError) {
      setCurrentPageIdx(0)
      setSubmitError(identityError)
      return
    }

    const invalidField = getFirstInvalidVisibleField()
    if (invalidField) {
      const val = invalidField.id !== undefined ? values[invalidField.id] ?? '' : ''
      const targetPage = pageNumbers.indexOf(normalizePage(invalidField.page))
      if (targetPage >= 0) setCurrentPageIdx(targetPage)
      setSubmitError(getFieldValidationError(invalidField, val) ?? 'Please complete all required fields before reviewing.')
      return
    }

    setIsReviewing(true)
  }

  async function handleSubmit() {
    if (!collection || !slug) return

    setPageError(null)

    const identityError = getIdentityValidationError()
    if (identityError) {
      setCurrentPageIdx(0)
      setIsReviewing(false)
      setActiveTab('questions')
      setSubmitError(identityError)
      return
    }

    const invalidField = getFirstInvalidVisibleField()
    if (invalidField) {
      const val = invalidField.id !== undefined ? values[invalidField.id] ?? '' : ''
      const targetPage = pageNumbers.indexOf(normalizePage(invalidField.page))
      if (targetPage >= 0) setCurrentPageIdx(targetPage)
      setIsReviewing(false)
      setActiveTab('questions')
      setSubmitError(getFieldValidationError(invalidField, val) ?? 'Please complete all required fields before submitting.')
      return
    }

    // In preview/test mode, skip the API call entirely — just show the test success screen.
    if (isPreview) {
      setSubmitting(true)
      await new Promise(res => setTimeout(res, 600)) // simulate network delay
      setSubmitting(false)
      setSubmitted(true)
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    try {
      if (editResponseId) {
        await updateMySubmission(editResponseId, {
          values: Object.entries(values)
            .map(([fieldId, value]) => ({ fieldId: parseInt(fieldId, 10), value })),
        })
      } else {
        await submitResponse(slug, {
          respondentName: respName.trim() || undefined,
          respondentEmail: respEmail.trim() || undefined,
          values: Object.entries(values)
            .filter(([, v]) => v !== '')
            .map(([fieldId, value]) => ({ fieldId: parseInt(fieldId, 10), value })),
        })
      }
      clearDraft(slug)
      setSubmitted(true)
    } catch (err) {
      setSubmitError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0F172A] flex items-center justify-center text-[#64748B]">
        Loading…
      </div>
    )
  }

  if (error || !collection) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0F172A] flex items-center justify-center">
        <div className="text-center space-y-2">
          <AlertCircle size={34} className="text-amber-500 mx-auto" />
          <p className="text-red-500 text-sm">
            Collection not found or in Draft status. Publish your collection to accept responses.
          </p>
        </div>
      </div>
    )
  }

  function handleTestAgain() {
    // Reset all form state to start a fresh test run without reloading the page
    if (collection) {
      const defaults: Record<number, string> = {}
      collection.fields.forEach(f => { if (f.id !== undefined) defaults[f.id] = '' })
      setValues(defaults)
    }
    setRespName('')
    setRespEmail('')
    setCurrentPageIdx(0)
    setIsReviewing(false)
    setFormStartedAt(Date.now())
    setActiveTab(collection?.instructions?.trim() || collection?.instructionsDocUrl ? 'instructions' : 'questions')
    setSubmitted(false)
    setSubmitError(null)
    setPageError(null)
  }

  function renderReviewValue(field: CollectionField, value: string) {
    if (!value || value.trim() === '') {
      return <span className="text-sm italic text-[#94A3B8]">No response</span>
    }

    switch (field.type) {
      case 'multiple_choice': {
        try {
          const items = JSON.parse(value) as string[]
          if (!Array.isArray(items) || items.length === 0) {
            return <span className="text-sm italic text-[#94A3B8]">No response</span>
          }
          return (
            <ul className="space-y-1 text-sm text-[#1E293B] dark:text-[#F1F5F9]">
              {items.map((item, index) => (
                <li key={`${field.id}-${index}`}>{isOtherResponse(item) ? decodeOtherResponse(item) : item}</li>
              ))}
            </ul>
          )
        } catch {
          return <span className="text-sm text-[#1E293B] dark:text-[#F1F5F9]">{value}</span>
        }
      }
      case 'single_choice':
        return <span className="text-sm text-[#1E293B] dark:text-[#F1F5F9]">{isOtherResponse(value) ? decodeOtherResponse(value) : value}</span>
      case 'confirmation':
        return <span className="text-sm text-[#1E293B] dark:text-[#F1F5F9]">{value === 'true' ? 'Confirmed' : 'Not confirmed'}</span>
      case 'signature':
        return value.startsWith('data:image')
          ? <img src={value} alt="Signature" className="max-h-24 rounded border border-[#E2E8F0] dark:border-[#334155] bg-white p-1" />
          : <span className="text-sm text-[#1E293B] dark:text-[#F1F5F9]">{value}</span>
      case 'attachment':
        return (
          <a href={value} target="_blank" rel="noopener noreferrer" className="text-sm text-[#2563EB] underline break-all">
            View attachment
          </a>
        )
      case 'custom_table': {
        try {
          const rows = JSON.parse(value) as Array<Record<string, string>>
          if (!Array.isArray(rows) || rows.length === 0) {
            return <span className="text-sm italic text-[#94A3B8]">No rows</span>
          }
          const columns = Object.keys(rows[0] ?? {})
          return (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs border border-[#E2E8F0] dark:border-[#334155] rounded">
                <thead>
                  <tr className="bg-[#F8FAFC] dark:bg-[#0F172A]">
                    {columns.map(column => (
                      <th key={column} className="px-2 py-1.5 text-left font-semibold text-[#475569] dark:text-[#94A3B8] border-b border-[#E2E8F0] dark:border-[#334155]">{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr key={`${field.id}-${rowIndex}`}>
                      {columns.map(column => (
                        <td key={column} className="px-2 py-1.5 text-[#1E293B] dark:text-[#F1F5F9] border-t border-[#E2E8F0] dark:border-[#334155]">{row[column] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        } catch {
          return <span className="text-sm text-[#1E293B] dark:text-[#F1F5F9]">{value}</span>
        }
      }
      case 'matrix_likert_scale': {
        try {
          const responses = JSON.parse(value) as Record<string, string>
          let rowLabels: string[] = []
          try {
            if (field.options && field.options.length > 0 && typeof field.options[0] === 'string') {
              const config = JSON.parse(field.options[0]) as { rows?: unknown }
              rowLabels = Array.isArray(config.rows) ? config.rows.map(row => String(row)) : []
            }
          } catch {
            rowLabels = []
          }
          return (
            <div className="space-y-1 text-sm text-[#1E293B] dark:text-[#F1F5F9]">
              {Object.entries(responses).map(([rowIndex, response]) => (
                <div key={`${field.id}-${rowIndex}`}>
                  {rowLabels[Number(rowIndex)] ?? `Row ${Number(rowIndex) + 1}`}: {response}
                </div>
              ))}
            </div>
          )
        } catch {
          return <span className="text-sm text-[#1E293B] dark:text-[#F1F5F9]">{value}</span>
        }
      }
      default:
        return <span className="text-sm text-[#1E293B] dark:text-[#F1F5F9] whitespace-pre-wrap">{value}</span>
    }
  }

  const reviewFieldsByPage = pageNumbers.map(pageNumber => ({
    pageNumber,
    fields: visibleFields.filter(field => normalizePage(field.page) === pageNumber && field.type !== 'comment'),
  })).filter(group => group.fields.length > 0)

  if (submitted) {
    if (isPreview) {
      return (
        <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0F172A] flex items-center justify-center">
          <div className="text-center space-y-4 p-8 max-w-sm">
            <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto">
              <CheckCircle size={28} className="text-amber-500" />
            </div>
            <h2 className="text-xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">
              Test complete!
            </h2>
            <p className="text-[#64748B] text-sm">
              No data was saved. This was a test submission — the form behaved exactly as respondents will see it.
            </p>
            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                onClick={handleTestAgain}
                className="w-full bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium px-4 py-2.5 rounded transition-colors"
              >
                Test again
              </button>
              <button
                type="button"
                onClick={() => window.close()}
                className="w-full border border-[#CBD5E1] dark:border-[#334155] text-[#64748B] hover:bg-[#F8FAFC] dark:hover:bg-[#1E293B] text-sm px-4 py-2.5 rounded transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )
    }
    if (editResponseId) {
      return (
        <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0F172A] flex items-center justify-center">
          <div className="text-center space-y-4 p-8">
            <CheckCircle size={48} className="text-green-500 mx-auto" />
            <h2 className="text-xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">
              Changes saved!
            </h2>
            <p className="text-[#64748B] text-sm">Your submission has been updated.</p>
            <button
              type="button"
              onClick={() => navigate(`/my-submissions/${editResponseId}`)}
              className="inline-flex items-center gap-1.5 text-sm text-[#2563EB] hover:underline"
            >
              <ArrowLeft size={14} />
              Back to submission
            </button>
          </div>
        </div>
      )
    }
    return (
      <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0F172A] flex items-center justify-center">
        <div className="text-center space-y-3 p-8">
          <CheckCircle size={48} className="text-green-500 mx-auto" />
          <h2 className="text-xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">
            Thank you!
          </h2>
          <p className="text-[#64748B] text-sm">Your response has been recorded.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0F172A]">
      {isPreview && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-4 py-2.5">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide bg-amber-500 text-white px-2 py-0.5 rounded">Test Mode</span>
              <span className="text-xs text-amber-700 dark:text-amber-400">
                Filling out this form as a respondent would — <strong>no data will be saved</strong>
              </span>
            </div>
            <button
              type="button"
              onClick={() => window.close()}
              className="shrink-0 text-xs text-amber-600 dark:text-amber-400 hover:underline"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {editResponseId && (
        <div className="bg-blue-50 dark:bg-[#1E3A5F] border-b border-blue-200 dark:border-blue-700 px-4 py-3">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
            <span className="text-sm text-blue-800 dark:text-blue-200 font-medium">
              Editing your submission — changes will overwrite your previous response
            </span>
            <button
              type="button"
              onClick={() => navigate(`/my-submissions/${editResponseId}`)}
              className="inline-flex items-center gap-1.5 text-xs text-blue-700 dark:text-blue-300 hover:underline shrink-0"
            >
              <ArrowLeft size={13} />
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Resume draft banner */}
      {showResumeBanner && pendingDraft && (
        <div className="bg-blue-50 dark:bg-[#1E3A5F] border-b border-blue-200 dark:border-blue-700 px-4 py-3">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-blue-800 dark:text-blue-200">
              <History size={16} className="shrink-0" />
              <span>
                <strong>Saved draft found</strong> — last saved {new Date(pendingDraft.savedAt).toLocaleString()}. Resume where you left off?
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleResumeDraft}
                className="bg-[#2563EB] hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors"
              >
                Resume
              </button>
              <button
                type="button"
                onClick={handleStartFresh}
                className="border border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-xs font-medium px-3 py-1.5 rounded transition-colors"
              >
                Start fresh
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cover photo */}
      {collection.coverPhotoUrl && (
        <div className="relative h-48 md:h-64 bg-[#1E293B] overflow-hidden">
          <img
            src={collection.coverPhotoUrl}
            alt=""
            className="w-full h-full object-cover opacity-70"
            onError={e => {
              ;(e.currentTarget as HTMLImageElement).style.display = 'none'
            }}
          />
          {collection.logoUrl && (
            <div className="absolute left-6 top-6 md:left-10 md:top-8 inline-flex max-w-[112px] md:max-w-[150px] bg-white shadow-sm p-px z-10">
              <img
                src={collection.logoUrl}
                alt="Logo"
                className="w-full h-auto"
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
              />
            </div>
          )}
          <div className="absolute inset-0 flex items-end p-6 md:p-10">
            <div className="space-y-2">
              <h1 className="text-2xl md:text-3xl font-bold text-white drop-shadow-lg">
                {collection.title}
              </h1>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/80">
                {collection.createdByName && (
                  <span className="flex items-center gap-1">
                    <User size={11} />
                    Created by {collection.createdByName}
                  </span>
                )}
                {collection.category && (
                  <span className="flex items-center gap-1">
                    <Tag size={11} />
                    {collection.category}
                  </span>
                )}
                {collection.dateDue && (
                  <span className="flex items-center gap-1">
                    <Calendar size={11} />
                    Due {collection.dateDue}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Title + metadata block (no cover photo) */}
        <div className="space-y-1">
          {!collection.coverPhotoUrl && (
            <>
              {collection.logoUrl && (
                <div className="inline-flex max-w-[112px] md:max-w-[150px] bg-white shadow-sm border border-[#E2E8F0] p-px">
                  <img
                    src={collection.logoUrl}
                    alt="Logo"
                    className="w-full h-auto"
                    onError={e => {
                      ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                    }}
                  />
                </div>
              )}
              <h1 className="text-2xl font-bold text-[#1E293B] dark:text-[#F1F5F9]">
                {collection.title}
              </h1>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#64748B]">
                {collection.createdByName && (
                  <span className="flex items-center gap-1">
                    <User size={11} />
                    Created by {collection.createdByName}
                  </span>
                )}
                {collection.category && (
                  <span className="flex items-center gap-1">
                    <Tag size={11} />
                    {collection.category}
                  </span>
                )}
                {collection.dateDue && (
                  <span className="flex items-center gap-1">
                    <Calendar size={11} />
                    Due {collection.dateDue}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        <form onSubmit={e => e.preventDefault()}>
          <div className="border-b border-[#E2E8F0] dark:border-[#334155] mb-6">
            <div className="flex items-center gap-6">
              <button
                type="button"
                onClick={() => setActiveTab('instructions')}
                className={`border-b-2 pb-3 text-sm font-semibold transition-colors ${
                  activeTab === 'instructions'
                    ? 'border-[#2563EB] text-[#2563EB]'
                    : 'border-transparent text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9]'
                }`}
              >
                Instructions
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('questions')}
                className={`border-b-2 pb-3 text-sm font-semibold transition-colors ${
                  activeTab === 'questions'
                    ? 'border-[#2563EB] text-[#2563EB]'
                    : 'border-transparent text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9]'
                }`}
              >
                Questions
              </button>
            </div>
          </div>

          {activeTab === 'instructions' ? (
            <div className="space-y-4">
              {collection.instructions ? (
                <div
                  className="text-sm text-[#475569] dark:text-[#94A3B8] leading-relaxed [overflow-wrap:anywhere] [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-[#2563EB] [&_a]:underline [&_a]:hover:text-blue-700"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeRichText(collection.instructions),
                  }}
                />
              ) : (
                <p className="text-sm text-[#94A3B8] italic">
                  No instructions provided.
                </p>
              )}
              {collection.instructionsDocUrl && (
                <div className="border border-[#E2E8F0] dark:border-[#334155] rounded overflow-hidden">
                  <iframe
                    src={toEmbedUrl(collection.instructionsDocUrl)}
                    title="Instructions document"
                    className="w-full h-80"
                  />
                </div>
              )}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('questions')}
                  className="inline-flex items-center justify-center bg-[#2563EB] hover:bg-blue-700 text-white font-medium px-4 py-2 rounded text-sm transition-colors"
                >
                  View Questions
                </button>
              </div>
              {showQrCode && qrCodeDataUrl && (
                <div className="pt-2 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">Scan Survey QR Code</p>
                  <div className="inline-flex flex-col items-center gap-2 rounded-lg border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0F172A] p-3">
                    <img src={qrCodeDataUrl} alt="Survey QR code" className="h-[132px] w-[132px]" />
                    <p className="text-xs text-[#64748B] text-center">Scan to open this survey link on another device.</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {isReviewing ? (
                <>
                  <div className="space-y-1">
                    <h2 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Review Your Answers</h2>
                    <p className="text-sm text-[#64748B]">Check your responses before final submission.</p>
                  </div>

                  {!collection.anonymous && !editResponseId && (
                    <div className="rounded-lg border border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A] p-4 space-y-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">Your Name</p>
                        <p className="text-sm text-[#1E293B] dark:text-[#F1F5F9]">{respName || 'No response'}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">Email Address</p>
                        <p className="text-sm text-[#1E293B] dark:text-[#F1F5F9]">{respEmail || 'No response'}</p>
                      </div>
                    </div>
                  )}

                  {reviewFieldsByPage.map(group => (
                    <div key={group.pageNumber} className="rounded-lg border border-[#E2E8F0] dark:border-[#334155] p-4 space-y-4">
                      {totalPages > 1 && (
                        <h3 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Page {group.pageNumber}</h3>
                      )}
                      {group.fields.map(field => (
                        <div key={field.id ?? `${group.pageNumber}-${field.label}`} className="space-y-1 border-t border-[#E2E8F0] dark:border-[#334155] first:border-t-0 first:pt-0 pt-4">
                          <p className="text-sm font-medium text-[#1E293B] dark:text-[#F1F5F9]">{field.label}</p>
                          {renderReviewValue(field, field.id !== undefined ? values[field.id] ?? '' : '')}
                        </div>
                      ))}
                    </div>
                  ))}

                  {submitError && (
                    <p className="text-sm text-red-500">{submitError}</p>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsReviewing(false)}
                      className="flex-1 border border-[#CBD5E1] dark:border-[#334155] text-[#475569] dark:text-[#94A3B8] hover:bg-[#F8FAFC] dark:hover:bg-[#1E293B] font-medium py-2.5 rounded text-sm transition-colors"
                    >
                      Back to Questions
                    </button>
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={submitting}
                      className={`flex-1 font-medium py-2.5 rounded text-sm transition-colors disabled:opacity-50 text-white ${
                        isPreview
                          ? 'bg-amber-500 hover:bg-amber-600'
                          : 'bg-[#2563EB] hover:bg-blue-700'
                      }`}
                    >
                      {submitting
                        ? (isPreview ? 'Testing…' : editResponseId ? 'Saving…' : 'Submitting…')
                        : (isPreview ? 'Submit (Test)' : editResponseId ? 'Save Changes' : 'Submit')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {totalPages > 1 && (
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#64748B]">
                      <span>Page {currentPageIdx + 1} of {totalPages}</span>
                      <span>{progressPercent}% complete</span>
                      <span>{estimatedTimeRemainingLabel}</span>
                    </div>
                    <div className="h-2 rounded-full bg-[#E2E8F0] dark:bg-[#334155] overflow-hidden">
                      <div
                        className="h-full bg-[#2563EB] transition-all"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                  )}

                  {!collection.anonymous && !editResponseId && currentPageIdx === 0 && (
                    <div className="space-y-3 pb-4 border-b border-[#E2E8F0] dark:border-[#334155]">
                      <div>
                        <label className={LABEL}>
                          Your Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={respName}
                          onChange={e => setRespName(e.target.value)}
                          placeholder="Full name"
                          className={INPUT}
                          required
                        />
                      </div>
                      <div>
                        <label className={LABEL}>
                          Email Address <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="email"
                          value={respEmail}
                          onChange={e => setRespEmail(e.target.value)}
                          placeholder="you@example.com"
                          className={INPUT}
                          required
                        />
                      </div>
                    </div>
                  )}

                  {collection.fields.length === 0 && (
                    <p className="text-sm text-[#94A3B8] italic">
                      No form fields configured.
                    </p>
                  )}
                  {fieldsOnCurrentPage.map(field =>
                    field.id !== undefined ? (
                      <FieldRenderer
                        key={field.id}
                        field={field}
                        value={values[field.id] ?? ''}
                        onChange={v => setValue(field.id!, v)}
                        disabled={false}
                      />
                    ) : null
                  )}

                  {pageError && (
                    <p className="text-sm text-red-500">{pageError}</p>
                  )}
                  {submitError && (
                    <p className="text-sm text-red-500">{submitError}</p>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPageError(null)
                        setSubmitError(null)
                        setCurrentPageIdx(prev => Math.max(0, prev - 1))
                      }}
                      disabled={currentPageIdx === 0}
                      className="flex-1 border border-[#CBD5E1] dark:border-[#334155] text-[#475569] dark:text-[#94A3B8] hover:bg-[#F8FAFC] dark:hover:bg-[#1E293B] disabled:opacity-40 font-medium py-2.5 rounded text-sm transition-colors"
                    >
                      Previous
                    </button>

                    {!isLastPage ? (
                      <button
                        type="button"
                        onClick={handleNextPage}
                        className="flex-1 bg-[#2563EB] hover:bg-blue-700 text-white font-medium py-2.5 rounded text-sm transition-colors"
                      >
                        Next
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleStartReview}
                        className="flex-1 bg-[#2563EB] hover:bg-blue-700 text-white font-medium py-2.5 rounded text-sm transition-colors"
                      >
                        Review
                      </button>
                    )}
                  </div>
                  {lastSavedAt && !isPreview && (
                    <p className="text-xs text-[#94A3B8] text-right -mt-1">
                      Draft saved {new Date(lastSavedAt).toLocaleTimeString()}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  )
}

// ── Field renderer ────────────────────────────────────────────

function FieldRenderer({
  field,
  value,
  onChange,
  disabled,
}: {
  field: CollectionField
  value: string
  onChange: (v: string) => void
  disabled: boolean
}) {
  const required = field.required && !disabled
  const optionList = field.options ?? []
  const supportsOther = hasOtherOption(field)
  const choiceOptions = optionList.filter(opt => opt !== OTHER_OPTION_MARKER)
  const singleChoiceOtherText = isOtherResponse(value) ? decodeOtherResponse(value) : ''
  const singleChoiceSelected = isOtherResponse(value) ? OTHER_OPTION_MARKER : value

  const multipleChoiceSelected: string[] = (() => {
    try {
      const parsed = value ? (JSON.parse(value) as string[]) : []
      return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []
    } catch {
      return []
    }
  })()
  const multipleChoiceOtherEncoded = multipleChoiceSelected.find(item => isOtherResponse(item))
  const multipleChoiceOtherText = multipleChoiceOtherEncoded ? decodeOtherResponse(multipleChoiceOtherEncoded) : ''

  if (field.type === 'comment') {
    return (
      <RichTextEditor
        value={field.label}
        readOnly={true}
        minHeightClassName="min-h-[100px]"
      />
    )
  }

  return (
    <div className="space-y-1">
      <label className={LABEL}>
        {field.label}
        {field.required && <span className="text-red-500 ml-0.5">*</span>}
      </label>

      {field.type === 'short_text' && (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          className={INPUT}
          required={required}
          disabled={disabled}
        />
      )}

      {field.type === 'date' && (
        <input
          type="date"
          value={value}
          onChange={e => onChange(e.target.value)}
          className={INPUT}
          required={required}
          disabled={disabled}
        />
      )}

      {field.type === 'long_text' && (
        <textarea
          rows={4}
          value={value}
          onChange={e => onChange(e.target.value)}
          className={`${INPUT} resize-y`}
          required={required}
          disabled={disabled}
        />
      )}

      {field.type === 'single_choice' && field.displayStyle === 'dropdown' && (
        <div className="space-y-2">
          <select
            value={singleChoiceSelected}
            onChange={e => {
              const selected = e.target.value
              if (selected === OTHER_OPTION_MARKER) {
                onChange(encodeOtherResponse(''))
                return
              }
              onChange(selected)
            }}
            className={INPUT}
            required={required}
            disabled={disabled}
          >
            <option value="">Select…</option>
            {choiceOptions.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
            {supportsOther && <option value={OTHER_OPTION_MARKER}>Other</option>}
          </select>
          {supportsOther && (
            <input
              type="text"
              value={singleChoiceOtherText}
              onChange={e => onChange(encodeOtherResponse(e.target.value))}
              className={INPUT}
              placeholder="Please specify"
              disabled={disabled}
            />
          )}
        </div>
      )}

      {field.type === 'single_choice' && field.displayStyle !== 'dropdown' && (
        <div className="space-y-2">
          {choiceOptions.map(opt => (
            <label key={opt} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name={`field-${field.id}`}
                value={opt}
                checked={singleChoiceSelected === opt}
                onChange={() => onChange(opt)}
                className="accent-[#2563EB]"
                required={required}
                disabled={disabled}
              />
              <span className="text-sm text-[#1E293B] dark:text-[#F1F5F9]">{opt}</span>
            </label>
          ))}
          {supportsOther && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name={`field-${field.id}`}
                value={OTHER_OPTION_MARKER}
                checked={singleChoiceSelected === OTHER_OPTION_MARKER}
                onChange={() => onChange(encodeOtherResponse(''))}
                className="accent-[#2563EB]"
                required={required}
                disabled={disabled}
              />
              <span className="text-sm text-[#1E293B] dark:text-[#F1F5F9]">Other</span>
            </label>
          )}
          {supportsOther && (
            <input
              type="text"
              value={singleChoiceOtherText}
              onChange={e => onChange(encodeOtherResponse(e.target.value))}
              className={INPUT}
              placeholder="Please specify"
              disabled={disabled}
            />
          )}
        </div>
      )}

      {field.type === 'multiple_choice' && (
        <div className="space-y-2">
          {choiceOptions.map(opt => {
            const checked = multipleChoiceSelected.includes(opt)
            return (
              <label key={opt} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? multipleChoiceSelected.filter(s => s !== opt)
                      : [...multipleChoiceSelected, opt]
                    onChange(JSON.stringify(next))
                  }}
                  className="accent-[#2563EB]"
                  disabled={disabled}
                />
                <span className="text-sm text-[#1E293B] dark:text-[#F1F5F9]">{opt}</span>
              </label>
            )
          })}
          {supportsOther && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!multipleChoiceOtherEncoded}
                onChange={e => {
                  const withoutOther = multipleChoiceSelected.filter(item => !isOtherResponse(item))
                  if (!e.target.checked) {
                    onChange(JSON.stringify(withoutOther))
                    return
                  }
                  onChange(JSON.stringify([...withoutOther, encodeOtherResponse('')]))
                }}
                className="accent-[#2563EB]"
                disabled={disabled}
              />
              <span className="text-sm text-[#1E293B] dark:text-[#F1F5F9]">Other</span>
            </label>
          )}
          {supportsOther && (
            <input
              type="text"
              value={multipleChoiceOtherText}
              onChange={e => {
                const withoutOther = multipleChoiceSelected.filter(item => !isOtherResponse(item))
                onChange(JSON.stringify([...withoutOther, encodeOtherResponse(e.target.value)]))
              }}
              className={INPUT}
              placeholder="Please specify"
              disabled={disabled}
            />
          )}
        </div>
      )}

      {field.type === 'attachment' && (
        <input
          type="file"
          disabled={disabled}
          onChange={e => {
            const file = e.target.files?.[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = () => onChange(reader.result as string)
            reader.readAsDataURL(file)
          }}
          className="text-sm text-[#64748B] file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-[#F1F5F9] file:text-[#475569] hover:file:bg-[#E2E8F0] dark:file:bg-[#334155] dark:file:text-[#94A3B8]"
        />
      )}

      {field.type === 'signature' && (
        <SignaturePad value={value} onChange={onChange} />
      )}

      {field.type === 'confirmation' && (
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value === 'true'}
            onChange={e => onChange(e.target.checked ? 'true' : '')}
            className="accent-[#2563EB] w-4 h-4 mt-0.5"
            required={required}
            disabled={disabled}
          />
          <span className="text-sm text-[#475569] dark:text-[#94A3B8]">
            {field.label}
          </span>
        </label>
      )}

      {field.type === 'rating' && (
        <div className="flex items-center gap-2 flex-wrap">
          {field.displayStyle === 'numbers' ? (
            [1, 2, 3, 4, 5].map(option => {
              const selected = Number(value) === option
              return (
                <button
                  key={option}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(String(option))}
                  className={[
                    'h-10 w-10 rounded-md border text-base font-semibold transition-colors',
                    disabled ? 'cursor-default' : 'cursor-pointer',
                    selected
                      ? 'border-[#2563EB] bg-[#2563EB] text-white'
                      : 'border-[#CBD5E1] bg-white text-[#0F172A] hover:border-[#94A3B8] dark:border-[#334155] dark:bg-[#0F172A] dark:text-[#F8FAFC] dark:hover:border-[#475569]',
                  ].join(' ')}
                  aria-label={`${option}`}
                >
                  {option}
                </button>
              )
            })
          ) : (
            [1, 2, 3, 4, 5].map(star => (
              <button
                key={star}
                type="button"
                disabled={disabled}
                onClick={() => onChange(String(star))}
                className={[
                  'text-2xl transition-colors leading-none',
                  disabled ? 'cursor-default' : 'cursor-pointer hover:scale-110',
                  Number(value) >= star
                    ? 'text-amber-400'
                    : 'text-[#CBD5E1] dark:text-[#334155]',
                ].join(' ')}
                aria-label={`${star} star`}
              >
                ★
              </button>
            ))
          )}
          {value && (
            <span className="text-xs text-[#64748B]">{value} / 5</span>
          )}
        </div>
      )}

      {field.type === 'custom_table' && (
        <CustomTableInput field={field} value={value} onChange={onChange} disabled={disabled} />
      )}

      {field.type === 'matrix_likert_scale' && (
        <MatrixLikertScaleInput field={field} value={value} onChange={onChange} disabled={disabled} />
      )}
    </div>
  )
}
