/**
 * Ticket Activity — per-organization enablement.
 *
 * Ticket surfaces are gated by three layers, ANDed together:
 *   1. `TICKET_SYSTEM_ENABLED` (env)      — surfaced by /api/info as `ticketSystemEnabled`
 *   2. `ticket_activity_enabled` (setting) — the global "Show Tickets" master switch
 *   3. `ticket_activity_orgs` (setting)   — which organizations tickets are available in
 *
 * This module owns layer 3's storage grammar. The value is a plain string like every
 * other row in `app_settings`, so it stays readable in the DB and needs no migration.
 *
 * Grammar
 *   '*'      every organization, including ones created later  (the server default)
 *   ''       treated exactly like '*' — an unset/blank row must never hide tickets
 *   'none'   an explicit "nobody": the admin unchecked every organization
 *   '1,4,7'  only those organization ids
 */

export const TICKET_ACTIVITY_ENABLED_KEY = 'ticket_activity_enabled'
export const TICKET_ACTIVITY_ORGS_KEY = 'ticket_activity_orgs'

/** Sentinel stored when every organization is enabled (including future ones). */
export const TICKET_ACTIVITY_ALL_ORGS = '*'
/** Sentinel stored when the admin explicitly enabled no organization. */
export const TICKET_ACTIVITY_NO_ORGS = 'none'

/**
 * Parse the stored allowlist.
 *
 * Returns `null` when the allowlist does not apply to any organization in particular
 * (every organization, including ones created later), or the enabled organization ids
 * otherwise — an empty array meaning "none".
 */
export function parseTicketActivityOrgIds(raw: string | null | undefined): number[] | null {
  const value = (raw ?? '').trim()
  if (!value || value === TICKET_ACTIVITY_ALL_ORGS) return null
  if (value.toLowerCase() === TICKET_ACTIVITY_NO_ORGS) return []

  const ids = value
    .split(',')
    .map(part => Number.parseInt(part.trim(), 10))
    .filter(id => Number.isFinite(id) && id > 0)

  return Array.from(new Set(ids))
}

/** Serialize an allowlist back into the stored string form. `null` = every organization. */
export function serializeTicketActivityOrgIds(ids: number[] | null): string {
  if (ids === null) return TICKET_ACTIVITY_ALL_ORGS
  if (ids.length === 0) return TICKET_ACTIVITY_NO_ORGS
  return Array.from(new Set(ids)).join(',')
}

/**
 * Is Ticket Activity available inside this organization?
 *
 * `organizationId === null` means the session has no active organization (a super admin
 * without a membership, or a request made before one resolved). There is no id to look
 * up in the allowlist, so fall back to "allowed" — the same absent-means-enabled
 * convention the setting itself uses. An allowlist must never silently revoke access to
 * a context it was not asked about.
 */
export function isTicketActivityAllowedForOrg(
  ids: number[] | null,
  organizationId: number | null,
): boolean {
  if (ids === null) return true
  if (organizationId == null) return true
  return ids.includes(organizationId)
}

/** One-line description of the allowlist for the Settings panel. */
export function describeTicketActivityOrgScope(ids: number[] | null, totalOrganizations: number): string {
  if (ids === null) {
    if (totalOrganizations === 0) return 'All organizations, including ones added later.'
    return `All ${totalOrganizations} organization${totalOrganizations === 1 ? '' : 's'}, including ones added later.`
  }
  if (ids.length === 0) return 'No organizations — tickets are hidden everywhere.'
  return `Tickets are available in ${ids.length} of ${totalOrganizations} organization${totalOrganizations === 1 ? '' : 's'}.`
}
