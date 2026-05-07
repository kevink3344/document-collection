import { authHeaders, handleUnauthorizedResponse } from './authEvents'

export interface DashboardStats {
  openCount: number
  draftCount: number
  overdueCount: number
  totalSubmissions: number
  submissionsThisWeek: number
}

export async function getStats(): Promise<DashboardStats> {
  const res = await fetch('/api/stats', { headers: authHeaders() })
  handleUnauthorizedResponse(res)
  if (!res.ok) throw new Error('Failed to load dashboard stats')
  return res.json() as Promise<DashboardStats>
}
