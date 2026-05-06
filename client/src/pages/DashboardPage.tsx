import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, Layers } from 'lucide-react'
import { listCollections } from '../api/collections'
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
  const [collections, setCollections] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listCollections()
      .then(all => setCollections(isUser ? all.filter(c => c.status === 'published') : all))
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false))
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
                    className={`inline-flex items-center text-sm font-bold uppercase tracking-wide px-2.5 py-1 rounded-[2px] ${colors.badge}`}
                  >
                    {category}
                  </span>
                  <div className="bg-[#F8FAFC] dark:bg-[#0F172A] rounded px-3 py-1 text-center shrink-0">
                    <span className="text-sm font-bold text-[#1E293B] dark:text-[#F1F5F9]">{cols.length}</span>
                    <span className="text-xs text-[#64748B] ml-1">{cols.length === 1 ? 'Collection' : 'Collections'}</span>
                  </div>
                </div>

                {/* Collection list */}
                <ul className="space-y-1.5">
                  {cols.map(col => (
                    <li key={col.id}>
                      <button
                        type="button"
                        onClick={() => isUser ? window.open(`/fill/${col.slug}`, '_blank', 'noopener') : navigate(`/collections/${col.id}/edit`)}
                        className="w-full flex items-center justify-between gap-2 text-left px-2.5 py-2 rounded hover:bg-[#F1F5F9] dark:hover:bg-[#0F172A] transition-colors group"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <ClipboardList size={14} className="shrink-0 text-[#94A3B8]" />
                          <span className="text-sm text-[#1E293B] dark:text-[#F1F5F9] truncate group-hover:text-[#2563EB]">
                            {col.title}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
