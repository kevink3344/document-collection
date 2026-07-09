import type { Request } from 'express'
import { loadUserAccessProfile } from '../lib/userAccess'

export interface RequestUserContext {
  id: number
  role: 'super_admin' | 'administrator' | 'team_manager' | 'reviewer' | 'user'
  organizationId: number | null
  organizationName: string | null
}

/** Returns true only for super_admin — they bypass all org-scoping. */
export function isAdministrator(context: RequestUserContext): boolean {
  return context.role === 'super_admin'
}

/** Returns true for both super_admin and administrator. */
export function isAdminOrSuperAdmin(context: RequestUserContext): boolean {
  return context.role === 'super_admin' || context.role === 'administrator'
}

/** Returns true for roles that can view collection responses (reviewer and above). */
export function canViewResponses(context: RequestUserContext): boolean {
  return context.role !== 'user'
}

/** Returns true for roles that can see all responses without location filtering. */
export function canViewAllResponses(context: RequestUserContext): boolean {
  return context.role === 'super_admin' || context.role === 'administrator' || context.role === 'team_manager'
}

export async function loadRequestUserContext(req: Request): Promise<RequestUserContext | null> {
  const userId = req.user?.sub
  if (!userId) {
    return null
  }

  const profile = await loadUserAccessProfile(userId, req.user?.activeOrganizationId ?? req.user?.organizationId ?? null)
  if (!profile) {
    return null
  }

  if (
    req.user &&
    (
      req.user.organizationId !== profile.activeOrganizationId ||
      req.user.organizationName !== profile.activeOrganizationName ||
      req.user.role !== profile.role
    )
  ) {
    req.user.organizationId = profile.activeOrganizationId
    req.user.organizationName = profile.activeOrganizationName
    req.user.activeOrganizationId = profile.activeOrganizationId
    req.user.role = profile.role
  }

  return {
    id: profile.id,
    role: profile.role,
    organizationId: profile.activeOrganizationId,
    organizationName: profile.activeOrganizationName,
  }
}

export function buildOrganizationScopeClause(
  context: RequestUserContext,
  qualifiedColumn: string,
): { clause: string; params: Array<number> } {
  if (isAdministrator(context)) {
    return { clause: '', params: [] }
  }

  if (!context.organizationId) {
    return { clause: 'WHERE 1 = 0', params: [] }
  }

  return {
    clause: `WHERE ${qualifiedColumn} = ?`,
    params: [context.organizationId],
  }
}

export function appendOrganizationCondition(
  context: RequestUserContext,
  qualifiedColumn: string,
  existingClause = '',
): { clause: string; params: Array<number> } {
  if (isAdministrator(context)) {
    return { clause: existingClause, params: [] }
  }

  if (!context.organizationId) {
    return {
      clause: existingClause ? `${existingClause} AND 1 = 0` : 'WHERE 1 = 0',
      params: [],
    }
  }

  return {
    clause: existingClause
      ? `${existingClause} AND ${qualifiedColumn} = ?`
      : `WHERE ${qualifiedColumn} = ?`,
    params: [context.organizationId],
  }
}

export function resolveManagedOrganizationId(
  context: RequestUserContext,
  organizationId: number | null | undefined,
): number | null {
  if (isAdministrator(context)) {
    return organizationId ?? null
  }

  return context.organizationId
}