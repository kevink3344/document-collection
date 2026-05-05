import { useState, useRef, useEffect } from 'react'
import { Settings, Sun, Moon, UserCircle, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '../../contexts/ThemeContext'
import { useAuth } from '../../contexts/AuthContext'
import type { UserRole } from '../../types'

const ROLE_LABELS: Record<UserRole, string> = {
  administrator: 'Administrator',
  team_manager: 'Team Manager',
  user: 'User',
}

const NAV_BTN =
  'w-8 h-8 flex items-center justify-center text-[#64748B] rounded-[2px] ' +
  'hover:text-[#1E293B] dark:hover:text-[#F1F5F9] ' +
  'hover:bg-[#F1F5F9] dark:hover:bg-[#1E293B] transition-colors'

export default function TopNavBar() {
  const { theme, toggle } = useTheme()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const handleSignOut = () => {
    signOut()
    navigate('/login')
  }

  return (
    <header className="h-12 shrink-0 flex items-center justify-between px-4 md:px-6 border-b border-[#E2E8F0] dark:border-[#1E293B] bg-white dark:bg-[#0F172A]">

      {/* Left: Logo + Title */}
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 bg-[#2563EB] flex items-center justify-center text-white font-bold font-mono text-[10px] tracking-wider shrink-0">
          DC
        </div>
        <span className="font-semibold text-sm text-[#1E293B] dark:text-[#F1F5F9] hidden sm:block tracking-tight">
          Data Collection Pro
        </span>
        <span className="font-semibold text-sm text-[#1E293B] dark:text-[#F1F5F9] sm:hidden font-mono">
          DCP
        </span>
      </div>

      {/* Right: Icon actions */}
      <div className="flex items-center gap-0.5">

        {/* Settings */}
        <button className={NAV_BTN} title="Settings" aria-label="Settings">
          <Settings size={15} />
        </button>

        {/* Theme toggle */}
        <button
          onClick={toggle}
          className={NAV_BTN}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle colour theme"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        {/* User profile */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setProfileOpen(o => !o)}
            className={NAV_BTN}
            title={user ? `${user.name} — ${ROLE_LABELS[user.role]}` : 'Profile'}
            aria-label="User profile"
            aria-expanded={profileOpen}
          >
            <UserCircle size={15} />
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
                <LogOut size={12} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
