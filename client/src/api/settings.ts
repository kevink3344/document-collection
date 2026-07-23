import { authHeaders, handleUnauthorizedResponse } from './authEvents'

const BASE = '/api/settings'

async function getErrorMessage(res: Response, fallback: string): Promise<string> {
  const contentType = res.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    const data = await res.json().catch(() => ({})) as { error?: string; message?: string }
    if (typeof data.error === 'string' && data.error.trim()) return data.error
    if (typeof data.message === 'string' && data.message.trim()) return data.message
  } else {
    const text = await res.text().catch(() => '')
    if (text.trim()) return text.trim()
  }

  return `${fallback} (HTTP ${res.status})`
}

async function handleResponse<T>(res: Response): Promise<T> {
  handleUnauthorizedResponse(res)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function getPublicSetting(key: string): Promise<string> {
  const res = await fetch(`${BASE}/${encodeURIComponent(key)}`)
  if (!res.ok) {
    throw new Error(await getErrorMessage(res, 'Failed to load setting'))
  }
  const data = await res.json() as { value: string }
  return data.value
}

export async function updateSetting(key: string, value: string): Promise<void> {
  const token = localStorage.getItem('dcp-token')
  const res = await fetch(`${BASE}/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ value }),
  })
  if (!res.ok) {
    throw new Error(await getErrorMessage(res, 'Failed to save setting'))
  }
}

// ── Settings Tabs API ──────────────────────────────────────────────────────

export interface SettingsTab {
  id: number
  name: string
  slug: string
  sortOrder: number
  visibleTo: 'all' | 'super_admin_only'
}

export async function listSettingsTabs(): Promise<SettingsTab[]> {
  const res = await fetch(`${BASE}/tabs`, {
    headers: authHeaders(),
  })
  return handleResponse<SettingsTab[]>(res)
}

export async function createSettingsTab(data: {
  name: string
  slug: string
  visibleTo: 'all' | 'super_admin_only'
}): Promise<SettingsTab> {
  const res = await fetch(`${BASE}/tabs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  })
  return handleResponse<SettingsTab>(res)
}

export async function updateSettingsTab(
  id: number,
  data: {
    name?: string
    visibleTo?: 'all' | 'super_admin_only'
    sortOrder?: number
  },
): Promise<SettingsTab> {
  const res = await fetch(`${BASE}/tabs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  })
  return handleResponse<SettingsTab>(res)
}

export async function deleteSettingsTab(id: number): Promise<void> {
  const res = await fetch(`${BASE}/tabs/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }
}

export async function reorderSettingsTabs(orderedIds: number[]): Promise<void> {
  const res = await fetch(`${BASE}/tabs/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ orderedIds }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }
}
