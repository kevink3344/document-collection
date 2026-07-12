import { authHeaders, handleUnauthorizedResponse } from './authEvents'
import type { MembershipRole, User, UserRole } from '../types'

export interface AppUser extends User {}

export interface UserMembershipPayload {
  organizationId: number
  role: MembershipRole
  isDefault?: boolean
}

async function handleResponse<T>(res: Response): Promise<T> {
  handleUnauthorizedResponse(res)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function listUsers(): Promise<AppUser[]> {
  const res = await fetch('/api/users', { headers: authHeaders() })
  return handleResponse<AppUser[]>(res)
}

export async function createUser(payload: {
  name: string
  email: string
  role?: UserRole
  organizationId?: number
  memberships?: UserMembershipPayload[]
}): Promise<AppUser> {
  const res = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return handleResponse<AppUser>(res)
}

export async function updateUser(
  id: number,
  payload: {
    name: string
    email: string
    role: UserRole
    organizationId?: number
    memberships?: UserMembershipPayload[]
  }
): Promise<AppUser> {
  const res = await fetch(`/api/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return handleResponse<AppUser>(res)
}

export async function deleteUser(id: number): Promise<void> {
  const res = await fetch(`/api/users/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  handleUnauthorizedResponse(res)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }
}

export async function resetUserPassword(id: number): Promise<void> {
  const res = await fetch(`/api/users/${id}/reset-password`, {
    method: 'POST',
    headers: authHeaders(),
  })
  handleUnauthorizedResponse(res)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }
}

export async function sendInvite(payload: {
  email: string
  name: string
  role?: 'user' | 'team_manager' | 'reviewer' | 'administrator'
}): Promise<{ message: string; inviteLink?: string }> {
  const res = await fetch('/api/invitations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return handleResponse<{ message: string; inviteLink?: string }>(res)
}
