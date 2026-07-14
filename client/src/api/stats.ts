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
  organizationCount: number
  collectionCount: number
  submissionCount: number
}

export async function getStats(): Promise<DashboardStats> {
  const res = await fetch('/api/stats', { headers: authHeaders() })
  handleUnauthorizedResponse(res)
  if (!res.ok) throw new Error('Failed to load dashboard stats')
  return res.json() as Promise<DashboardStats>
}

export interface TrendData {
  dates: string[]
  series: { category: string; data: number[] }[]
}

export async function getTrend(): Promise<TrendData> {
  const res = await fetch('/api/stats/trend', { headers: authHeaders() })
  handleUnauthorizedResponse(res)
  if (!res.ok) throw new Error('Failed to load trend data')
  return res.json() as Promise<TrendData>
}

export async function getPublicSummaryStats(organizationId?: number): Promise<PublicSummaryStats> {
  const url = organizationId
    ? `/api/stats/public-summary?organizationId=${organizationId}`
    : '/api/stats/public-summary'
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to load public summary stats')
  return res.json() as Promise<PublicSummaryStats>
}

export interface GlobalStats {
  organizationCount: number
  collectionCount: number
  submissionCount: number
}

export async function getGlobalStats(): Promise<GlobalStats> {
  const res = await fetch('/api/stats/global', { headers: authHeaders() })
  handleUnauthorizedResponse(res)
  if (!res.ok) throw new Error('Failed to load global stats')
  return res.json() as Promise<GlobalStats>
}

export interface ReportsDateRange {
  startDate: string  // YYYY-MM-DD
  endDate: string    // YYYY-MM-DD
}

export async function getReportsData(range: ReportsDateRange): Promise<ReportsData> {
  const params = new URLSearchParams({ startDate: range.startDate, endDate: range.endDate })
  const res = await fetch(`/api/stats/reports?${params}`, { headers: authHeaders() })
  handleUnauthorizedResponse(res)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `Failed to load reports data (${res.status})`)
  }
  return res.json() as Promise<ReportsData>
}

export type AiFocusArea = 'general' | 'trend' | 'categories' | 'collections' | 'users'

export interface AiSummaryResponse {
  summary: string
  findings: string[]
  actions: string[]
  confidenceNote: string
  generatedAt: string
  model: string
  dataWindow: string
  focus: AiFocusArea
  aiAvailable: boolean
  usedAi: boolean
  scopeLabel: string
  aiFailureReason?: string | null
}

export async function getAiReportsSummary(
  days: ReportsDatePreset = 30,
  focus: AiFocusArea = 'general',
  collectionId?: number,
  promptText?: string,
): Promise<AiSummaryResponse> {
  const res = await fetch('/api/stats/reports/summary-ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ days, focus, collectionId, promptText }),
  })
  handleUnauthorizedResponse(res)
  if (res.status === 429) throw new Error('Rate limit reached. Please wait before generating another summary.')
  if (!res.ok) throw new Error('Failed to generate AI summary.')
  return res.json() as Promise<AiSummaryResponse>
}
