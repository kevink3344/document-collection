import type { SignupSlot, SignupRegistration, SignupSheetSummary } from '../types'
import { authHeaders, handleUnauthorizedResponse } from './authEvents'

async function handleResponse<T>(res: Response): Promise<T> {
  handleUnauthorizedResponse(res)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ── Authenticated (builder/admin) ─────────────────────────────

export async function listSlots(collectionId: number): Promise<SignupSlot[]> {
  const res = await fetch(`/api/signup-slots/collections/${collectionId}/slots`, {
    headers: authHeaders(),
  })
  return handleResponse<SignupSlot[]>(res)
}

export async function createSlot(
  collectionId: number,
  payload: {
    slotDate: string
    startTime: string
    endTime: string
    label?: string
    maxCapacity?: number
    sortOrder?: number
  },
): Promise<SignupSlot> {
  const res = await fetch(`/api/signup-slots/collections/${collectionId}/slots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return handleResponse<SignupSlot>(res)
}

export async function updateSlot(
  collectionId: number,
  slotId: number,
  payload: {
    slotDate: string
    startTime: string
    endTime: string
    label?: string
    maxCapacity?: number
    sortOrder?: number
  },
): Promise<SignupSlot> {
  const res = await fetch(`/api/signup-slots/collections/${collectionId}/slots/${slotId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return handleResponse<SignupSlot>(res)
}

export async function deleteSlot(collectionId: number, slotId: number): Promise<void> {
  const res = await fetch(`/api/signup-slots/collections/${collectionId}/slots/${slotId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  handleUnauthorizedResponse(res)
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete slot: ${res.status}`)
  }
}

export async function listSlotRegistrations(
  collectionId: number,
  slotId: number,
): Promise<SignupRegistration[]> {
  const res = await fetch(
    `/api/signup-slots/collections/${collectionId}/slots/${slotId}/registrations`,
    { headers: authHeaders() },
  )
  return handleResponse<SignupRegistration[]>(res)
}

// ── Public (fill page) ────────────────────────────────────────

export async function getPublicSignupSheet(slug: string): Promise<SignupSheetSummary> {
  const res = await fetch(`/api/signup-slots/public/${slug}`)
  return handleResponse<SignupSheetSummary>(res)
}

export async function listPublicSlots(slug: string): Promise<SignupSlot[]> {
  const res = await fetch(`/api/signup-slots/public/${slug}/slots`)
  return handleResponse<SignupSlot[]>(res)
}

export async function registerForSlot(
  slug: string,
  slotId: number,
  payload: { respondentName: string; respondentEmail: string; note?: string },
): Promise<SignupRegistration> {
  const res = await fetch(`/api/signup-slots/public/${slug}/slots/${slotId}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return handleResponse<SignupRegistration>(res)
}
