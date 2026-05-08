import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckSquare, AlertCircle } from 'lucide-react'
import { getMySubmission, type MySubmissionDetail } from '../api/mySubmissions'
import { getCategoryColorClasses } from '../utils/categoryColors'
import { timeAgo } from '../utils/timeAgo'

function ReadOnlyField({ label, fieldType, value }: { label: string; fieldType: string; value: string }) {
  const LABEL = 'block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1'
  const VALUE = 'text-sm text-[#1E293B] dark:text-[#F1F5F9]'

  function renderValue() {
    if (!value || value.trim() === '') {
      return <span className="text-[#94A3B8] italic text-sm">—</span>
    }

    switch (fieldType) {
      case 'multiple_choice': {
        try {
          const items = JSON.parse(value) as string[]
          return (
            <ul className="space-y-1">
              {items.map((item, i) => (
                <li key={i} className="flex items-center gap-1.5 text-sm text-[#1E293B] dark:text-[#F1F5F9]">
                  <CheckSquare size={13} className="text-[#2563EB] shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          )
              case 'matrix_likert_scale': {
                try {
                  const responses: Record<number, string> = JSON.parse(value)
                  const configStr = fieldType === 'matrix_likert_scale' ? fieldType : null
                  // Note: fieldType is a string, so we can't get config from it
                  // This is a limitation - we just display the raw responses
                  return (
                    <div className="text-sm space-y-1">
                      {Object.entries(responses).map(([rowIdx, colLabel]) => (
                        <div key={rowIdx} className="text-[#1E293B] dark:text-[#F1F5F9]">
                          Row {Number(rowIdx) + 1}: <span className="font-medium">{colLabel}</span>
                        </div>
                      ))}
                    </div>
                  )
                } catch {
                  return <span className={VALUE}>{value}</span>
                }
              }
        } catch {
          return <span className={VALUE}>{value}</span>
        }
      }
      case 'confirmation':
        return (
          <span className={`inline-flex items-center gap-1 text-sm font-medium ${value === 'true' ? 'text-green-600 dark:text-green-400' : 'text-[#94A3B8]'}`}>
            <CheckSquare size={13} />
            {value === 'true' ? 'Confirmed' : 'Not confirmed'}
          </span>
        )
      case 'signature':
        return value.startsWith('data:image') ? (
          <img src={value} alt="Signature" className="max-h-20 border border-[#E2E8F0] dark:border-[#334155] rounded bg-white p-1" />
        ) : (
          <span className={VALUE}>{value}</span>
        )
      case 'attachment':
        return (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[#2563EB] underline hover:text-blue-700 break-all"
          >
            {value}
          </a>
        )
      case 'custom_table': {
        try {
          const rows = JSON.parse(value) as Record<string, string>[]
          if (!rows.length) return <span className="text-[#94A3B8] italic text-sm">No rows</span>
          const cols = Object.keys(rows[0])
          return (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border border-[#E2E8F0] dark:border-[#334155] rounded-[2px]">
                <thead>
                  <tr className="bg-[#F8FAFC] dark:bg-[#0F172A]">
                    {cols.map(col => (
                      <th key={col} className="px-2 py-1.5 text-left font-semibold text-[#475569] dark:text-[#94A3B8] border-b border-[#E2E8F0] dark:border-[#334155]">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? '' : 'bg-[#F8FAFC] dark:bg-[#0F172A]/50'}>
                      {cols.map(col => (
                        <td key={col} className="px-2 py-1.5 text-[#1E293B] dark:text-[#F1F5F9]">
                          {row[col] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        } catch {
          return <span className={VALUE}>{value}</span>
        }
      }
      case 'long_text':
        return <p className={`${VALUE} whitespace-pre-wrap`}>{value}</p>
      case 'rating': {
        const stars = Number(value)
        return (
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map(s => (
              <span key={s} className={`text-xl leading-none ${stars >= s ? 'text-amber-400' : 'text-[#CBD5E1] dark:text-[#334155]'}`}>★</span>
            ))}
            <span className="ml-2 text-xs text-[#64748B]">{value} / 5</span>
          </div>
        )
      }
      default:
        return <span className={VALUE}>{value}</span>
    }
  }

  return (
    <div>
      <p className={LABEL}>{label}</p>
      {renderValue()}
    </div>
  )
}

export default function MySubmissionDetailPage() {
  const { responseId } = useParams<{ responseId: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<MySubmissionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const parsedResponseId = useMemo(() => {
    if (!responseId) return null
    const n = parseInt(responseId, 10)
    return Number.isNaN(n) ? null : n
  }, [responseId])

  useEffect(() => {
    if (!parsedResponseId) return
    getMySubmission(parsedResponseId)
      .then(data => setDetail(data))
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false))
  }, [parsedResponseId])

  function handleStartEdit() {
    if (!detail?.canEdit || !detail.collectionSlug || !parsedResponseId) return
    const draftValues: Record<number, string> = {}
    detail.values.forEach(v => { draftValues[v.fieldId] = v.value })
    localStorage.setItem(
      `dcp_draft_${detail.collectionSlug}`,
      JSON.stringify({ respName: '', respEmail: '', values: draftValues, currentPageIdx: 0, savedAt: new Date().toISOString() })
    )
    navigate(`/fill/${detail.collectionSlug}?edit=${parsedResponseId}`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-[#64748B]">
        Loading…
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => navigate('/my-submissions')}
          className="flex items-center gap-1.5 text-sm text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9] transition-colors"
        >
          <ArrowLeft size={14} />
          Back to My Submissions
        </button>
        <div className="rounded border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4 flex items-center gap-2 text-red-700 dark:text-red-400 text-sm">
          <AlertCircle size={16} />
          {error ?? 'Submission not found.'}
        </div>
      </div>
    )
  }

  const colors = getCategoryColorClasses(detail.category ?? 'Uncategorised')

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Back link */}
      <button
        type="button"
        onClick={() => navigate('/my-submissions')}
        className="flex items-center gap-1.5 text-sm text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9] transition-colors"
      >
        <ArrowLeft size={14} />
        Back to My Submissions
      </button>

      {/* Header */}
      <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-5 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex items-center gap-1.5">
            <h1 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9] leading-tight truncate">
              {detail.collectionTitle}
            </h1>
            {detail.versionNumber !== null && (
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border border-[#CBD5E1] dark:border-[#334155] text-[#64748B]">
                V{detail.versionNumber}
              </span>
            )}
          </div>
          {detail.category && (
            <span className={`shrink-0 text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-[2px] ${colors.badge}`}>
              {detail.category}
            </span>
          )}
        </div>
        <p className="text-xs text-[#64748B]">
          Submitted {timeAgo(detail.submittedAt)} &middot; {new Date(detail.submittedAt).toLocaleString()}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {detail.canEdit && detail.editableUntil ? (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-[2px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              Editable until {new Date(detail.editableUntil).toLocaleString()}
            </span>
          ) : (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-[2px] bg-[#E2E8F0] text-[#475569] dark:bg-[#334155] dark:text-[#CBD5E1]">
              Editing closed
            </span>
          )}
          {detail.lastEditedAt && (
            <span className="text-[11px] text-[#64748B]">
              Last edited {new Date(detail.lastEditedAt).toLocaleString()}
            </span>
          )}
        </div>
        <div className="pt-1">
          <button
            type="button"
            onClick={handleStartEdit}
            disabled={!detail.canEdit}
            className="inline-flex items-center gap-1.5 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors"
          >
            Edit Submission
          </button>
        </div>
      </div>

      {/* Field values */}
      <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg divide-y divide-[#E2E8F0] dark:divide-[#334155]">
        {detail.values.length === 0 ? (
          <p className="p-5 text-sm text-[#94A3B8] italic">No field values recorded.</p>
        ) : (
          detail.values.map(v => (
            <div key={v.fieldId} className="px-5 py-4">
              <ReadOnlyField label={v.fieldLabel} fieldType={v.fieldType} value={v.value} />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
