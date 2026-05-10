import { authHeaders, handleUnauthorizedResponse } from './authEvents'

async function handleResponse<T>(res: Response): Promise<T> {
  handleUnauthorizedResponse(res)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function getPreference(key: string): Promise<string | null> {
  const res = await fetch(`/api/preferences/${encodeURIComponent(key)}`, {
    headers: authHeaders(),
  })
  const data = await handleResponse<{ key: string; value: string | null }>(res)
  return data.value
}

export async function updatePreference(key: string, value: string): Promise<void> {
  const res = await fetch(`/api/preferences/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ value }),
  })
  await handleResponse<{ key: string; value: string }>(res)
}