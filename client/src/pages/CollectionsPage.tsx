import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Plus,
  Edit2,
  Trash2,
  Eye,
  Copy,
  Calendar,
  Tag,
  User,
  Users,
  ClipboardList,
  GripVertical,
  Table,
} from 'lucide-react'
import { listCollections, deleteCollection } from '../api/collections'
import { getPreference, updatePreference } from '../api/preferences'
import { htmlToPlainText } from '../utils/richText'
import { getCategoryColorClasses } from '../utils/categoryColors'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import type { Collection } from '../types'

const COLLECTION_ORDER_PREFERENCE_KEY = 'collections_card_order'

function collectionOrderStorageKey(userId: number): string {
  return `dcp:collections-order:${userId}`
}

function parseCollectionOrder(rawValue: string | null): number[] {
  if (!rawValue) return []

  try {
    const parsed = JSON.parse(rawValue) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((item): item is number => typeof item === 'number')
  } catch {
    return []
  }
}

function mergeCollectionsByOrder(items: Collection[], orderedIds: number[]): Collection[] {
  if (orderedIds.length === 0) {
    return items
  }

  const byId = new Map(items.map((item) => [item.id, item]))
  const ordered = orderedIds
    .map((id) => byId.get(id))
    .filter((item): item is Collection => Boolean(item))
  const remaining = items.filter((item) => !orderedIds.includes(item.id))

  return [...ordered, ...remaining]
}

function readLocalCollectionOrder(userId: number): number[] {
  return parseCollectionOrder(localStorage.getItem(collectionOrderStorageKey(userId)))
}

function writeLocalCollectionOrder(userId: number, ids: number[]): void {
  localStorage.setItem(collectionOrderStorageKey(userId), JSON.stringify(ids))
}

interface CollectionCardProps {
  collection: Collection
  deleting: number | null
  onCopyShareLink: (slug: string) => void
  onEdit: (id: number) => void
  onDelete: (collection: Collection) => void
  onTestForm: (slug: string) => void
}

