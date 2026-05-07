import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, Layers, Table, FileText, CheckCircle, AlertTriangle, Inbox, TrendingUp } from 'lucide-react'
import { listCollections } from '../api/collections'
import { listMySubmissions } from '../api/mySubmissions'
import { getStats, type DashboardStats } from '../api/stats'
import { getCategoryColorClasses } from '../utils/categoryColors'
import { useAuth } from '../contexts/AuthContext'
import type { Collection } from '../types'

interface CategoryStat {
  category: string
  collections: Collection[]
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isUser = user?.role === 'user'
  const isPrivileged = user?.role === 'administrator' || user?.role === 'team_manager'
  const [collections, setCollections] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kpiStats, setKpiStats] = useState<DashboardStats | null>(null)
  const [submissionCounts, setSubmissionCounts] = useState<Record<number, number>>({})

  useEffect(() => {
    const collectionsFetch = listCollections()
      .then(all => setCollections(isUser ? all.filter(c => c.status === 'published') : all))
      .catch(err => setError((err as Error).message))

    if (isPrivileged) {
      Promise.all([collectionsFetch, getStats().then(setKpiStats).catch(() => null)])
        .finally(() => setLoading(false))
    } else if (isUser) {
      Promise.all([
        collectionsFetch,
        listMySubmissions()
          .then(subs => {
            const counts = subs.reduce<Record<number, number>>((acc, sub) => {
              acc[sub.collectionId] = (acc[sub.collectionId] ?? 0) + 1
              return acc
            }, {})
            setSubmissionCounts(counts)
          })
          .catch(() => null),
      ]).finally(() => setLoading(false))
    } else {
      collectionsFetch.finally(() => setLoading(false))
    }
  }, [])

  const stats = useMemo((): CategoryStat[] => {
    const map = new Map<string, Collection[]>()
    collections.forEach(col => {
      const key = col.category ?? 'Uncategorised'
      const arr = map.get(key) ?? []
      arr.push(col)
      map.set(key, arr)
    })
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, cols]) => ({
        category,
        collections: cols,
      }))
  }, [collections])

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
        <h1 className="text-xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Dashboard</h1>
        <p className="text-sm text-[#64748B] mt-0.5">Collections grouped by category.</p>
      </div>

      {/* KPI strip — admin & team_manager only */}
      {isPrivileged && kpiStats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            {
              label: 'Open Collections',
              value: kpiStats.openCount,
              icon: <CheckCircle size={16} className="text-green-500" />,
              accent: 'border-green-200 dark:border-green-800',
            },
            {
              label: 'Drafts',
              value: kpiStats.draftCount,
              icon: <FileText size={16} className="text-[#94A3B8]" />,
              accent: 'border-[#E2E8F0] dark:border-[#334155]',
            },
            {
              label: 'Overdue',
              value: kpiStats.overdueCount,
              icon: <AlertTriangle size={16} className={kpiStats.overdueCount > 0 ? 'text-red-500' : 'text-[#94A3B8]'} />,
              accent: kpiStats.overdueCount > 0 ? 'border-red-200 dark:border-red-800' : 'border-[#E2E8F0] dark:border-[#334155]',
            },
            {
              label: 'This Week',
              value: kpiStats.submissionsThisWeek,
              icon: <TrendingUp size={16} className="text-[#2563EB]" />,
              accent: 'border-blue-200 dark:border-blue-800',
            },
            {
              label: 'Total Submissions',
              value: kpiStats.totalSubmissions,
              icon: <Inbox size={16} className="text-[#64748B]" />,
              accent: 'border-[#E2E8F0] dark:border-[#334155]',
            },
          ].map(({ label, value, icon, accent }) => (
            <div
              key={label}
              className={`bg-white dark:bg-[#1E293B] border ${accent} rounded-lg px-4 py-3 flex items-center gap-3`}
            >
              <div className="shrink-0">{icon}</div>
              <div className="min-w-0">
                <p className="text-xl text-[#94A3B8] leading-none">{value}</p>
                <p className="text-xs text-[#64748B] mt-0.5 leading-tight">{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {stats.length === 0 ? (
        <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-10 text-center">
          <Layers size={40} className="mx-auto mb-3 text-[#CBD5E1]" />
          <p className="text-sm text-[#64748B]">No collections yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {stats.map(({ category, collections: cols }) => {
            const colors = getCategoryColorClasses(category)
            return (
              <div
                key={category}
                className={`bg-white dark:bg-[#1E293B] border-2 ${colors.card} rounded-lg p-5 flex flex-col gap-4`}
              >
                {/* Header */}
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={`inline-flex items-center text-sm uppercase tracking-wide px-2.5 py-1 rounded-[2px] ${colors.badge}`}
                  >
                    {category}
                  </span>
                  <div className="bg-[#F8FAFC] dark:bg-[#0F172A] rounded px-3 py-1 text-center shrink-0">
                    <span className="text-sm text-[#1E293B] dark:text-[#E2E8F0]">{cols.length}</span>
                    <span className="text-xs text-[#64748B] ml-1">{cols.length === 1 ? 'Collection' : 'Collections'}</span>
                  </div>
                </div>

                {/* Collection list */}
                <ul className="space-y-1.5">
                  {cols.map(col => {
                    const submittedCount = submissionCounts[col.id] ?? 0
                    return (
                      <li key={col.id}>
                        <button
                          type="button"
                          onClick={() => isUser ? window.open(`/fill/${col.slug}`, '_blank', 'noopener') : navigate(`/collections/${col.id}/edit`)}
                          className="w-full flex items-center justify-between gap-2 text-left px-2.5 py-2 rounded hover:bg-[#F1F5F9] dark:hover:bg-[#0F172A] transition-colors group"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <ClipboardList size={14} className="shrink-0 text-[#94A3B8]" />
                            <span className="text-sm text-[#1E293B] dark:text-[#F1F5F9] truncate group-hover:text-[#2563EB] flex items-center gap-1">
                              {col.title}
                              {col.hasCustomTable && (
                                <Table size={11} className="shrink-0 text-[#2563EB] dark:text-white mt-0.5" aria-label="Contains custom table" />
                              )}
                            </span>
                          </span>
                          {isUser && submittedCount > 0 && (
                            <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-[2px] bg-[#E2E8F0] dark:bg-[#334155] text-[#1E293B] dark:text-[#E2E8F0] text-xs inline-flex items-center justify-center">
                              {submittedCount}
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
