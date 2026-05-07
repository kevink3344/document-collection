import { authHeaders, handleUnauthorizedResponse } from './authEvents'

export interface MySubmission {
  responseId: number
  collectionId: number
  collectionTitle: string
  collectionSlug: string
  category: string | null
  versionNumber: number | null
  editableUntil: string | null
  lastEditedAt: string | null
  canEdit: boolean
  submittedAt: string
}

export interface MySubmissionValue {
  fieldId: number
  fieldLabel: string
  fieldType: string
  fieldOptions: string[] | null
  value: string
}

export interface MySubmissionDetail extends MySubmission {
  values: MySubmissionValue[]
}

async function handleResponse<T>(res: Response): Promise<T> {
  handleUnauthorizedResponse(res)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function listMySubmissions(): Promise<MySubmission[]> {
  const res = await fetch('/api/my-submissions', { headers: authHeaders() })
  return handleResponse<MySubmission[]>(res)
}

export async function getMySubmission(responseId: number): Promise<MySubmissionDetail> {
  const res = await fetch(`/api/my-submissions/${responseId}`, { headers: authHeaders() })
  return handleResponse<MySubmissionDetail>(res)
}

export async function updateMySubmission(
  responseId: number,
  payload: { values: { fieldId: number; value: string }[] }
): Promise<{ updated: boolean }> {
  const res = await fetch(`/api/my-submissions/${responseId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  })
  return handleResponse<{ updated: boolean }>(res)
}
