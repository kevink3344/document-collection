import { authHeaders, handleUnauthorizedResponse } from './authEvents'
import type { Group, GroupMember } from '../types'

async function handleResponse<T>(res: Response): Promise<T> {
  handleUnauthorizedResponse(res)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function listGroups(): Promise<Group[]> {
  const res = await fetch('/api/groups', { headers: authHeaders() })
  return handleResponse<Group[]>(res)
}

export async function createGroup(payload: { name: string; description?: string }): Promise<Group> {
  const res = await fetch('/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return handleResponse<Group>(res)
}

export async function updateGroup(
  id: number,
  payload: { name: string; description?: string }
): Promise<Group> {
  const res = await fetch(`/api/groups/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return handleResponse<Group>(res)
}

export async function deleteGroup(id: number): Promise<void> {
  const res = await fetch(`/api/groups/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  return handleResponse<void>(res)
}

export async function listGroupMembers(groupId: number): Promise<GroupMember[]> {
  const res = await fetch(`/api/groups/${groupId}/members`, { headers: authHeaders() })
  return handleResponse<GroupMember[]>(res)
}

export async function addGroupMember(groupId: number, userId: number): Promise<void> {
  const res = await fetch(`/api/groups/${groupId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ userId }),
  })
  return handleResponse<void>(res)
}

export async function removeGroupMember(groupId: number, userId: number): Promise<void> {
  const res = await fetch(`/api/groups/${groupId}/members/${userId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  return handleResponse<void>(res)
}