function SortableCollectionCard({
  collection,
  deleting,
  onCopyShareLink,
  onEdit,
  onDelete,
  onTestForm,
}: CollectionCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: collection.id })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={`bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden flex flex-col ${isDragging ? 'opacity-70 shadow-xl z-10' : ''}`}
    >
      {collection.coverPhotoUrl && (
        <div className="h-28 bg-[#F1F5F9] dark:bg-[#0F172A] overflow-hidden">
          <img
            src={collection.coverPhotoUrl}
            alt=""
            className="w-full h-full object-cover"
            onError={e => {
              ;(e.currentTarget as HTMLImageElement).style.display = 'none'
            }}
          />
        </div>
      )}

      <div className="p-4 flex flex-col flex-1 gap-3">
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              {collection.category && (
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-[2px] ${categoryBadge(collection.category)}`}
                >
                  <Tag size={9} />
                  {collection.category}
                </span>
              )}
              <span
                className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${statusBadgeClass(collection.status)}`}
              >
                {collection.status}
              </span>
              {collection.currentVersionNumber != null && (
                <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded bg-[#F1F5F9] dark:bg-[#334155] text-[#475569] dark:text-[#94A3B8]">
                  v{collection.currentVersionNumber}
                </span>
              )}
            </div>

            <button
              type="button"
              className="shrink-0 rounded p-1 text-[#94A3B8] hover:text-[#2563EB] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] cursor-grab active:cursor-grabbing touch-none"
              aria-label={`Reorder ${collection.title}`}
              title="Drag to reorder"
              {...attributes}
              {...listeners}
            >
              <GripVertical size={15} />
            </button>
          </div>

          <h2 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9] leading-tight flex items-center gap-1.5">
            {collection.title}
            {!collection.anonymous && (
              <User size={12} className="shrink-0 text-[#2563EB] dark:text-white" aria-label="Authentication required" />
            )}
            {collection.hasCustomTable && (
              <Table size={12} className="shrink-0 text-[#2563EB] dark:text-white" aria-label="Contains custom table" />
            )}
          </h2>
          {collection.description && (
            <p className="text-xs text-[#64748B] dark:text-[#94A3B8] mt-0.5 line-clamp-2">
              {htmlToPlainText(collection.description)}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#64748B]">
          {collection.createdByName && (
            <span className="flex items-center gap-1">
              <Users size={10} />
              {collection.createdByName}
            </span>
          )}
          {collection.dateDue && (
            <span className="flex items-center gap-1">
              <Calendar size={10} />
              Due {collection.dateDue}
            </span>
          )}
          <span className="flex items-center gap-1">
            <ClipboardList size={10} />
            {collection.responseCount ?? 0} response
            {collection.responseCount !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="mt-auto pt-2 border-t border-[#F1F5F9] dark:border-[#334155] flex items-center gap-2">
          <button
            onClick={() => onCopyShareLink(collection.slug)}
            title={collection.status === 'published' ? 'Copy share link' : 'Publish to enable share link'}
            disabled={collection.status !== 'published'}
            className="flex items-center gap-1 text-[11px] text-[#64748B] hover:text-[#2563EB] transition-colors disabled:opacity-40"
          >
            <Copy size={13} />
            Copy Link
          </button>
          <button
            onClick={() => onTestForm(collection.slug)}
            title="Test Form"
            className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
          >
            <Eye size={13} />
            Test Form
          </button>
          <button
            onClick={() => onEdit(collection.id)}
            title="Edit"
            className="flex items-center gap-1 text-[11px] text-[#64748B] hover:text-[#2563EB] transition-colors"
          >
            <Edit2 size={13} />
            Edit
          </button>
          <button
            onClick={() => onDelete(collection)}
            disabled={deleting === collection.id}
            title="Delete"
            className="ml-auto flex items-center gap-1 text-[11px] text-[#64748B] hover:text-red-500 transition-colors disabled:opacity-40"
          >
            <Trash2 size={13} />
            {deleting === collection.id ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

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
  const { showToast } = useToast()
  const { user } = useAuth()
  const [collections, setCollections] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const latestOrderRef = useRef<string>('[]')
  const sensors = useSensors(useSensor(PointerSensor, {
    activationConstraint: {
      distance: 8,
    },
  }))

  async function persistCollectionOrder(ids: number[]) {
    if (!user) return

    const serialized = JSON.stringify(ids)
    latestOrderRef.current = serialized
    writeLocalCollectionOrder(user.id, ids)

    try {
      await updatePreference(COLLECTION_ORDER_PREFERENCE_KEY, serialized)
    } catch (err) {
      if (latestOrderRef.current === serialized) {
        showToast((err as Error).message || 'Failed to save collection order', 'error')
      }
    }
  }

  useEffect(() => {
    let active = true

    async function loadCollections() {
      setLoading(true)
      setError(null)
      try {
        const fetchedCollections = await listCollections()
        if (!active) return

        const localOrder = user ? readLocalCollectionOrder(user.id) : []
        const localOrderedCollections = mergeCollectionsByOrder(fetchedCollections, localOrder)
        setCollections(localOrderedCollections)

        if (!user) {
          latestOrderRef.current = JSON.stringify(fetchedCollections.map((collection) => collection.id))
          return
        }

        try {
          const savedOrder = parseCollectionOrder(await getPreference(COLLECTION_ORDER_PREFERENCE_KEY))
          if (!active) return

          const mergedCollections = savedOrder.length > 0
            ? mergeCollectionsByOrder(fetchedCollections, savedOrder)
            : localOrderedCollections
          const mergedIds = mergedCollections.map((collection) => collection.id)
          latestOrderRef.current = JSON.stringify(mergedIds)
          writeLocalCollectionOrder(user.id, mergedIds)
          setCollections(mergedCollections)
        } catch {
          latestOrderRef.current = JSON.stringify(localOrderedCollections.map((collection) => collection.id))
        }
      } catch (err) {
        if (!active) return
        setError((err as Error).message)
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadCollections()

    return () => {
      active = false
    }
  }, [user])

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
      setCollections(prev => {
        const nextCollections = prev.filter(c => c.id !== col.id)
        void persistCollectionOrder(nextCollections.map((collection) => collection.id))
        return nextCollections
      })
      showToast('Collection deleted', 'success')
    } catch (err) {
      showToast((err as Error).message, 'error')
    } finally {
      setDeleting(null)
    }
  }

  async function copyShareLink(slug: string) {
    const url = `${window.location.origin}/fill/${slug}`
    try {
      await navigator.clipboard.writeText(url)
      showToast('Share link copied to clipboard', 'success')
    } catch {
      showToast(`Copy failed. Share URL: ${url}`, 'info')
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) {
      return
    }

    setCollections((prevCollections) => {
      const oldIndex = prevCollections.findIndex((collection) => collection.id === active.id)
      const newIndex = prevCollections.findIndex((collection) => collection.id === over.id)

      if (oldIndex === -1 || newIndex === -1) {
        return prevCollections
      }

      const nextCollections = arrayMove(prevCollections, oldIndex, newIndex)
      void persistCollectionOrder(nextCollections.map((collection) => collection.id))
      return nextCollections
    })
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
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={collections.map((collection) => collection.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {collections.map((collection) => (
              <SortableCollectionCard
                key={collection.id}
                collection={collection}
                deleting={deleting}
                onCopyShareLink={copyShareLink}
                onEdit={(id) => navigate(`/collections/${id}/edit`)}
                onDelete={handleDelete}
                onTestForm={(slug) => {
                  window.open(`/fill/${slug}?preview=true`, '_blank', 'noopener')
                }}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
