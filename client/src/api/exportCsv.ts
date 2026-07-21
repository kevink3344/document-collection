import type { ExportCsvSchema, ExportCsvPreset } from '../types'
import { authHeaders, handleUnauthorizedResponse } from './authEvents'

async function handleResponse<T>(res: Response): Promise<T> {
  handleUnauthorizedResponse(res)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function getExportCsvSchema(collectionId: number): Promise<ExportCsvSchema> {
  const res = await fetch(`/api/export-csv/collections/${collectionId}/schema`, { headers: authHeaders() })
  return handleResponse<ExportCsvSchema>(res)
}

export interface ExportCsvPayload {
  submissionColumnKeys: string[]
  ticketTemplateId: number | null
  ticketColumnKeys: string[]
}

export async function exportCollectionCsv(collectionId: number, payload: ExportCsvPayload): Promise<Blob> {
  const res = await fetch(`/api/export-csv/collections/${collectionId}/export`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  })
  handleUnauthorizedResponse(res)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Export failed: ${res.status}`)
  }
  return res.blob()
}

export async function listExportCsvPresets(collectionId: number): Promise<ExportCsvPreset[]> {
  const url = new URL('/api/export-csv/presets', window.location.origin)
  url.searchParams.set('collectionId', String(collectionId))
  const res = await fetch(url.toString(), { headers: authHeaders() })
  return handleResponse<ExportCsvPreset[]>(res)
}

export interface SaveExportCsvPresetPayload {
  collectionId: number
  name?: string
  allSubmissionColumns: boolean
  submissionColumns: string[]
  ticketTemplateId: number | null
  allTicketColumns: boolean
  ticketColumns: string[]
}

export async function saveExportCsvPreset(payload: SaveExportCsvPresetPayload): Promise<ExportCsvPreset> {
  const res = await fetch('/api/export-csv/presets', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  })
  return handleResponse<ExportCsvPreset>(res)
}

export async function updateExportCsvPreset(
  presetId: number,
  payload: SaveExportCsvPresetPayload
): Promise<ExportCsvPreset> {
  const res = await fetch(`/api/export-csv/presets/${presetId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  })
  return handleResponse<ExportCsvPreset>(res)
}

export async function deleteExportCsvPreset(presetId: number): Promise<void> {
  const res = await fetch(`/api/export-csv/presets/${presetId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  handleUnauthorizedResponse(res)
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Delete failed: ${res.status}`)
  }
}
