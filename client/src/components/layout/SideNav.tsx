import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Database,
  FileText,
  BarChart3,
  Settings,
  ClipboardCheck,
  X,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import type { LucideIcon } from 'lucide-react'

interface SideNavProps {
  mobileDrawerOpen?: boolean
  onCloseMobileDrawer?: () => void
}

interface NavItem {
  icon: LucideIcon
  label: string
  to: string
}

const NAV_ITEMS: NavItem[] = [
  { icon: LayoutDashboard, label: 'Dashboard',       to: '/dashboard'        },
  { icon: Database,        label: 'Collections',     to: '/collections'      },
  { icon: FileText,        label: 'Records',         to: '/records'          },
  { icon: BarChart3,       label: 'Reports',         to: '/reports'          },
  { icon: Settings,        label: 'Settings',        to: '/settings'         },
]

const USER_NAV_ITEMS: NavItem[] = [
  { icon: LayoutDashboard, label: 'Dashboard',       to: '/dashboard'        },
  { icon: ClipboardCheck,  label: 'My Submissions',  to: '/my-submissions'   },
]

export default function SideNav({
  mobileDrawerOpen = false,
  onCloseMobileDrawer,
}: SideNavProps) {
  const { user } = useAuth()
  const visibleNavItems =
    user?.role === 'user'
      ? USER_NAV_ITEMS
      : NAV_ITEMS

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────── */}
      <nav className="hidden md:flex flex-col w-14 lg:w-48 shrink-0 border-r border-[#E2E8F0] dark:border-[#1E293B] bg-white dark:bg-[#0F172A] py-2">
        {visibleNavItems.map(item => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              title={item.label}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors text-left',
                  isActive
                    ? 'bg-[#F1F5F9] dark:bg-[#1E293B] text-[#1E293B] dark:text-[#F1F5F9]'
                    : 'text-[#64748B] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]/80 hover:text-[#1E293B] dark:hover:text-[#F1F5F9]',
                ].join(' ')
              }
            >
              <Icon size={18} className="shrink-0" />
              <span className="hidden lg:block">{item.label}</span>
            </NavLink>
          )
        })}
      </nav>

      {/* ── Mobile left drawer ───────────────────────────── */}
      {mobileDrawerOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={onCloseMobileDrawer}
            className="absolute inset-0 bg-black/40"
          />
          <aside className="absolute left-0 top-0 h-full w-64 bg-white dark:bg-[#0F172A] border-r border-[#E2E8F0] dark:border-[#1E293B] py-3 shadow-xl">
            <div className="flex items-center justify-between px-3 pb-2 border-b border-[#E2E8F0] dark:border-[#1E293B]">
              <span className="text-xs font-semibold tracking-[0.2em] uppercase text-[#64748B]">Navigation</span>
              <button
                type="button"
                onClick={onCloseMobileDrawer}
                className="w-7 h-7 flex items-center justify-center text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9] hover:bg-[#F1F5F9] dark:hover:bg-[#1E293B] rounded-[2px] transition-colors"
                aria-label="Close menu"
              >
                <X size={15} />
              </button>
            </div>
            <nav className="pt-2">
              {visibleNavItems.map(item => {
                const Icon = item.icon
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={onCloseMobileDrawer}
                    title={item.label}
                    className={({ isActive }) =>
                      [
                        'flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors text-left',
                        isActive
                          ? 'bg-[#F1F5F9] dark:bg-[#1E293B] text-[#1E293B] dark:text-[#F1F5F9]'
                          : 'text-[#64748B] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]/80 hover:text-[#1E293B] dark:hover:text-[#F1F5F9]',
                      ].join(' ')
                    }
                  >
                    <Icon size={18} className="shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                )
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* ── Mobile bottom tab bar ───────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex border-t border-[#E2E8F0] dark:border-[#1E293B] bg-white dark:bg-[#0F172A]">
        {visibleNavItems.map(item => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              aria-label={item.label}
              className={({ isActive }) =>
                [
                  'flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[9px] font-medium tracking-wide uppercase transition-colors',
                  isActive
                    ? 'text-[#2563EB]'
                    : 'text-[#94A3B8] hover:text-[#64748B] dark:hover:text-[#94A3B8]',
                ].join(' ')
              }
            >
              <Icon size={17} />
              <span>{item.label}</span>
            </NavLink>
          )
        })}
      </nav>
    </>
  )
}
