import type { Location } from '../types'
import { authHeaders, handleUnauthorizedResponse } from './authEvents'

const API_BASE = '/api/locations'

/** Public (no auth) — used by the fill page to populate the Location field dropdown. */
export async function getPublicLocations(): Promise<Location[]> {
  const res = await fetch(API_BASE)
  if (!res.ok) throw new Error('Failed to fetch locations')
  return res.json() as Promise<Location[]>
}

export async function searchLocations(q: string): Promise<Location[]> {
  const params = new URLSearchParams({ q })
  const res = await fetch(`${API_BASE}?${params}`, {
    headers: authHeaders(),
  })
  handleUnauthorizedResponse(res)
  if (!res.ok) throw new Error('Failed to search locations')
  return res.json() as Promise<Location[]>
}

export async function listLocations(): Promise<Location[]> {
  const res = await fetch(API_BASE, {
    headers: authHeaders(),
  })
  handleUnauthorizedResponse(res)
  if (!res.ok) throw new Error('Failed to list locations')
  return res.json() as Promise<Location[]>
}

export async function createLocation(name: string): Promise<Location> {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name }),
  })
  handleUnauthorizedResponse(res)
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error ?? 'Failed to create location')
  }
  return res.json() as Promise<Location>
}

export async function deleteLocation(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  handleUnauthorizedResponse(res)
  if (!res.ok) throw new Error('Failed to delete location')
}

export async function updateLocation(id: number, name: string): Promise<Location> {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ name }),
  })
  handleUnauthorizedResponse(res)
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error ?? 'Failed to update location')
  }
  return res.json() as Promise<Location>
}

export async function getUserLocations(userId: number): Promise<Location[]> {
  const res = await fetch(`/api/users/${userId}/locations`, {
    headers: authHeaders(),
  })
  handleUnauthorizedResponse(res)
  if (!res.ok) throw new Error('Failed to get user locations')
  return res.json() as Promise<Location[]>
}

export async function updateUserLocations(userId: number, locationIds: number[]): Promise<void> {
  const res = await fetch(`/api/users/${userId}/locations`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ locationIds }),
  })
  handleUnauthorizedResponse(res)
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error ?? `Failed to update user locations (${res.status})`)
  }
}
