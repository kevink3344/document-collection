import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  CalendarCheck,
  Copy,
  Eye,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import { createCollection, getCollection, updateCollection } from '../api/collections'
import { listSlots, createSlot, updateSlot, deleteSlot } from '../api/signupSlots'
import { listCategories } from '../api/categories'
import { useToast } from '../contexts/ToastContext'
import type { Category, Collection, CollectionStatus, SignupSlot } from '../types'

const AUTOSAVE_DEBOUNCE_MS = 1200

interface SlotDraft {
  id?: number // undefined = new (not yet saved)
  slotDate: string
  startTime: string
  endTime: string
  label: string
  maxCapacity: number
  sortOrder: number
  _key: string // client-only stable key for React
}

function makeKey() {
  return Math.random().toString(36).slice(2)
}

function blankSlot(sortOrder: number): SlotDraft {
  return {
    slotDate: '',
    startTime: '',
    endTime: '',
    label: 'Conference',
    maxCapacity: 1,
    sortOrder,
    _key: makeKey(),
  }
}

export default function SignupSheetBuilderPage() {
  const navigate = useNavigate()
  const { id: idParam } = useParams<{ id: string }>()
  const collectionId = idParam ? parseInt(idParam, 10) : null
  const isEditing = collectionId !== null

  const { showToast } = useToast()

  // ── Metadata ───────────────────────────────────────────────
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState<CollectionStatus>('draft')
  const [categories, setCategories] = useState<Category[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [categoriesError, setCategoriesError] = useState<string | null>(null)
  const [slots, setSlots] = useState<SlotDraft[]>([blankSlot(0)])
  const [savedCollectionId, setSavedCollectionId] = useState<number | null>(collectionId)
  const [savedSlug, setSavedSlug] = useState<string | null>(null)
  const [loading, setLoading] = useState(isEditing)
  const [saving, setSaving] = useState(false)

  // ── Load categories ────────────────────────────────────────
  useEffect(() => {
    listCategories()
      .then(setCategories)
      .catch(err => setCategoriesError((err as Error).message))
      .finally(() => setCategoriesLoading(false))
  }, [])

  // ── Load existing ──────────────────────────────────────────
  useEffect(() => {
    if (!isEditing || !collectionId) return
    let active = true

    async function load() {
      setLoading(true)
      try {
        const [col, existingSlots] = await Promise.all([
          getCollection(collectionId!),
          listSlots(collectionId!),
        ])
        if (!active) return
        setTitle(col.title)
        setDescription(col.description ?? '')
        setCategory(col.category ?? '')
        setStatus(col.status)
        setSavedSlug(col.slug)
        setSlots(
          existingSlots.length > 0
            ? existingSlots.map(s => ({
                id: s.id,
                slotDate: s.slotDate,
                startTime: s.startTime,
                endTime: s.endTime,
                label: s.label,
                maxCapacity: s.maxCapacity,
                sortOrder: s.sortOrder,
                _key: makeKey(),
              }))
            : [blankSlot(0)],
        )
      } catch (err) {
        if (!active) return
        showToast((err as Error).message, 'error')
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [collectionId, isEditing, showToast])

  // ── Save / auto-save ───────────────────────────────────────
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const saveCollection = useCallback(
    async (currentTitle: string, currentDescription: string, currentStatus: CollectionStatus, currentCategory: string) => {
      if (!currentTitle.trim()) return null
      setSaving(true)
      try {
        let col: Collection
        const payload = {
          title: currentTitle.trim(),
          description: currentDescription.trim() || undefined,
          category: currentCategory.trim() || undefined,
          status: currentStatus,
          collectionType: 'signup_sheet' as const,
          anonymous: false,
          allowSubmissionEdits: false,
          fields: [],
        }
        if (savedCollectionId) {
          col = await updateCollection(savedCollectionId, payload)
        } else {
          col = await createCollection(payload)
          setSavedCollectionId(col.id)
          setSavedSlug(col.slug)
          navigate(`/collections/${col.id}/signup-builder`, { replace: true })
        }
        setSavedSlug(col.slug)
        return col.id
      } catch (err) {
        showToast((err as Error).message, 'error')
        return null
      } finally {
        setSaving(false)
      }
    },
    [savedCollectionId, navigate, showToast],
  )

  const categoryOptions = useMemo(() => {
    const names = categories.map(c => c.name)
    if (category && !names.some(n => n.toLowerCase() === category.toLowerCase())) {
      return [...names, category]
    }
    return names
  }, [categories, category])

  function scheduleAutoSave(t: string, d: string, s: CollectionStatus, c: string) {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      void saveCollection(t, d, s, c)
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  function handleTitleChange(v: string) {
    setTitle(v)
    scheduleAutoSave(v, description, status, category)
  }

  function handleDescriptionChange(v: string) {
    setDescription(v)
    scheduleAutoSave(title, v, status, category)
  }

  async function handleStatusToggle() {
    const next: CollectionStatus = status === 'draft' ? 'published' : 'draft'
    setStatus(next)
    await saveCollection(title, description, next, category)
  }

  // ── Slot CRUD ──────────────────────────────────────────────

  function addSlot() {
    setSlots(prev => [...prev, blankSlot(prev.length)])
  }

  function updateSlotDraft(key: string, patch: Partial<SlotDraft>) {
    setSlots(prev => prev.map(s => (s._key === key ? { ...s, ...patch } : s)))
  }

  async function saveSlot(draft: SlotDraft) {
    if (!draft.slotDate || !draft.startTime || !draft.endTime) {
      showToast('Please fill in date, start time, and end time before saving', 'error')
      return
    }
    let cid = savedCollectionId
    if (!cid) {
      cid = await saveCollection(title, description, status)
      if (!cid) return
    }
    try {
      const payload = {
        slotDate: draft.slotDate,
        startTime: draft.startTime,
        endTime: draft.endTime,
        label: draft.label,
        maxCapacity: draft.maxCapacity,
        sortOrder: draft.sortOrder,
      }
      let saved: SignupSlot
      if (draft.id) {
        saved = await updateSlot(cid, draft.id, payload)
      } else {
        saved = await createSlot(cid, payload)
      }
      setSlots(prev =>
        prev.map(s =>
          s._key === draft._key ? { ...s, id: saved.id } : s,
        ),
      )
      showToast('Slot saved', 'success')
    } catch (err) {
      showToast((err as Error).message, 'error')
    }
  }

  async function removeSlot(draft: SlotDraft) {
    if (draft.id && savedCollectionId) {
      try {
        await deleteSlot(savedCollectionId, draft.id)
      } catch (err) {
        showToast((err as Error).message, 'error')
        return
      }
    }
    setSlots(prev => prev.filter(s => s._key !== draft._key))
  }

  // ── Render ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-[#64748B] text-sm">
        Loading…
      </div>
    )
  }

  const publicUrl = savedCollectionId
    ? `${window.location.origin}/signup/${slots.length > 0 ? '' : ''}` // resolved below
    : null

  const fillSlug = savedCollectionId ? `/signup/${encodeURIComponent(title.toLowerCase().replace(/\s+/g, '-'))}` : null

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <p className="text-sm uppercase tracking-[0.18em] text-[#2563EB] font-semibold flex items-center gap-2">
            <CalendarCheck size={14} />
            Sign-Up Sheet
          </p>
          <h1 className="text-2xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">
            {isEditing ? 'Edit sign-up sheet' : 'New sign-up sheet'}
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {saving && (
            <span className="text-xs text-[#94A3B8]">Saving…</span>
          )}
          <button
            type="button"
            onClick={handleStatusToggle}
            className={[
              'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors',
              status === 'published'
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300',
            ].join(' ')}
          >
            {status === 'published' ? 'Published' : 'Draft — click to publish'}
          </button>
          {savedCollectionId && savedSlug && status === 'published' && (
            <button
              type="button"
              onClick={() => window.open(`/signup/${savedSlug}`, '_blank', 'noopener')}
              className="inline-flex items-center gap-1.5 rounded border border-[#CBD5E1] dark:border-[#334155] px-3 py-1.5 text-xs text-[#64748B] hover:text-[#2563EB] transition-colors"
            >
              <Eye size={13} /> Preview
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              await saveCollection(title, description, status, category)
              showToast('Saved', 'success')
            }}
            disabled={saving || !title.trim()}
            className="inline-flex items-center gap-1.5 rounded bg-[#2563EB] text-white px-3 py-1.5 text-xs font-semibold hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            <Save size={13} /> Save
          </button>
        </div>
      </div>

      {/* Metadata */}
      <div className="rounded-xl border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#1E293B] p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9] uppercase tracking-wide">General</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={e => handleTitleChange(e.target.value)}
              placeholder="e.g. Fall 2028 Conferences"
              className="w-full rounded border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#0F172A] px-3 py-2 text-sm text-[#1E293B] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => handleDescriptionChange(e.target.value)}
              rows={2}
              placeholder="Optional description shown to respondents"
              className="w-full rounded border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#0F172A] px-3 py-2 text-sm text-[#1E293B] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#2563EB] resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">Category</label>
            <select
              value={category}
              onChange={e => {
                setCategory(e.target.value)
                scheduleAutoSave(title, description, status, e.target.value)
              }}
              disabled={categoriesLoading || categoryOptions.length === 0}
              className="w-full rounded border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#0F172A] px-3 py-2 text-sm text-[#1E293B] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#2563EB] disabled:opacity-50"
            >
              <option value="">Select a category</option>
              {categoryOptions.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            {categoriesError ? (
              <p className="mt-1 text-xs text-red-500">{categoriesError}</p>
            ) : (
              <p className="mt-1 text-xs text-[#64748B]">
                {categoriesLoading ? 'Loading categories…' : 'Categories are managed in Settings.'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Slots */}
      <div className="rounded-xl border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#1E293B] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9] uppercase tracking-wide">Time Slots</h2>
          <button
            type="button"
            onClick={addSlot}
            className="inline-flex items-center gap-1 text-xs text-[#2563EB] hover:underline"
          >
            <Plus size={13} /> Add slot
          </button>
        </div>

        {/* Column headers */}
        <div className="hidden md:grid grid-cols-[1fr_1fr_1fr_2fr_80px_auto] gap-2 text-[10px] font-semibold uppercase tracking-wide text-[#94A3B8] px-1">
          <span>Date</span>
          <span>Start time</span>
          <span>End time</span>
          <span>Label</span>
          <span>Capacity</span>
          <span />
        </div>

        <div className="space-y-2">
          {slots.map((slot) => (
            <div
              key={slot._key}
              className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_2fr_80px_auto] gap-2 items-center p-3 rounded-lg bg-[#F8FAFC] dark:bg-[#0F172A] border border-[#E2E8F0] dark:border-[#334155]"
            >
              <input
                type="date"
                value={slot.slotDate}
                onChange={e => updateSlotDraft(slot._key, { slotDate: e.target.value })}
                className="rounded border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#1E293B] px-2 py-1.5 text-sm text-[#1E293B] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
              <input
                type="time"
                value={slot.startTime}
                onChange={e => updateSlotDraft(slot._key, { startTime: e.target.value })}
                className="rounded border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#1E293B] px-2 py-1.5 text-sm text-[#1E293B] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
              <input
                type="time"
                value={slot.endTime}
                onChange={e => updateSlotDraft(slot._key, { endTime: e.target.value })}
                className="rounded border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#1E293B] px-2 py-1.5 text-sm text-[#1E293B] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
              <input
                type="text"
                value={slot.label}
                onChange={e => updateSlotDraft(slot._key, { label: e.target.value })}
                placeholder="Label"
                className="rounded border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#1E293B] px-2 py-1.5 text-sm text-[#1E293B] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
              <input
                type="number"
                min={1}
                max={999}
                value={slot.maxCapacity}
                onChange={e => updateSlotDraft(slot._key, { maxCapacity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                className="rounded border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#1E293B] px-2 py-1.5 text-sm text-[#1E293B] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void saveSlot(slot)}
                  title="Save slot"
                  className="rounded p-1.5 text-[#2563EB] hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                >
                  <Save size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => void removeSlot(slot)}
                  title="Remove slot"
                  className="rounded p-1.5 text-[#94A3B8] hover:text-red-500 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {slots.length === 0 && (
          <p className="text-sm text-center text-[#94A3B8] py-4">No slots yet — click "Add slot" to begin.</p>
        )}
      </div>

      {/* Public link */}
      {savedCollectionId && savedSlug && (
        <div className="rounded-xl border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#1E293B] p-6 space-y-2">
          <h2 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9] uppercase tracking-wide">Public Link</h2>
          <p className="text-xs text-[#64748B]">Share this URL so people can sign up for slots. The sheet must be published first.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded border border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A] px-3 py-2 text-xs text-[#1E293B] dark:text-[#CBD5E1]">
              {`${window.location.origin}/signup/${savedSlug}`}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(`${window.location.origin}/signup/${savedSlug}`)
                showToast('Link copied', 'success')
              }}
              className="inline-flex items-center gap-1 text-xs text-[#2563EB] hover:underline"
            >
              <Copy size={13} /> Copy
            </button>
          </div>
        </div>
      )}

      {/* Back */}
      <div>
        <button
          type="button"
          onClick={() => navigate('/collections')}
          className="text-xs text-[#64748B] hover:text-[#2563EB] transition-colors"
        >
          ← Back to collections
        </button>
      </div>
    </div>
  )
}
