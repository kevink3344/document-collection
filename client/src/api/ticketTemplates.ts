import type { TicketField, TicketTemplate } from '../types'
import { authHeaders, handleUnauthorizedResponse } from './authEvents'

interface TicketTemplateScopeOptions {
  organizationOnly?: boolean
}

async function handleResponse<T>(res: Response): Promise<T> {
  handleUnauthorizedResponse(res)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }
  if (res.status === 204) return undefined as unknown as T
  return res.json() as Promise<T>
}

export async function listTicketTemplates(options: TicketTemplateScopeOptions = {}): Promise<TicketTemplate[]> {
  const params = new URLSearchParams()
  if (options.organizationOnly) {
    params.set('scope', 'organization')
  }

  const requestUrl = params.size > 0
    ? `/api/ticket-templates?${params.toString()}`
    : '/api/ticket-templates'

  const res = await fetch(requestUrl, { headers: authHeaders() })
  return handleResponse<TicketTemplate[]>(res)
}

export async function createTicketTemplate(payload: {
  title: string
  description?: string | null
}, options: TicketTemplateScopeOptions = {}): Promise<TicketTemplate> {
  const res = await fetch('/api/ticket-templates', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      ...payload,
      organizationOnly: options.organizationOnly === true,
    }),
  })
  return handleResponse<TicketTemplate>(res)
}

export async function updateTicketTemplate(
  templateId: number,
  payload: { title?: string; description?: string | null; isActive?: boolean },
): Promise<TicketTemplate> {
  const res = await fetch(`/api/ticket-templates/${templateId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  })
  return handleResponse<TicketTemplate>(res)
}

export async function getTicketTemplateFields(templateId: number): Promise<TicketField[]> {
  const res = await fetch(`/api/ticket-templates/${templateId}/fields`, {
    headers: authHeaders(),
  })
  return handleResponse<TicketField[]>(res)
}

export async function deleteTicketTemplate(templateId: number): Promise<void> {
  const res = await fetch(`/api/ticket-templates/${templateId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  return handleResponse<void>(res)
}

export async function saveTicketTemplateFields(
  templateId: number,
  fields: Omit<TicketField, 'id'>[],
): Promise<void> {
  const res = await fetch(`/api/ticket-templates/${templateId}/fields`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ fields }),
  })
  return handleResponse<void>(res)
}