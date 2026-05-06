import { useState, useRef, useEffect } from 'react'
import { Bell, Sun, Moon, UserCircle, LogOut, Folder } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../api/notifications'
import { useTheme } from '../../contexts/ThemeContext'
import { useAuth } from '../../contexts/AuthContext'
import type { AppNotification, UserRole } from '../../types'
import { timeAgo } from '../../utils/timeAgo'

interface TopNavBarProps {
  onAppIconClick?: () => void
}

const ROLE_LABELS: Record<UserRole, string> = {
  administrator: 'Administrator',
  team_manager: 'Team Manager',
  user: 'User',
}

const NAV_BTN =
  'w-10 h-10 flex items-center justify-center text-[#64748B] rounded-[2px] ' +
  'hover:text-[#1E293B] dark:hover:text-[#F1F5F9] ' +
  'hover:bg-[#F1F5F9] dark:hover:bg-[#1E293B] transition-colors'

export default function TopNavBar({ onAppIconClick }: TopNavBarProps) {
  const { theme, toggle } = useTheme()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [notificationsError, setNotificationsError] = useState<string | null>(null)
  const notificationsRef = useRef<HTMLDivElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)

  async function refreshUnreadCount() {
    if (!user) return
    try {
      const count = await getUnreadNotificationCount()
      setUnreadCount(count)
    } catch {
      // Keep stale count if request fails.
    }
  }

  async function refreshNotifications() {
    if (!user) return
    setNotificationsLoading(true)
    setNotificationsError(null)
    try {
      const items = await listNotifications()
      setNotifications(items)
      setUnreadCount(items.filter(n => !n.isRead).length)
    } catch (err) {
      setNotificationsError(err instanceof Error ? err.message : 'Failed to load notifications')
    } finally {
      setNotificationsLoading(false)
    }
  }

  function openNotificationTarget(n: AppNotification) {
    if (user?.role === 'user') {
      navigate(`/fill/${n.collectionSlug}`)
      return
    }
    navigate(`/collections/${n.collectionId}/edit`)
  }

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (notificationsRef.current && !notificationsRef.current.contains(e.target as Node)) {
        setNotificationsOpen(false)
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  useEffect(() => {
    if (!user) return

    void refreshUnreadCount()
    const timer = window.setInterval(() => {
      void refreshUnreadCount()
    }, 60000)

    return () => window.clearInterval(timer)
  }, [user])

  const handleSignOut = () => {
    signOut()
    navigate('/login')
  }

  return (
    <header className="h-[60px] shrink-0 flex items-center justify-between px-4 border-b border-[#E2E8F0] dark:border-[#1E293B] bg-white dark:bg-[#0F172A]">

      {/* Left: Logo + Title */}
      <button
        type="button"
        onClick={onAppIconClick}
        className="flex items-center gap-3"
        aria-label="Toggle navigation menu"
      >
        <div className="w-[35px] h-[35px] bg-[#2563EB] flex items-center justify-center text-white shrink-0 rounded-[2px]">
          <Folder size={19} strokeWidth={2.25} />
        </div>
        <span className="font-semibold text-[17.5px] text-[#1E293B] dark:text-[#F1F5F9] hidden sm:block tracking-tight">
          Data Collection Pro
        </span>
        <span className="font-semibold text-[17.5px] text-[#1E293B] dark:text-[#F1F5F9] sm:hidden font-mono">
          DCP
        </span>
      </button>

      {/* Right: Icon actions */}
      <div className="flex items-center gap-0.5">

        {/* Notifications — visible to regular users only */}
        {user?.role === 'user' && <div className="relative" ref={notificationsRef}>
          <button
            className={`${NAV_BTN} relative`}
            title="Notifications"
            aria-label="Notifications"
            aria-expanded={notificationsOpen}
            onClick={() => {
              setNotificationsOpen(open => {
                const next = !open
                if (next) {
                  void refreshNotifications()
                  setProfileOpen(false)
                }
                return next
              })
            }}
          >
            <Bell size={19} />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#DC2626] text-white text-[10px] leading-4 font-semibold text-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {notificationsOpen && (
            <div className="absolute right-0 top-full mt-1 w-80 max-w-[calc(100vw-1rem)] bg-white dark:bg-[#0F172A] border border-[#E2E8F0] dark:border-[#1E293B] z-50 rounded-[2px] overflow-hidden">
              <div className="px-3 py-2 border-b border-[#E2E8F0] dark:border-[#1E293B] flex items-center justify-between">
                <p className="text-xs font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Notifications</p>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const updated = await markAllNotificationsRead()
                      if (updated === 0) return
                      setNotifications(prev => prev.map(item => ({ ...item, isRead: true, readAt: item.readAt ?? new Date().toISOString() })))
                      setUnreadCount(0)
                    } catch {
                      // No-op; avoid interrupting the dropdown for transient API errors.
                    }
                  }}
                  className="text-[11px] text-[#2563EB] hover:underline disabled:opacity-60"
                  disabled={unreadCount === 0}
                >
                  Mark all read
                </button>
              </div>

              <div className="max-h-80 overflow-auto">
                {notificationsLoading && (
                  <p className="px-3 py-3 text-xs text-[#64748B]">Loading notifications...</p>
                )}

                {!notificationsLoading && notificationsError && (
                  <p className="px-3 py-3 text-xs text-red-500">{notificationsError}</p>
                )}

                {!notificationsLoading && !notificationsError && notifications.length === 0 && (
                  <p className="px-3 py-3 text-xs text-[#64748B]">No notifications yet.</p>
                )}

                {!notificationsLoading && !notificationsError && notifications.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={async () => {
                      if (!item.isRead) {
                        try {
                          await markNotificationRead(item.id)
                        } catch {
                          // Continue with navigation even if read tracking fails.
                        }
                        setNotifications(prev => prev.map(n => (n.id === item.id ? { ...n, isRead: true, readAt: n.readAt ?? new Date().toISOString() } : n)))
                        setUnreadCount(prev => Math.max(0, prev - 1))
                      }
                      setNotificationsOpen(false)
                      openNotificationTarget(item)
                    }}
                    className={`w-full text-left px-3 py-2 border-b border-[#F1F5F9] dark:border-[#1E293B] hover:bg-[#F8FAFC] dark:hover:bg-[#111827] ${item.isRead ? '' : 'bg-blue-50/40 dark:bg-blue-900/10'}`}
                  >
                    <div className="flex items-start gap-2">
                      {!item.isRead && (
                        <span className="mt-0.5 w-2 h-2 rounded-full bg-[#DC2626] shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#1E293B] dark:text-[#F1F5F9]">
                          {item.title}
                        </p>
                        <p className="text-[11px] text-[#64748B] mt-0.5 leading-relaxed">
                          {item.message}
                        </p>
                        <p className="text-[10px] text-[#94A3B8] mt-1">{timeAgo(item.createdAt)}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="px-3 py-2 border-t border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-[#111827]">
                <button
                  type="button"
                  onClick={() => {
                    setNotificationsOpen(false)
                    navigate('/notifications')
                  }}
                  className="w-full text-left text-xs font-medium text-[#2563EB] hover:underline"
                >
                  View all notifications
                </button>
              </div>
            </div>
          )}
        </div>}

        {/* Theme toggle */}
        <button
          onClick={toggle}
          className={NAV_BTN}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle colour theme"
        >
          {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
        </button>

        {/* User profile */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => {
              setProfileOpen(o => !o)
              setNotificationsOpen(false)
            }}
            className={NAV_BTN}
            title={user ? `${user.name} — ${ROLE_LABELS[user.role]}` : 'Profile'}
            aria-label="User profile"
            aria-expanded={profileOpen}
          >
            <UserCircle size={19} />
          </button>

          {profileOpen && user && (
            <div className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-[#0F172A] border border-[#E2E8F0] dark:border-[#1E293B] z-50">
              <div className="px-3 py-2.5 border-b border-[#E2E8F0] dark:border-[#1E293B]">
                <p className="text-xs font-semibold text-[#1E293B] dark:text-[#F1F5F9] truncate">
                  {user.name}
                </p>
                <p className="text-[9px] tracking-[0.18em] text-[#64748B] dark:text-[#475569] uppercase mt-0.5 font-mono">
                  {ROLE_LABELS[user.role]}
                </p>
              </div>
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#64748B] hover:bg-[#F1F5F9] dark:hover:bg-[#1E293B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9] transition-colors"
              >
                <LogOut size={15} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
