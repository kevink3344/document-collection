import { useEffect, useRef, useState } from 'react'
import { MapPin } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'

function getOrganizationLabel(organization: {
  organizationName: string
  organizationDescription?: string | null
}) {
  return organization.organizationDescription?.trim() || organization.organizationName
}

export default function OrganizationTabs() {
  const { user, switchOrganization } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [pendingOrganizationId, setPendingOrganizationId] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (!user || user.role === 'super_admin' || user.organizations.length === 0) {
    return null
  }

  const activeOrganization =
    user.organizations.find(organization => organization.organizationId === user.activeOrganizationId) ?? user.organizations[0]

  const canSwitchOrganizations = user.organizations.length > 1

  return (
    <div className="relative flex items-center gap-1.5" ref={containerRef}>
      <span className="max-w-[220px] truncate text-sm font-medium text-[#1E293B] dark:text-[#F1F5F9]">
        {getOrganizationLabel(activeOrganization)}
      </span>
      <button
        type="button"
        onClick={() => {
          if (!canSwitchOrganizations) return
          setOpen(current => !current)
          setError(null)
        }}
        className={[
          'w-10 h-10 flex items-center justify-center rounded-[2px] transition-colors',
          canSwitchOrganizations
            ? 'text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9] hover:bg-[#F1F5F9] dark:hover:bg-[#1E293B]'
            : 'text-[#94A3B8] cursor-default',
        ].join(' ')}
        title={canSwitchOrganizations ? 'Switch organization' : 'Organization'}
        aria-label={canSwitchOrganizations ? 'Switch organization' : 'Organization'}
        aria-expanded={canSwitchOrganizations ? open : undefined}
        disabled={!canSwitchOrganizations}
      >
        <MapPin size={18} />
      </button>

      {open && canSwitchOrganizations && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-white dark:bg-[#0F172A] border border-[#E2E8F0] dark:border-[#1E293B] rounded-[2px] overflow-hidden z-50 shadow-sm">
          <div className="px-3 py-2 border-b border-[#E2E8F0] dark:border-[#1E293B]">
            <p className="text-[11px] tracking-[0.18em] uppercase text-[#94A3B8] dark:text-[#475569] font-mono">
              Organizations
            </p>
          </div>
          <div className="max-h-80 overflow-auto">
            {user.organizations.map(organization => {
              const isActive = organization.organizationId === user.activeOrganizationId
              const isPending = organization.organizationId === pendingOrganizationId

              return (
                <button
                  key={organization.organizationId}
                  type="button"
                  onClick={() => {
                    if (isActive || isPending) return
                    setPendingOrganizationId(organization.organizationId)
                    setError(null)
                    void switchOrganization(organization.organizationId)
                      .then(() => setOpen(false))
                      .catch(err => setError(err instanceof Error ? err.message : 'Failed to switch organization'))
                      .finally(() => setPendingOrganizationId(null))
                  }}
                  className={[
                    'w-full px-3 py-2.5 text-left border-b last:border-b-0 border-[#F1F5F9] dark:border-[#1E293B] transition-colors',
                    isActive
                      ? 'bg-[#EFF6FF] dark:bg-[#172554]'
                      : 'hover:bg-[#F8FAFC] dark:hover:bg-[#111827]',
                    isPending ? 'opacity-70' : '',
                  ].join(' ')}
                >
                  <p className="text-sm font-medium text-[#1E293B] dark:text-[#F1F5F9]">
                    {isPending ? 'Switching...' : getOrganizationLabel(organization)}
                  </p>
                  <p className="text-[11px] text-[#64748B] dark:text-[#94A3B8] mt-0.5">
                    {organization.organizationName}
                    {organization.isDefault ? ' • Default' : ''}
                    {isActive ? ' • Active' : ''}
                  </p>
                </button>
              )
            })}
          </div>
          {error && (
            <p className="px-3 py-2 text-xs text-red-500 border-t border-[#E2E8F0] dark:border-[#1E293B]">{error}</p>
          )}
        </div>
      )}
    </div>
  )
}
