import { authHeaders, handleUnauthorizedResponse } from './authEvents'

export type ReportsDatePreset = 7 | 30 | 90 | 'all'

export interface ReportsData {
  kpi: {
    totalSubmissions: number
    activeCollections: number
    categoriesInUse: number
    avgSubmissionsPerCollection: number
  }
  submissionsOverTime: { date: string; count: number }[]
  collectionPerformance: {
    id: number
    title: string
    category: string | null
    status: string
    submissionCount: number
    lastActivity: string | null
  }[]
  categoryBreakdown: { category: string; count: number }[]
  userActivity: {
    id: number
    name: string
    role: string
    organization: string | null
    submissionCount: number
    lastActive: string | null
  }[]
}

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

export async function getReportsData(days: ReportsDatePreset = 30): Promise<ReportsData> {
  const res = await fetch(`/api/stats/reports?days=${days}`, { headers: authHeaders() })
  handleUnauthorizedResponse(res)
  if (!res.ok) throw new Error('Failed to load reports data')
  return res.json() as Promise<ReportsData>
}
