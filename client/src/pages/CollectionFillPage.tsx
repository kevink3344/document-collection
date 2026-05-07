import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { Calendar, Tag, User, CheckCircle, AlertCircle, Maximize2, X, Save, History, ArrowLeft } from 'lucide-react'
import { getPublicCollection, submitResponse } from '../api/collections'
import { updateMySubmission } from '../api/mySubmissions'
import { toEmbedUrl } from '../utils/docPreviewUrl'
import { sanitizeRichText } from '../utils/richText'
import { useAuth } from '../contexts/AuthContext'
import type { Collection, CollectionField } from '../types'

// ── Style tokens ──────────────────────────────────────────────

const INPUT =
  'w-full border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0F172A] ' +
  'text-[#1E293B] dark:text-[#F1F5F9] placeholder-[#94A3B8] px-3 py-2 text-sm rounded ' +
  'focus:outline-none focus:ring-2 focus:ring-[#2563EB]'

const LABEL = 'block text-sm font-medium text-[#1E293B] dark:text-[#F1F5F9] mb-1'

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

  function setValue(fieldId: number, val: string) {
    setValues(prev => ({ ...prev, [fieldId]: val }))
  }

  const orderedFields = useMemo(() => {
    if (!collection) return [] as CollectionField[]
    return [...collection.fields].sort((a, b) => {
      const aPage = normalizePage(a.page)
      const bPage = normalizePage(b.page)
      if (aPage !== bPage) return aPage - bPage
      return a.sortOrder - b.sortOrder
    })
  }, [collection])

  const pageNumbers = useMemo(() => {
    const pages = new Set<number>()
    orderedFields.forEach(f => pages.add(normalizePage(f.page)))
    const sorted = Array.from(pages).sort((a, b) => a - b)
    return sorted.length > 0 ? sorted : [1]
  }, [orderedFields])

  const totalPages = pageNumbers.length
  const currentPageNumber = pageNumbers[Math.min(currentPageIdx, totalPages - 1)]
  const fieldsOnCurrentPage = orderedFields.filter(
    f => normalizePage(f.page) === currentPageNumber
  )
  const isLastPage = currentPageIdx === totalPages - 1

  useEffect(() => {
    if (currentPageIdx > totalPages - 1) {
      setCurrentPageIdx(Math.max(0, totalPages - 1))
    }
  }, [currentPageIdx, totalPages])

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
    setLastSavedAt(null)
    setPendingDraft(null)
    setShowResumeBanner(false)
  }

  function handleSaveProgress() {
    if (!slug || isPreview) return
    saveDraft(slug, { respName, respEmail, values, currentPageIdx })
    const now = new Date().toISOString()
    setLastSavedAt(now)
  }

  function isRequiredFieldFilled(field: CollectionField, value: string): boolean {
    if (!field.required) return true
    switch (field.type) {
      case 'multiple_choice':
        try {
          return (JSON.parse(value || '[]') as string[]).length > 0
        } catch {
          return false
        }
      case 'confirmation':
        return value === 'true'
      default:
        return value.trim() !== ''
    }
  }

  function handleNextPage() {
    if (!collection) return
    setPageError(null)

    if (!collection.anonymous && !editResponseId && currentPageIdx === 0) {
      if (!respName.trim() || !respEmail.trim()) {
        setPageError('Please enter your name and email before continuing.')
        return
      }
    }

    const missingRequired = fieldsOnCurrentPage.find(field => {
      const val = field.id !== undefined ? values[field.id] ?? '' : ''
      return !isRequiredFieldFilled(field, val)
    })
    if (missingRequired) {
      setPageError('Please complete all required fields on this page.')
      return
    }

    setCurrentPageIdx(prev => Math.min(prev + 1, totalPages - 1))
  }

  async function handleSubmit() {
    if (!collection || !slug) return

    if (!editResponseId && !collection.anonymous && (!respName.trim() || !respEmail.trim())) {
      setSubmitError('Please enter your name and email address.')
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
    setSubmitted(false)
    setSubmitError(null)
    setPageError(null)
  }

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
          <div className="absolute inset-0 flex items-end p-6 md:p-10">
            <div className="space-y-1">
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
          {/* Two-column layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Instructions */}
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9] uppercase tracking-wide">
                Instructions
              </h2>
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
            </div>

            {/* Form data */}
            <div className="space-y-5">
              <h2 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9] uppercase tracking-wide">
                Form Data
              </h2>

              {totalPages > 1 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-[#64748B]">
                  <span>Page {currentPageIdx + 1} of {totalPages}</span>
                  <span>{Math.round(((currentPageIdx + 1) / totalPages) * 100)}%</span>
                </div>
                <div className="h-2 rounded-full bg-[#E2E8F0] dark:bg-[#334155] overflow-hidden">
                  <div
                    className="h-full bg-[#2563EB] transition-all"
                    style={{ width: `${((currentPageIdx + 1) / totalPages) * 100}%` }}
                  />
                </div>
              </div>
              )}

              {/* Identity fields (hidden in edit mode — submission already has them) */}
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

              {/* Dynamic fields */}
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

              {/* Submit */}
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
                    setCurrentPageIdx(prev => Math.max(0, prev - 1))
                  }}
                  disabled={currentPageIdx === 0}
                  className="flex-1 border border-[#CBD5E1] dark:border-[#334155] text-[#475569] dark:text-[#94A3B8] hover:bg-[#F8FAFC] dark:hover:bg-[#1E293B] disabled:opacity-40 font-medium py-2.5 rounded text-sm transition-colors"
                >
                  Previous
                </button>

                {!isPreview && !editResponseId && (
                  <button
                    type="button"
                    onClick={handleSaveProgress}
                    title="Save progress"
                    className="flex items-center gap-1.5 border border-[#CBD5E1] dark:border-[#334155] text-[#475569] dark:text-[#94A3B8] hover:bg-[#F8FAFC] dark:hover:bg-[#1E293B] font-medium px-3 py-2.5 rounded text-sm transition-colors"
                  >
                    <Save size={14} />
                    Save
                  </button>
                )}

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
                )}
              </div>
              {lastSavedAt && !isPreview && (
                <p className="text-xs text-[#94A3B8] text-right -mt-1">
                  Draft saved {new Date(lastSavedAt).toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>
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
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className={INPUT}
          required={required}
          disabled={disabled}
        >
          <option value="">Select…</option>
          {(field.options ?? []).map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      )}

      {field.type === 'single_choice' && field.displayStyle !== 'dropdown' && (
        <div className="space-y-2">
          {(field.options ?? []).map(opt => (
            <label key={opt} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name={`field-${field.id}`}
                value={opt}
                checked={value === opt}
                onChange={() => onChange(opt)}
                className="accent-[#2563EB]"
                required={required}
                disabled={disabled}
              />
              <span className="text-sm text-[#1E293B] dark:text-[#F1F5F9]">{opt}</span>
            </label>
          ))}
        </div>
      )}

      {field.type === 'multiple_choice' && (
        <div className="space-y-2">
          {(field.options ?? []).map(opt => {
            const selected: string[] = value
              ? (JSON.parse(value) as string[])
              : []
            const checked = selected.includes(opt)
            return (
              <label key={opt} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? selected.filter(s => s !== opt)
                      : [...selected, opt]
                    onChange(JSON.stringify(next))
                  }}
                  className="accent-[#2563EB]"
                  disabled={disabled}
                />
                <span className="text-sm text-[#1E293B] dark:text-[#F1F5F9]">{opt}</span>
              </label>
            )
          })}
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

      {field.type === 'custom_table' && (
        <CustomTableInput field={field} value={value} onChange={onChange} disabled={disabled} />
      )}
    </div>
  )
}
