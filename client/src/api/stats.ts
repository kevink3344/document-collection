import { authHeaders, handleUnauthorizedResponse } from './authEvents'

export interface DashboardStats {
  openCount: number
  draftCount: number
  overdueCount: number
  totalSubmissions: number
  submissionsThisWeek: number
}

export interface PublicSummaryStats {
  categoryCount: number
  collectionCount: number
  submissionCount: number
}

export async function getStats(): Promise<DashboardStats> {
  const res = await fetch('/api/stats', { headers: authHeaders() })
  handleUnauthorizedResponse(res)
  if (!res.ok) throw new Error('Failed to load dashboard stats')
  return res.json() as Promise<DashboardStats>
}

export async function getPublicSummaryStats(): Promise<PublicSummaryStats> {
  const res = await fetch('/api/stats/public-summary')
  if (!res.ok) throw new Error('Failed to load public summary stats')
  return res.json() as Promise<PublicSummaryStats>
}
