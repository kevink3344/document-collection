import type { DbAdapter } from '../database/types'
import { getDbAsync } from '../database/db'

export type UserRole = 'super_admin' | 'administrator' | 'team_manager' | 'reviewer' | 'user'
export type MembershipRole = Exclude<UserRole, 'super_admin'>

export interface UserOrganizationMembership {
  organizationId: number
  organizationName: string
  organizationSlug: string | null
  organizationDescription: string | null
  role: MembershipRole
  isDefault: boolean
}

interface DbUserRow {
  id: number
  name: string
  email: string
  role: UserRole
  organization: string | null
  created_at: string
  password_hash?: string | null
  must_change_password?: number
  invite_token?: string | null
}

interface DbMembershipRow {
  organization_id: number
  organization_name: string
  organization_slug: string | null
  organization_description: string | null
  role: MembershipRole
  is_default: number
}

export interface UserAccessProfile {
  id: number
  name: string
  email: string
  systemRole: UserRole
  role: UserRole
  activeOrganizationId: number | null
  activeOrganizationName: string | null
  activeOrganizationSlug: string | null
  activeOrganizationDescription: string | null
  organizationId: number | null
  organizationName: string | null
  organizationSlug: string | null
  organizationDescription: string | null
  organization?: string | null
  createdAt: string
  organizations: UserOrganizationMembership[]
  passwordHash: string | null
  mustChangePassword: boolean
  inviteToken: string | null
}

async function loadUserRow(db: DbAdapter, userId: number): Promise<DbUserRow | undefined> {
  return db.queryOne<DbUserRow>(
    `SELECT id, name, email, role, organization, created_at, password_hash, must_change_password, invite_token
     FROM users
     WHERE id = ?`,
    [userId],
  )
}

async function loadMemberships(db: DbAdapter, userId: number): Promise<UserOrganizationMembership[]> {
  const rows = await db.queryAll<DbMembershipRow>(
    `SELECT uo.organization_id,
            o.name AS organization_name,
            o.slug AS organization_slug,
            o.description AS organization_description,
            uo.role,
            uo.is_default
     FROM user_organizations uo
     JOIN organizations o ON o.id = uo.organization_id
     WHERE uo.user_id = ? AND o.is_active = 1
     ORDER BY uo.is_default DESC, o.name ASC`,
    [userId],
  )

  return rows.map(row => ({
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    organizationSlug: row.organization_slug,
    organizationDescription: row.organization_description,
    role: row.role,
    isDefault: row.is_default === 1,
  }))
}

function resolveActiveMembership(
  memberships: UserOrganizationMembership[],
  requestedOrganizationId?: number | null,
): UserOrganizationMembership | null {
  if (memberships.length === 0) {
    return null
  }

  if (requestedOrganizationId != null) {
    const requested = memberships.find(membership => membership.organizationId === requestedOrganizationId)
    if (requested) {
      return requested
    }
  }

  return memberships.find(membership => membership.isDefault) ?? memberships[0]
}

export async function loadUserAccessProfile(
  userId: number,
  requestedOrganizationId?: number | null,
  db?: DbAdapter,
): Promise<UserAccessProfile | null> {
  const database = db ?? await getDbAsync()
  const user = await loadUserRow(database, userId)
  if (!user) {
    return null
  }

  const organizations = await loadMemberships(database, userId)
  const activeMembership = resolveActiveMembership(organizations, requestedOrganizationId)
  const effectiveRole: UserRole = user.role === 'super_admin'
    ? 'super_admin'
    : (activeMembership?.role ?? 'user')

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    systemRole: user.role,
    role: effectiveRole,
    activeOrganizationId: activeMembership?.organizationId ?? null,
    activeOrganizationName: activeMembership?.organizationName ?? null,
    activeOrganizationSlug: activeMembership?.organizationSlug ?? null,
    activeOrganizationDescription: activeMembership?.organizationDescription ?? null,
    organizationId: activeMembership?.organizationId ?? null,
    organizationName: activeMembership?.organizationName ?? user.organization ?? null,
    organizationSlug: activeMembership?.organizationSlug ?? null,
    organizationDescription: activeMembership?.organizationDescription ?? null,
    organization: user.organization,
    createdAt: user.created_at,
    organizations,
    passwordHash: user.password_hash ?? null,
    // Only flag mustChangePassword if the user actually has a password set —
    // select-mode users (no password_hash) never need to change a password.
    mustChangePassword: Boolean(user.must_change_password) && !!user.password_hash,
    inviteToken: user.invite_token ?? null,
  }
}

export function toApiUser(profile: UserAccessProfile) {
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    role: profile.role,
    systemRole: profile.systemRole,
    activeOrganizationId: profile.activeOrganizationId,
    activeOrganizationName: profile.activeOrganizationName,
    activeOrganizationSlug: profile.activeOrganizationSlug,
    activeOrganizationDescription: profile.activeOrganizationDescription,
    organizationId: profile.organizationId,
    organizationName: profile.organizationName,
    organizationSlug: profile.organizationSlug,
    organizationDescription: profile.organizationDescription,
    ...(profile.organization ? { organization: profile.organization } : {}),
    createdAt: profile.createdAt,
    organizations: profile.organizations,
    mustChangePassword: profile.mustChangePassword,
  }
}
