import { authHeaders, handleUnauthorizedResponse } from './authEvents'
import type { MenuLabelKey } from '../utils/menuLabels'
import { DEFAULT_MENU_LABELS } from '../utils/menuLabels'

interface MenuLabelsResponse {
  organizationId: number
  labels: Record<MenuLabelKey, string>
}

/** Dispatched whenever menu labels are updated so listeners (e.g. SideNav) can refresh. */
export const MENU_LABELS_UPDATED_EVENT = 'dcp-menu-labels-updated'

async function handleResponse<T>(res: Response): Promise<T> {
  handleUnauthorizedResponse(res)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function getMenuLabels(organizationId: number): Promise<Record<MenuLabelKey, string>> {
  const res = await fetch(`/api/organizations/${organizationId}/menu-labels`, {
    headers: authHeaders(),
  })
  const data = await handleResponse<MenuLabelsResponse>(res)
  return data.labels ?? { ...DEFAULT_MENU_LABELS }
}

export async function updateMenuLabels(
  organizationId: number,
  labels: Partial<Record<MenuLabelKey, string>>,
): Promise<Record<MenuLabelKey, string>> {
  const res = await fetch(`/api/organizations/${organizationId}/menu-labels`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ labels }),
  })
  const data = await handleResponse<MenuLabelsResponse>(res)
  const resolved = data.labels ?? { ...DEFAULT_MENU_LABELS }
  window.dispatchEvent(new CustomEvent(MENU_LABELS_UPDATED_EVENT, {
    detail: { organizationId, labels: resolved },
  }))
  return resolved
}
