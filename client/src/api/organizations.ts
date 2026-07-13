import type { Organization } from '../types'
import { authHeaders, handleUnauthorizedResponse } from './authEvents'

async function handleResponse<T>(res: Response): Promise<T> {
  handleUnauthorizedResponse(res)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }

  if (res.status === 204) {
    return undefined as T
  }

  return res.json() as Promise<T>
}

export async function listOrganizations(): Promise<Organization[]> {
  const res = await fetch('/api/organizations', { headers: authHeaders() })
  return handleResponse<Organization[]>(res)
}

export async function createOrganization(payload: {
  name: string
  slug?: string
  description?: string
  isActive?: boolean
}): Promise<Organization> {
  const res = await fetch('/api/organizations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return handleResponse<Organization>(res)
}

export async function updateOrganization(
  id: number,
  payload: {
    name?: string
    slug?: string
    description?: string
    isActive?: boolean
  }
): Promise<Organization> {
  const res = await fetch(`/api/organizations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return handleResponse<Organization>(res)
}

export async function deleteOrganization(id: number, confirmationText: string): Promise<void> {
  const res = await fetch(`/api/organizations/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ confirmationText }),
  })
  await handleResponse<void>(res)
}