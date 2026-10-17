import { useEffect, useMemo, useState } from 'react'
import { getPublicSetting } from '../api/settings'
import { useAuth } from '../contexts/AuthContext'
import {
  TICKET_ACTIVITY_ENABLED_KEY,
  TICKET_ACTIVITY_ORGS_KEY,
  isTicketActivityAllowedForOrg,
  parseTicketActivityOrgIds,
} from '../utils/ticketActivity'

export interface TicketActivityGate {
  /** `TICKET_SYSTEM_ENABLED` — the deploy-level kill switch, surfaced by /api/info. */
  ticketSystemEnabled: boolean
  /** The global "Show Tickets" master switch from Settings → Ticket Activity. */
  ticketActivityEnabled: boolean
  /** Enabled organization ids, or `null` when tickets are enabled in every organization. */
  enabledOrganizationIds: number[] | null
  /** The organization the session is currently working in, when there is one. */
  activeOrganizationId: number | null
  /** Whether Ticket Activity is available in the active organization. */
  organizationEnabled: boolean
  /** The gate every ticket surface should use: env ∧ master switch ∧ organization. */
  ticketActivityGateEnabled: boolean
}

/**
 * Resolves all three ticket-activity layers once per component.
 *
 * Before this hook each ticket surface carried its own copy of the two-fetch effect,
 * which meant every new layer had to be added in four places. The settings read is
 * public (no auth) so this works before a session is fully resolved; the organization
 * layer is derived from the authenticated user instead.
 */
export function useTicketActivityEnabled(): TicketActivityGate {
  const { user } = useAuth()
  const [ticketSystemEnabled, setTicketSystemEnabled] = useState(true)
  const [ticketActivityEnabled, setTicketActivityEnabled] = useState(true)
  const [enabledOrganizationIds, setEnabledOrganizationIds] = useState<number[] | null>(null)

  const activeOrganizationId = user?.activeOrganizationId ?? user?.organizationId ?? null

  useEffect(() => {
    let cancelled = false

    fetch('/api/info')
      .then(r => r.json() as Promise<{ ticketSystemEnabled?: boolean }>)
      .then(info => {
        if (!cancelled) setTicketSystemEnabled(info.ticketSystemEnabled !== false)
      })
      .catch(() => { /* keep default enabled */ })

    getPublicSetting(TICKET_ACTIVITY_ENABLED_KEY)
      .then(val => {
        if (!cancelled) setTicketActivityEnabled(val !== 'false')
      })
      .catch(() => {
        if (!cancelled) setTicketActivityEnabled(true)
      })

    getPublicSetting(TICKET_ACTIVITY_ORGS_KEY)
      .then(val => {
        if (!cancelled) setEnabledOrganizationIds(parseTicketActivityOrgIds(val))
      })
      .catch(() => {
        if (!cancelled) setEnabledOrganizationIds(null)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return useMemo(() => {
    const organizationEnabled = isTicketActivityAllowedForOrg(enabledOrganizationIds, activeOrganizationId)
    return {
      ticketSystemEnabled,
      ticketActivityEnabled,
      enabledOrganizationIds,
      activeOrganizationId,
      organizationEnabled,
      ticketActivityGateEnabled: ticketSystemEnabled && ticketActivityEnabled && organizationEnabled,
    }
  }, [ticketSystemEnabled, ticketActivityEnabled, enabledOrganizationIds, activeOrganizationId])
}
