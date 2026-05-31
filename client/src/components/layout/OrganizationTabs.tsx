import { useState } from 'react'
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

  if (!user || user.organizations.length < 2 || user.role === 'super_admin') {
    return null
  }

  return (
    <div className="px-4 pb-2 border-t border-[#F1F5F9] dark:border-[#1E293B] bg-white dark:bg-[#0F172A] overflow-x-auto">
      <div className="flex items-center gap-2 min-w-max pt-2">
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
                  .catch(err => setError(err instanceof Error ? err.message : 'Failed to switch organization'))
                  .finally(() => setPendingOrganizationId(null))
              }}
              className={[
                'px-3 py-1.5 text-xs font-medium rounded-[2px] border transition-colors whitespace-nowrap',
                isActive
                  ? 'border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8] dark:border-[#60A5FA] dark:bg-[#172554] dark:text-[#BFDBFE]'
                  : 'border-[#CBD5E1] dark:border-[#334155] text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9] hover:bg-[#F8FAFC] dark:hover:bg-[#111827]',
                isPending ? 'opacity-70' : '',
              ].join(' ')}
            >
              {isPending ? 'Switching...' : getOrganizationLabel(organization)}
            </button>
          )
        })}
      </div>
      {error && (
        <p className="pt-2 text-xs text-red-500">{error}</p>
      )}
    </div>
  )
}
