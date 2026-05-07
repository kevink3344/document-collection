import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, Inbox } from 'lucide-react'
import { listMySubmissions, type MySubmission } from '../api/mySubmissions'
import { getCategoryColorClasses } from '../utils/categoryColors'
import { timeAgo } from '../utils/timeAgo'

export default function MySubmissionsPage() {
  const navigate = useNavigate()
  const [submissions, setSubmissions] = useState<MySubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listMySubmissions()
      .then(setSubmissions)
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-[#64748B]">
        Loading…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4 text-red-700 dark:text-red-400 text-sm">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">My Submissions</h1>
        <p className="text-sm text-[#64748B] mt-0.5">Forms you have previously submitted.</p>
      </div>

      {submissions.length === 0 ? (
        <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-10 text-center">
          <Inbox size={40} className="mx-auto mb-3 text-[#CBD5E1]" />
          <p className="text-sm text-[#64748B]">You haven't submitted any responses yet.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
          <ul className="divide-y divide-[#E2E8F0] dark:divide-[#334155]">
            {submissions.map(sub => {
              const colors = getCategoryColorClasses(sub.category ?? 'Uncategorised')
              return (
                <li key={sub.responseId}>
                  <button
                    type="button"
                    onClick={() => navigate(`/my-submissions/${sub.responseId}`)}
                    className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <ClipboardList size={16} className="shrink-0 text-[#94A3B8]" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="text-sm font-medium text-[#1E293B] dark:text-[#F1F5F9] truncate group-hover:text-[#2563EB]">
                            {sub.collectionTitle}
                          </p>
                          {sub.versionNumber !== null && (
                            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border border-[#CBD5E1] dark:border-[#334155] text-[#64748B]">
                              V{sub.versionNumber}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#64748B] mt-0.5">{timeAgo(sub.submittedAt)}</p>
                        {sub.canEdit && sub.editableUntil && (
                          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5">
                            Editable until {new Date(sub.editableUntil).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-3">
                      {sub.category && (
                        <span className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-[2px] ${colors.badge}`}>
                          {sub.category}
                        </span>
                      )}
                      <span className="text-xs text-[#2563EB] font-medium">View →</span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
