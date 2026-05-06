import type { AppNotification } from '../types'
import { authHeaders, handleUnauthorizedResponse } from './authEvents'

async function handleResponse<T>(res: Response): Promise<T> {
  handleUnauthorizedResponse(res)

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }

  return res.json() as Promise<T>
}

export async function listNotifications(): Promise<AppNotification[]> {
  const res = await fetch('/api/notifications', { headers: authHeaders() })
  return handleResponse<AppNotification[]>(res)
}

export async function getUnreadNotificationCount(): Promise<number> {
  const res = await fetch('/api/notifications/unread-count', { headers: authHeaders() })
  const data = await handleResponse<{ count: number }>(res)
  return data.count
}

export async function markNotificationRead(id: number): Promise<AppNotification> {
  const res = await fetch(`/api/notifications/${id}/read`, {
    method: 'PATCH',
    headers: authHeaders(),
  })
  return handleResponse<AppNotification>(res)
}

export async function markAllNotificationsRead(): Promise<number> {
  const res = await fetch('/api/notifications/read-all', {
    method: 'PATCH',
    headers: authHeaders(),
  })
  const data = await handleResponse<{ updated: number }>(res)
  return data.updated
}
