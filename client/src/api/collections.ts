import type {
  ApprovalWorkflowDefinition,
  ApprovalWorkflowSummary,
  Collection,
  CollectionField,
  CollectionResponse,
  CollectionShare,
  CollectionStatus,
  CollectionVersion,
  SubmissionComment,
} from '../types'
import { authHeaders, handleUnauthorizedResponse } from './authEvents'

export interface CollectionPayload {
  title: string
  status: CollectionStatus
  description?: string
  category?: string
  dateDue?: string
  coverPhotoUrl?: string
  coverPhotoAssetId?: number | null
  logoUrl?: string
  instructions?: string
  instructionsDocUrl?: string
  workflowDefinition?: ApprovalWorkflowDefinition | null
  sourceTemplateCollectionId?: number | null
  anonymous: boolean
  allowSubmissionEdits: boolean
  submissionEditWindowHours?: number
  collectionType?: 'standard' | 'signup_sheet'

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
    copyEmail?: string
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

async function actOnResponseWorkflow(
  collectionId: number,
  responseId: number,
  decision: 'approve' | 'reject',
  comment?: string,
): Promise<ApprovalWorkflowSummary> {
  const res = await fetch(`/api/collections/${collectionId}/responses/${responseId}/workflow/${decision}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ comment }),
  })
  return handleResponse<ApprovalWorkflowSummary>(res)
}

export function approveResponseWorkflow(
  collectionId: number,
  responseId: number,
  comment?: string,
): Promise<ApprovalWorkflowSummary> {
  return actOnResponseWorkflow(collectionId, responseId, 'approve', comment)
}

export function rejectResponseWorkflow(
  collectionId: number,
  responseId: number,
  comment?: string,
): Promise<ApprovalWorkflowSummary> {
  return actOnResponseWorkflow(collectionId, responseId, 'reject', comment)
}

export async function upsertStaffFields(
  collectionId: number,
  responseId: number,
  values: { fieldId: number; value: string }[]
): Promise<void> {
  const res = await fetch(`/api/collections/${collectionId}/responses/${responseId}/staff-fields`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ values }),
  })
  return handleResponse<void>(res)
}

export async function seedCollectionData(
  collectionId: number,
  payload: { count: number }
): Promise<{ created: number; collectionId: number; collectionTitle: string }> {
  const res = await fetch(`/api/collections/${collectionId}/seed`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  })
  return handleResponse<{ created: number; collectionId: number; collectionTitle: string }>(res)
}

export async function getComments(collectionId: number, responseId: number): Promise<SubmissionComment[]> {
  const res = await fetch(`/api/collections/${collectionId}/responses/${responseId}/comments`, {
    headers: authHeaders(),
  })
  return handleResponse<SubmissionComment[]>(res)
}

export async function addComment(collectionId: number, responseId: number, body: string): Promise<SubmissionComment> {
  const res = await fetch(`/api/collections/${collectionId}/responses/${responseId}/comments`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ body }),
  })
  return handleResponse<SubmissionComment>(res)
}

export async function deleteComment(collectionId: number, responseId: number, commentId: number): Promise<void> {
  const res = await fetch(`/api/collections/${collectionId}/responses/${responseId}/comments/${commentId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  return handleResponse<void>(res)
}

export async function getCollectionShares(collectionId: number): Promise<CollectionShare> {
  const res = await fetch(`/api/collections/${collectionId}/shares`, { headers: authHeaders() })
  return handleResponse<CollectionShare>(res)
}

export async function saveCollectionShares(
  collectionId: number,
  payload: { userIds: number[]; groupIds: number[] }
): Promise<void> {
  const res = await fetch(`/api/collections/${collectionId}/shares`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return handleResponse<void>(res)
}
