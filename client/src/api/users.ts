import { authHeaders, handleUnauthorizedResponse } from './authEvents'

export interface AppUser {
  id: number
  name: string
  email: string
  role: 'administrator' | 'team_manager' | 'user'
  organization?: string
  createdAt: string
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
  role?: 'administrator' | 'team_manager' | 'user'
  organization?: string
}): Promise<AppUser> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  // register returns { token, user }
  handleUnauthorizedResponse(res)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }
  const data = await res.json() as { user: AppUser }
  return data.user
}

export async function updateUser(
  id: number,
  payload: {
    name: string
    email: string
    role: 'administrator' | 'team_manager' | 'user'
    organization?: string
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
