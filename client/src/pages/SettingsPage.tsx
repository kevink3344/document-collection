import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Plus, Save, Tag, Trash2, X } from 'lucide-react'
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from '../api/categories'
import { useAuth } from '../contexts/AuthContext'
import type { Category } from '../types'
import { getCategoryColorClasses } from '../utils/categoryColors'

const INPUT =
  'w-full border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0F172A] ' +
  'text-[#1E293B] dark:text-[#F1F5F9] placeholder-[#94A3B8] px-3 py-2 text-sm rounded ' +
  'focus:outline-none focus:ring-2 focus:ring-[#2563EB]'

export default function SettingsPage() {
  const { user } = useAuth()
  const [categories, setCategories] = useState<Category[]>([])
  const [newCategoryName, setNewCategoryName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categoriesExpanded, setCategoriesExpanded] = useState(false)

  useEffect(() => {
    listCategories()
      .then(setCategories)
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false))
  }, [])

  async function handleCreateCategory() {
    const name = newCategoryName.trim()
    if (!name) return

    setSaving(true)
    setError(null)
    try {
      const created = await createCategory(name)
      setCategories(prev => [...prev, created])
      setNewCategoryName('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveCategory(id: number) {
    const name = editingName.trim()
    if (!name) return

    setSaving(true)
    setError(null)
    try {
      const updated = await updateCategory(id, name)
      setCategories(prev => prev.map(category => (category.id === id ? updated : category)))
      setEditingId(null)
      setEditingName('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteCategory(id: number) {
    setSaving(true)
    setError(null)
    try {
      await deleteCategory(id)
      setCategories(prev => prev.filter(category => category.id !== id))
      if (editingId === id) {
        setEditingId(null)
        setEditingName('')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-40 text-[#64748B]">Loading settings…</div>
  }

  if (user?.role !== 'administrator') {
    return (
      <div className="rounded border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-4 text-amber-700 dark:text-amber-300 text-sm">
        Only administrators can manage categories.
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Settings</h1>
        <p className="text-sm text-[#64748B] mt-0.5">Manage collection categories used throughout the application.</p>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setCategoriesExpanded(expanded => !expanded)}
          className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
        >
          <div>
            <h2 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Categories</h2>
            <p className="text-sm text-[#64748B] mt-1">Collections use this list as the category dropdown.</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs font-medium text-[#64748B]">{categories.length} total</span>
            {categoriesExpanded ? (
              <ChevronDown size={18} className="text-[#64748B]" />
            ) : (
              <ChevronRight size={18} className="text-[#64748B]" />
            )}
          </div>
        </button>

        {categoriesExpanded && (
          <div className="border-t border-[#E2E8F0] dark:border-[#334155] p-5 space-y-5">
            <div className="flex flex-wrap gap-2">
              {categories.map(category => {
                const colors = getCategoryColorClasses(category.name)
                return (
                  <span
                    key={`badge-${category.id}`}
                    className={`inline-flex items-center gap-1.5 rounded-[2px] px-3 py-1 text-xs font-semibold ${colors.badge}`}
                  >
                    <Tag size={12} />
                    {category.name}
                  </span>
                )
              })}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="text"
                value={newCategoryName}
                onChange={e => setNewCategoryName(e.target.value)}
                placeholder="Add a new category"
                className={INPUT}
              />
              <button
                type="button"
                onClick={handleCreateCategory}
                disabled={saving || !newCategoryName.trim()}
                className="inline-flex items-center justify-center gap-1.5 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
              >
                <Plus size={14} />
                Add Category
              </button>
            </div>

            <div className="space-y-3">
              {categories.map(category => {
                const isEditing = editingId === category.id
                const colors = getCategoryColorClasses(category.name)
                return (
                  <div
                    key={category.id}
                    className={`flex flex-col gap-3 rounded-lg border ${colors.card} bg-[#F8FAFC] dark:bg-[#0F172A] p-4 sm:flex-row sm:items-center`}
                  >
                    <div className="flex-1">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editingName}
                          onChange={e => setEditingName(e.target.value)}
                          className={INPUT}
                        />
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex items-center gap-1.5 rounded-[2px] px-3 py-1 text-xs font-semibold ${colors.badge}`}>
                            <Tag size={12} />
                            {category.name}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleSaveCategory(category.id)}
                            disabled={saving || !editingName.trim()}
                            className="inline-flex items-center gap-1.5 bg-[#16A34A] hover:bg-[#15803D] disabled:opacity-60 text-white text-sm font-medium px-3 py-2 rounded transition-colors"
                          >
                            <Save size={14} />
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null)
                              setEditingName('')
                            }}
                            disabled={saving}
                            className="inline-flex items-center gap-1.5 border border-[#CBD5E1] dark:border-[#334155] text-[#475569] dark:text-[#CBD5E1] text-sm font-medium px-3 py-2 rounded hover:bg-[#F1F5F9] dark:hover:bg-[#1E293B] transition-colors"
                          >
                            <X size={14} />
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(category.id)
                            setEditingName(category.name)
                          }}
                          disabled={saving}
                          className="inline-flex items-center gap-1.5 border border-[#CBD5E1] dark:border-[#334155] text-[#475569] dark:text-[#CBD5E1] text-sm font-medium px-3 py-2 rounded hover:bg-[#F1F5F9] dark:hover:bg-[#1E293B] transition-colors"
                        >
                          <Pencil size={14} />
                          Edit
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => void handleDeleteCategory(category.id)}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm font-medium px-3 py-2 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}