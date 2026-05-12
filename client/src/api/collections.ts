import type {
  Collection,
  CollectionField,
  CollectionResponse,
  CollectionStatus,
  CollectionVersion,
} from '../types'
import { authHeaders, handleUnauthorizedResponse } from './authEvents'

export interface CollectionPayload {
  title: string
  status: CollectionStatus
  description?: string
  category?: string
  dateDue?: string
  coverPhotoUrl?: string
  logoUrl?: string
  instructions?: string
  instructionsDocUrl?: string
  anonymous: boolean
  allowSubmissionEdits: boolean
  submissionEditWindowHours?: number
  fields: Omit<CollectionField, 'id'>[]
}

async function handleResponse<T>(res: Response): Promise<T> {
  handleUnauthorizedResponse(res)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function listCollections(): Promise<Collection[]> {
  const res = await fetch('/api/collections', { headers: authHeaders() })
  return handleResponse<Collection[]>(res)
}

export async function getCollection(id: number): Promise<Collection> {
  const res = await fetch(`/api/collections/${id}`, { headers: authHeaders() })
  return handleResponse<Collection>(res)
}

export async function getPublicCollection(
  slug: string,
  options?: { preview?: boolean }
): Promise<Collection> {
  const params = new URLSearchParams()
  if (options?.preview) params.set('preview', 'true')
  const url = `/api/collections/public/${slug}${params.size > 0 ? `?${params.toString()}` : ''}`
  const res = await fetch(url, {
    headers: options?.preview ? authHeaders() : undefined,
  })
  return handleResponse<Collection>(res)
}

export async function createCollection(payload: CollectionPayload): Promise<Collection> {
  const res = await fetch('/api/collections', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  })
  return handleResponse<Collection>(res)
}

export async function updateCollection(
  id: number,
  payload: CollectionPayload
): Promise<Collection> {
  const res = await fetch(`/api/collections/${id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  })
  return handleResponse<Collection>(res)
}

export async function deleteCollection(id: number): Promise<void> {
  const res = await fetch(`/api/collections/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  handleUnauthorizedResponse(res)
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Delete failed: ${res.status}`)
  }
}

export async function listCollectionVersions(collectionId: number): Promise<CollectionVersion[]> {
  const res = await fetch(`/api/collections/${collectionId}/versions`, {
    headers: authHeaders(),
  })
  return handleResponse<CollectionVersion[]>(res)
}

export async function getCollectionVersion(
  collectionId: number,
  versionId: number
): Promise<Collection> {
  const res = await fetch(`/api/collections/${collectionId}/versions/${versionId}`, {
    headers: authHeaders(),
  })
  return handleResponse<Collection>(res)
}

export async function createCollectionVersion(
  collectionId: number,
  payload: CollectionPayload
): Promise<Collection> {
  const res = await fetch(`/api/collections/${collectionId}/versions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  })
  return handleResponse<Collection>(res)
}

export async function publishCollectionVersion(
  collectionId: number,
  versionId: number
): Promise<Collection> {
  const res = await fetch(`/api/collections/${collectionId}/versions/${versionId}/publish`, {
    method: 'POST',
    headers: authHeaders(),
  })
  return handleResponse<Collection>(res)
}

export async function submitResponse(
  slug: string,
  payload: {
    respondentName?: string
    respondentEmail?: string
    values: { fieldId: number; value: string }[]
  }
): Promise<{ id: number; submitted: boolean }> {
  const res = await fetch(`/api/collections/public/${slug}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return handleResponse<{ id: number; submitted: boolean }>(res)
}

export async function getResponses(collectionId: number): Promise<CollectionResponse[]> {
  const res = await fetch(`/api/collections/${collectionId}/responses`, {
    headers: authHeaders(),
  })
  return handleResponse<CollectionResponse[]>(res)
}
