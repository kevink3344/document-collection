import { useEffect, useState } from 'react'
import { Bell, ChevronDown, ChevronRight, Code2, ExternalLink, MessageSquare, Pencil, Plus, Save, Tag, Trash2, Users, X } from 'lucide-react'
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from '../api/categories'
import { getPublicSetting, updateSetting } from '../api/settings'
import { listUsers, createUser, deleteUser, type AppUser } from '../api/users'
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
  const [apiExpanded, setApiExpanded] = useState(false)
  const [notificationsExpanded, setNotificationsExpanded] = useState(false)
  const [loginPageExpanded, setLoginPageExpanded] = useState(false)
  const [usersExpanded, setUsersExpanded] = useState(false)
  const [allUsers, setAllUsers] = useState<AppUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [newUserName, setNewUserName] = useState('')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserRole, setNewUserRole] = useState<'user' | 'team_manager' | 'administrator'>('user')
  const [newUserOrg, setNewUserOrg] = useState('')
  const [userCreateSaving, setUserCreateSaving] = useState(false)
  const [userCreateError, setUserCreateError] = useState<string | null>(null)
  const [userCreateSuccess, setUserCreateSuccess] = useState<number | null>(null)
  const [userDeleteError, setUserDeleteError] = useState<string | null>(null)
  const [loginSubtitle, setLoginSubtitle] = useState('')
  const [loginSubtitleDraft, setLoginSubtitleDraft] = useState('')
  const [loginSubtitleSaving, setLoginSubtitleSaving] = useState(false)
  const [loginSubtitleError, setLoginSubtitleError] = useState<string | null>(null)
  const [loginSubtitleSaved, setLoginSubtitleSaved] = useState(false)
  const [loginMessage, setLoginMessage] = useState('')
  const [loginMessageDraft, setLoginMessageDraft] = useState('')
  const [loginMessageSaving, setLoginMessageSaving] = useState(false)
  const [loginMessageError, setLoginMessageError] = useState<string | null>(null)
  const [loginMessageSaved, setLoginMessageSaved] = useState(false)
  const [reminderDays, setReminderDays] = useState('-3')
  const [reminderDaysDraft, setReminderDaysDraft] = useState('-3')
  const [lateDays, setLateDays] = useState('1')
  const [lateDaysDraft, setLateDaysDraft] = useState('1')
  const [notificationWindowSaving, setNotificationWindowSaving] = useState(false)
  const [notificationWindowError, setNotificationWindowError] = useState<string | null>(null)
  const [notificationWindowSaved, setNotificationWindowSaved] = useState(false)

  useEffect(() => {
    getPublicSetting('login_subtitle')
      .then(val => { setLoginSubtitle(val); setLoginSubtitleDraft(val) })
      .catch(() => {})
    getPublicSetting('login_message')
      .then(val => { setLoginMessage(val); setLoginMessageDraft(val) })
      .catch(() => {})
    getPublicSetting('notification_reminder_days')
      .then(val => {
        setReminderDays(val)
        setReminderDaysDraft(val)
      })
      .catch(() => {})
    getPublicSetting('notification_late_days')
      .then(val => {
        setLateDays(val)
        setLateDaysDraft(val)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    listCategories()
      .then(setCategories)
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false))
  }, [])

  function loadUsers() {
    setUsersLoading(true)
    listUsers()
      .then(setAllUsers)
      .catch(() => {})
      .finally(() => setUsersLoading(false))
  }

  async function handleCreateUser() {
    const name = newUserName.trim()
    const email = newUserEmail.trim()
    if (!name || !email) return
    setUserCreateSaving(true)
    setUserCreateError(null)
    setUserCreateSuccess(null)
    try {
      const created = await createUser({ name, email, role: newUserRole, organization: newUserOrg.trim() || undefined })
      setAllUsers(prev => [...prev, created])
      setUserCreateSuccess(created.id)
      setNewUserName('')
      setNewUserEmail('')
      setNewUserOrg('')
      setNewUserRole('user')
    } catch (err) {
      setUserCreateError((err as Error).message)
    } finally {
      setUserCreateSaving(false)
    }
  }

  async function handleDeleteUser(id: number) {
    setUserDeleteError(null)
    try {
      await deleteUser(id)
      setAllUsers(prev => prev.filter(u => u.id !== id))
      if (userCreateSuccess === id) setUserCreateSuccess(null)
    } catch (err) {
      setUserDeleteError((err as Error).message)
    }
  }

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

      {/* API Documentation */}
      <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setApiExpanded(expanded => !expanded)}
          className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
        >
          <div>
            <h2 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">API Documentation</h2>
            <p className="text-sm text-[#64748B] mt-1">Interactive Swagger UI for exploring and testing the REST API.</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {apiExpanded ? (
              <ChevronDown size={18} className="text-[#64748B]" />
            ) : (
              <ChevronRight size={18} className="text-[#64748B]" />
            )}
          </div>
        </button>

        {apiExpanded && (
          <div className="border-t border-[#E2E8F0] dark:border-[#334155] p-5 space-y-4">
            <p className="text-sm text-[#475569] dark:text-[#94A3B8]">
              The Swagger UI provides a full interactive reference for all available API endpoints,
              including authentication, collections, categories, and responses.
            </p>
            <a
              href={`${window.location.protocol}//${window.location.hostname}:4000/api-docs`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-[#2563EB] hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
            >
              <Code2 size={14} />
              Open Swagger UI
              <ExternalLink size={12} />
            </a>
          </div>
        )}
      </section>

      {/* Notifications */}
      <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setNotificationsExpanded(expanded => !expanded)}
          className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
        >
          <div>
            <h2 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Notifications</h2>
            <p className="text-sm text-[#64748B] mt-1">Configure reminder and late offsets for in-app due date notifications.</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {notificationsExpanded ? (
              <ChevronDown size={18} className="text-[#64748B]" />
            ) : (
              <ChevronRight size={18} className="text-[#64748B]" />
            )}
          </div>
        </button>

        {notificationsExpanded && (
          <div className="border-t border-[#E2E8F0] dark:border-[#334155] p-5 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide mb-2">
                  Reminder Offset (days)
                </label>
                <input
                  type="number"
                  value={reminderDaysDraft}
                  onChange={e => { setReminderDaysDraft(e.target.value); setNotificationWindowSaved(false) }}
                  className={INPUT}
                  placeholder="-3"
                />
                <p className="text-xs text-[#64748B] mt-1">Example: -3 sends reminder three days before due date.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide mb-2">
                  Late Offset (days)
                </label>
                <input
                  type="number"
                  value={lateDaysDraft}
                  onChange={e => { setLateDaysDraft(e.target.value); setNotificationWindowSaved(false) }}
                  className={INPUT}
                  placeholder="1"
                />
                <p className="text-xs text-[#64748B] mt-1">Example: 1 sends late notice one day after due date.</p>
              </div>
            </div>

            {notificationWindowError && (
              <p className="text-sm text-red-500">{notificationWindowError}</p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={notificationWindowSaving || (reminderDaysDraft.trim() === reminderDays && lateDaysDraft.trim() === lateDays)}
                onClick={async () => {
                  const nextReminder = parseInt(reminderDaysDraft.trim(), 10)
                  const nextLate = parseInt(lateDaysDraft.trim(), 10)

                  if (!Number.isInteger(nextReminder) || !Number.isInteger(nextLate)) {
                    setNotificationWindowError('Offsets must be whole numbers (e.g., -3 and 1).')
                    return
                  }

                  setNotificationWindowSaving(true)
                  setNotificationWindowError(null)
                  try {
                    await updateSetting('notification_reminder_days', String(nextReminder))
                    await updateSetting('notification_late_days', String(nextLate))
                    setReminderDays(String(nextReminder))
                    setLateDays(String(nextLate))
                    setReminderDaysDraft(String(nextReminder))
                    setLateDaysDraft(String(nextLate))
                    setNotificationWindowSaved(true)
                  } catch (err) {
                    setNotificationWindowError((err as Error).message)
                  } finally {
                    setNotificationWindowSaving(false)
                  }
                }}
                className="inline-flex items-center gap-1.5 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
              >
                <Bell size={14} />
                {notificationWindowSaving ? 'Saving…' : 'Save Notification Window'}
              </button>
              {notificationWindowSaved && (
                <span className="text-sm text-green-600 dark:text-green-400">Saved!</span>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Login Page */}
      <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setLoginPageExpanded(expanded => !expanded)}
          className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
        >
          <div>
            <h2 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Login Page</h2>
            <p className="text-sm text-[#64748B] mt-1">Customize the message displayed on the sign-in screen.</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {loginPageExpanded ? (
              <ChevronDown size={18} className="text-[#64748B]" />
            ) : (
              <ChevronRight size={18} className="text-[#64748B]" />
            )}
          </div>
        </button>

        {loginPageExpanded && (
          <div className="border-t border-[#E2E8F0] dark:border-[#334155] p-5 space-y-5">
            {/* Subtitle badge */}
            <div>
              <label className="block text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide mb-2">
                Subtitle Badge
              </label>
              <input
                type="text"
                value={loginSubtitleDraft}
                onChange={e => { setLoginSubtitleDraft(e.target.value); setLoginSubtitleSaved(false) }}
                className={INPUT}
                placeholder="e.g. Enterprise Staff Support"
              />
            </div>

            {loginSubtitleError && (
              <p className="text-sm text-red-500">{loginSubtitleError}</p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={loginSubtitleSaving || loginSubtitleDraft.trim() === loginSubtitle}
                onClick={async () => {
                  const val = loginSubtitleDraft.trim()
                  if (!val) return
                  setLoginSubtitleSaving(true)
                  setLoginSubtitleError(null)
                  try {
                    await updateSetting('login_subtitle', val)
                    setLoginSubtitle(val)
                    setLoginSubtitleSaved(true)
                  } catch (err) {
                    setLoginSubtitleError((err as Error).message)
                  } finally {
                    setLoginSubtitleSaving(false)
                  }
                }}
                className="inline-flex items-center gap-1.5 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
              >
                <MessageSquare size={14} />
                {loginSubtitleSaving ? 'Saving…' : 'Save Subtitle'}
              </button>
              {loginSubtitleSaved && (
                <span className="text-sm text-green-600 dark:text-green-400">Saved!</span>
              )}
            </div>

            <div className="border-t border-[#E2E8F0] dark:border-[#334155] pt-5">
              <label className="block text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide mb-2">
                Welcome Message
              </label>
              <textarea
                rows={3}
                value={loginMessageDraft}
                onChange={e => { setLoginMessageDraft(e.target.value); setLoginMessageSaved(false) }}
                className={INPUT + ' resize-none'}
                placeholder="Enter the message shown on the login page…"
              />
            </div>

            {loginMessageError && (
              <p className="text-sm text-red-500">{loginMessageError}</p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={loginMessageSaving || loginMessageDraft.trim() === loginMessage}
                onClick={async () => {
                  const val = loginMessageDraft.trim()
                  if (!val) return
                  setLoginMessageSaving(true)
                  setLoginMessageError(null)
                  try {
                    await updateSetting('login_message', val)
                    setLoginMessage(val)
                    setLoginMessageSaved(true)
                  } catch (err) {
                    setLoginMessageError((err as Error).message)
                  } finally {
                    setLoginMessageSaving(false)
                  }
                }}
                className="inline-flex items-center gap-1.5 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
              >
                <MessageSquare size={14} />
                {loginMessageSaving ? 'Saving…' : 'Save Message'}
              </button>
              {loginMessageSaved && (
                <span className="text-sm text-green-600 dark:text-green-400">Saved!</span>
              )}
            </div>
          </div>
        )}
      </section>

        {/* User Accounts */}
        <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => {
              const next = !usersExpanded
              setUsersExpanded(next)
              if (next && allUsers.length === 0) loadUsers()
            }}
            className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
          >
            <div>
              <h2 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">User Accounts</h2>
              <p className="text-sm text-[#64748B] mt-1">Create and manage accounts for testing or onboarding users.</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {usersExpanded ? (
                <ChevronDown size={18} className="text-[#64748B]" />
              ) : (
                <ChevronRight size={18} className="text-[#64748B]" />
              )}
            </div>
          </button>

          {usersExpanded && (
            <div className="border-t border-[#E2E8F0] dark:border-[#334155] p-5 space-y-6">

              {/* Create user form */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Add New User</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">Name <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={newUserName}
                      onChange={e => { setNewUserName(e.target.value); setUserCreateSuccess(null) }}
                      placeholder="Jane Smith"
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">Email <span className="text-red-500">*</span></label>
                    <input
                      type="email"
                      value={newUserEmail}
                      onChange={e => { setNewUserEmail(e.target.value); setUserCreateSuccess(null) }}
                      placeholder="jane@example.com"
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">Role</label>
                    <select
                      value={newUserRole}
                      onChange={e => setNewUserRole(e.target.value as typeof newUserRole)}
                      className={INPUT}
                    >
                      <option value="user">User</option>
                      <option value="team_manager">Team Manager</option>
                      <option value="administrator">Administrator</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">Organization <span className="text-[#94A3B8]">(optional)</span></label>
                    <input
                      type="text"
                      value={newUserOrg}
                      onChange={e => setNewUserOrg(e.target.value)}
                      placeholder="Alpha Team"
                      className={INPUT}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleCreateUser()}
                    disabled={userCreateSaving || !newUserName.trim() || !newUserEmail.trim()}
                    className="inline-flex items-center gap-1.5 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
                  >
                    <Users size={14} />
                    {userCreateSaving ? 'Creating…' : 'Create User'}
                  </button>
                  {userCreateError && <span className="text-sm text-red-500">{userCreateError}</span>}
                  {userCreateSuccess && (
                    <span className="text-sm text-green-600 dark:text-green-400">
                      Created! Log in with User ID <strong>{userCreateSuccess}</strong>
                    </span>
                  )}
                </div>
              </div>

              {/* User list */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">All Users</h3>
                  <button
                    type="button"
                    onClick={loadUsers}
                    disabled={usersLoading}
                    className="text-xs text-[#64748B] hover:text-[#2563EB] transition-colors disabled:opacity-40"
                  >
                    {usersLoading ? 'Loading…' : 'Refresh'}
                  </button>
                </div>

                {userDeleteError && (
                  <p className="text-sm text-red-500">{userDeleteError}</p>
                )}

                <div className="rounded-lg border border-[#E2E8F0] dark:border-[#334155] overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[#F8FAFC] dark:bg-[#0F172A] text-left">
                        <th className="px-4 py-2.5 text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide w-12">ID</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide">Name</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide hidden sm:table-cell">Email</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide hidden md:table-cell">Role</th>
                        <th className="px-4 py-2.5 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#334155]">
                      {allUsers.map(u => (
                        <tr key={u.id} className={`${u.id === user?.id ? 'bg-blue-50 dark:bg-blue-900/10' : ''}`}>
                          <td className="px-4 py-2.5 text-[#94A3B8] font-mono text-xs">{u.id}</td>
                          <td className="px-4 py-2.5 text-[#1E293B] dark:text-[#F1F5F9]">
                            {u.name}
                            {u.id === user?.id && (
                              <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">(you)</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-[#64748B] hidden sm:table-cell">{u.email}</td>
                          <td className="px-4 py-2.5 hidden md:table-cell">
                            <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-[2px] ${
                              u.role === 'administrator'
                                ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                                : u.role === 'team_manager'
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                : 'bg-[#E2E8F0] text-[#475569] dark:bg-[#334155] dark:text-[#CBD5E1]'
                            }`}>
                              {u.role}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {u.id !== user?.id && (
                              <button
                                type="button"
                                onClick={() => void handleDeleteUser(u.id)}
                                className="text-[#94A3B8] hover:text-red-500 transition-colors"
                                title={`Delete ${u.name}`}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {allUsers.length === 0 && !usersLoading && (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-sm text-[#94A3B8] italic">No users found.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-[#94A3B8]">To log in as a user, use the ID shown above on the login screen.</p>
              </div>

            </div>
          )}
        </section>
    </div>
  )
}