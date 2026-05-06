import type { Category } from '../types'

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('dcp-token')
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }

  if (res.status === 204) {
    return undefined as T
  }

  return res.json() as Promise<T>
}

export async function listCategories(): Promise<Category[]> {
  const res = await fetch('/api/categories', { headers: authHeaders() })
  return handleResponse<Category[]>(res)
}

export async function createCategory(name: string): Promise<Category> {
  const res = await fetch('/api/categories', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name }),
  })
  return handleResponse<Category>(res)
}

export async function updateCategory(id: number, name: string): Promise<Category> {
  const res = await fetch(`/api/categories/${id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ name }),
  })
  return handleResponse<Category>(res)
}

export async function deleteCategory(id: number): Promise<void> {
  const res = await fetch(`/api/categories/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  await handleResponse<void>(res)
}