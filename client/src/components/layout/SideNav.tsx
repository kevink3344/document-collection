import { useState } from 'react'
import {
  LayoutDashboard,
  Database,
  FileText,
  BarChart3,
  Users,
  Settings,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface NavItem {
  icon: LucideIcon
  label: string
  id: string
}

const NAV_ITEMS: NavItem[] = [
  { icon: LayoutDashboard, label: 'Dashboard',   id: 'dashboard'   },
  { icon: Database,        label: 'Collections', id: 'collections' },
  { icon: FileText,        label: 'Records',     id: 'records'     },
  { icon: BarChart3,       label: 'Reports',     id: 'reports'     },
  { icon: Users,           label: 'Users',       id: 'users'       },
  { icon: Settings,        label: 'Settings',    id: 'settings'    },
]

export default function SideNav() {
  const [active, setActive] = useState('dashboard')

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────── */}
      <nav className="hidden md:flex flex-col w-14 lg:w-48 shrink-0 border-r border-[#E2E8F0] dark:border-[#1E293B] bg-white dark:bg-[#0F172A] py-2">
        {NAV_ITEMS.map(item => {
          const Icon = item.icon
          const isActive = active === item.id
          return (
            <button
              key={item.id}
              onClick={() => setActive(item.id)}
              title={item.label}
              className={[
                'flex items-center gap-3 px-4 py-2.5 text-xs font-medium transition-colors text-left',
                isActive
                  ? 'bg-[#F1F5F9] dark:bg-[#1E293B] text-[#1E293B] dark:text-[#F1F5F9]'
                  : 'text-[#64748B] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]/80 hover:text-[#1E293B] dark:hover:text-[#F1F5F9]',
              ].join(' ')}
            >
              <Icon size={15} className="shrink-0" />
              <span className="hidden lg:block">{item.label}</span>
            </button>
          )
        })}
      </nav>

      {/* ── Mobile bottom tab bar ───────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex border-t border-[#E2E8F0] dark:border-[#1E293B] bg-white dark:bg-[#0F172A]">
        {NAV_ITEMS.slice(0, 5).map(item => {
          const Icon = item.icon
          const isActive = active === item.id
          return (
            <button
              key={item.id}
              onClick={() => setActive(item.id)}
              aria-label={item.label}
              className={[
                'flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[9px] font-medium tracking-wide uppercase transition-colors',
                isActive
                  ? 'text-[#2563EB]'
                  : 'text-[#94A3B8] hover:text-[#64748B] dark:hover:text-[#94A3B8]',
              ].join(' ')}
            >
              <Icon size={17} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>
    </>
  )
}
