import { useEffect, useState } from 'react'
import { Bell, CheckCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api/notifications'
import { useAuth } from '../contexts/AuthContext'
import type { AppNotification } from '../types'
import { timeAgo } from '../utils/timeAgo'

export default function NotificationsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  async function loadNotifications() {
    setLoading(true)
    setError(null)
    try {
      setItems(await listNotifications())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadNotifications()
  }, [])

  const unreadCount = items.filter(n => !n.isRead).length

  function openTarget(notification: AppNotification) {
    if (user?.role === 'user') {
      navigate(`/fill/${notification.collectionSlug}`)
      return
    }

    navigate(`/collections/${notification.collectionId}/edit`)
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Notifications</h1>
          <p className="text-sm text-[#64748B] mt-0.5">Due date reminders and late notices for collections.</p>
        </div>
        <button
          type="button"
          disabled={unreadCount === 0 || markingAll}
          onClick={async () => {
            setMarkingAll(true)
            try {
              await markAllNotificationsRead()
              setItems(prev => prev.map(item => ({ ...item, isRead: true, readAt: item.readAt ?? new Date().toISOString() })))
            } catch {
              // Keep current list state if update fails.
            } finally {
              setMarkingAll(false)
            }
          }}
          className="inline-flex items-center gap-1.5 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-3 py-2 rounded transition-colors"
        >
          <CheckCheck size={14} />
          {markingAll ? 'Updating…' : 'Mark All Read'}
        </button>
      </div>

      {loading && (
        <div className="rounded border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#1E293B] p-4 text-sm text-[#64748B]">
          Loading notifications...
        </div>
      )}

      {!loading && error && (
        <div className="rounded border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="rounded border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#1E293B] p-6 text-center text-sm text-[#64748B]">
          <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[#EFF6FF] dark:bg-[#1E293B] mb-2">
            <Bell size={14} className="text-[#2563EB]" />
          </div>
          <p>No notifications yet.</p>
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg divide-y divide-[#E2E8F0] dark:divide-[#334155] overflow-hidden">
          {items.map(item => (
            <div key={item.id} className={`p-4 ${item.isRead ? '' : 'bg-blue-50/40 dark:bg-blue-900/10'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  {!item.isRead && (
                    <span className="mt-1 w-2 h-2 rounded-full bg-[#DC2626] shrink-0" />
                  )}
                  <div>
                  <p className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">{item.title}</p>
                  <p className="text-sm text-[#475569] dark:text-[#94A3B8] mt-1">{item.message}</p>
                  <p className="text-xs text-[#64748B] mt-1">Due: {item.dueDate}</p>
                  <p className="text-xs text-[#94A3B8] mt-0.5">{timeAgo(item.createdAt)}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!item.isRead && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await markNotificationRead(item.id)
                          setItems(prev => prev.map(n => (n.id === item.id ? { ...n, isRead: true, readAt: n.readAt ?? new Date().toISOString() } : n)))
                        } catch {
                          // Ignore single-item read errors in list UX.
                        }
                      }}
                      className="text-xs text-[#2563EB] hover:underline"
                    >
                      Mark read
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openTarget(item)}
                    className="text-xs text-[#2563EB] hover:underline"
                  >
                    Open
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
