import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Edit2,
  Trash2,
  Eye,
  Copy,
  Calendar,
  Tag,
  Users,
  ClipboardList,
} from 'lucide-react'
import { listCollections, deleteCollection } from '../api/collections'
import { htmlToPlainText } from '../utils/richText'
import { getCategoryColorClasses } from '../utils/categoryColors'
import type { Collection } from '../types'

function statusBadgeClass(status: Collection['status']) {
  return status === 'published'
    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
}

function categoryBadge(cat: string | null) {
  if (!cat) return ''
  return getCategoryColorClasses(cat).badge
}

export default function CollectionsPage() {
  const navigate = useNavigate()
  const [collections, setCollections] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)

  useEffect(() => {
    listCollections()
      .then(setCollections)
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false))
  }, [])

  async function handleDelete(col: Collection) {
    if (
      !window.confirm(
        `Delete "${col.title}"? This will also remove all responses.`
      )
    )
      return
    setDeleting(col.id)
    try {
      await deleteCollection(col.id)
      setCollections(prev => prev.filter(c => c.id !== col.id))
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setDeleting(null)
    }
  }

  async function copyShareLink(slug: string) {
    const url = `${window.location.origin}/fill/${slug}`
    try {
      await navigator.clipboard.writeText(url)
      alert('Share link copied to clipboard')
    } catch {
      alert(`Copy this link: ${url}`)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-[#64748B]">
        Loading collections…
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">
            Collections
          </h1>
          <p className="text-sm text-[#64748B] mt-0.5">
            {collections.length} collection{collections.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => navigate('/collections/new')}
          className="flex items-center gap-2 bg-[#2563EB] hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
        >
          <Plus size={15} />
          New Collection
        </button>
      </div>

      {/* Empty state */}
      {collections.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ClipboardList size={40} className="text-[#CBD5E1] mb-3" />
          <p className="text-[#64748B] text-sm">No collections yet.</p>
          <button
            onClick={() => navigate('/collections/new')}
            className="mt-4 text-[#2563EB] text-sm hover:underline"
          >
            Create your first collection
          </button>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {collections.map(col => (
          <div
            key={col.id}
            className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden flex flex-col"
          >
            {/* Cover photo */}
            {col.coverPhotoUrl && (
              <div className="h-28 bg-[#F1F5F9] dark:bg-[#0F172A] overflow-hidden">
                <img
                  src={col.coverPhotoUrl}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={e => {
                    ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                  }}
                />
              </div>
            )}

            <div className="p-4 flex flex-col flex-1 gap-3">
              {/* Category + title */}
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {col.category && (
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-[2px] ${categoryBadge(col.category)}`}
                    >
                      <Tag size={9} />
                      {col.category}
                    </span>
                  )}
                  <span
                    className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${statusBadgeClass(col.status)}`}
                  >
                    {col.status}
                  </span>
                </div>
                <h2 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9] leading-tight">
                  {col.title}
                </h2>
                {col.description && (
                  <p className="text-xs text-[#64748B] dark:text-[#94A3B8] mt-0.5 line-clamp-2">
                    {htmlToPlainText(col.description)}
                  </p>
                )}
              </div>

              {/* Meta */}
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#64748B]">
                {col.createdByName && (
                  <span className="flex items-center gap-1">
                    <Users size={10} />
                    {col.createdByName}
                  </span>
                )}
                {col.dateDue && (
                  <span className="flex items-center gap-1">
                    <Calendar size={10} />
                    Due {col.dateDue}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <ClipboardList size={10} />
                  {col.responseCount ?? 0} response
                  {col.responseCount !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Actions */}
              <div className="mt-auto pt-2 border-t border-[#F1F5F9] dark:border-[#334155] flex items-center gap-2">
                <button
                  onClick={() => copyShareLink(col.slug)}
                  title={col.status === 'published' ? 'Copy share link' : 'Publish to enable share link'}
                  disabled={col.status !== 'published'}
                  className="flex items-center gap-1 text-[11px] text-[#64748B] hover:text-[#2563EB] transition-colors disabled:opacity-40"
                >
                  <Copy size={13} />
                  Copy Link
                </button>
                <button
                  onClick={() =>
                    window.open(`/fill/${col.slug}?preview=true`, '_blank', 'noopener')
                  }
                  title="Preview"
                  className="flex items-center gap-1 text-[11px] text-[#64748B] hover:text-[#2563EB] transition-colors"
                >
                  <Eye size={13} />
                  Preview
                </button>
                <button
                  onClick={() => navigate(`/collections/${col.id}/edit`)}
                  title="Edit"
                  className="flex items-center gap-1 text-[11px] text-[#64748B] hover:text-[#2563EB] transition-colors"
                >
                  <Edit2 size={13} />
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(col)}
                  disabled={deleting === col.id}
                  title="Delete"
                  className="ml-auto flex items-center gap-1 text-[11px] text-[#64748B] hover:text-red-500 transition-colors disabled:opacity-40"
                >
                  <Trash2 size={13} />
                  {deleting === col.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
