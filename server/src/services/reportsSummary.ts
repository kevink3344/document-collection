/**
 * Reports AI summary helpers.
 *
 * Responsibilities:
 *  - Build a compact, safe prompt payload from report aggregates
 *  - Validate and type the model's JSON response
 *  - Produce a deterministic fallback summary when AI is unavailable
 */

import type { GroqMessage } from './groq'

// ── Input types (mirror the reports query output) ─────────────────────────────

export interface ReportKpi {
  totalSubmissions: number
  activeCollections: number
  categoriesInUse: number
  avgSubmissionsPerCollection: number
}

export interface ReportData {
  kpi: ReportKpi
  scopeLabel?: string
  submissionsOverTime: { date: string; count: number }[]
  collectionPerformance: {
    title: string
    category: string | null
    status: string
    submissionCount: number
    lastActivity: string | null
  }[]
  categoryBreakdown: { category: string; count: number }[]
  userActivity: {
    name: string
    role: string
    submissionCount: number
    lastActive: string | null
  }[]
}

// ── Focus areas ───────────────────────────────────────────────────────────────

export type FocusArea = 'general' | 'trend' | 'categories' | 'collections' | 'users'

export const DEFAULT_ADMIN_PROMPT_TEXT = 'Provide a concise executive-ready summary that highlights the most important patterns, risks, opportunities, and recommended next actions for administrators.'

const FOCUS_INSTRUCTIONS: Record<FocusArea, string> = {
  general: 'Provide a balanced overview covering all dimensions of the data.',
  trend:
    'Focus especially on submission trends over time. Highlight growth, decline, or anomalies in the series.',
  categories:
    'Focus especially on category performance. Highlight which categories are strong or underperforming.',
  collections:
    'Focus especially on collection performance. Highlight which collections are overperforming or underperforming.',
  users:
    'Focus especially on user activity. Identify who is most active and flag any participation gaps.',
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a concise data analyst producing structured business summaries for the administrator of a document collection platform.

Rules you must follow without exception:
1. Use ONLY the JSON data provided by the user. Do not invent, infer, or guess values not present in the data.
2. If the data is sparse, the time window is short, or key fields are missing, state this in confidenceNote.
3. Respond ONLY with valid JSON matching the exact schema below. No markdown, no prose outside the JSON.
4. Keep language concise, professional, and action-oriented.
5. "summary" must be a single paragraph of 2–4 sentences.
6. "findings" must be an array of 3–6 strings. Each string is one insight derived directly from the data.
7. "actions" must be an array of 2–4 strings. Each string is one concrete, actionable recommendation.
8. "confidenceNote" must be a single sentence describing data reliability or any limitations.

Required JSON output schema (no extra fields):
{
  "summary": "string",
  "findings": ["string"],
  "actions": ["string"],
  "confidenceNote": "string"
}`

// ── Prompt builder ────────────────────────────────────────────────────────────

/**
 * Builds a two-message prompt for Groq from the report aggregates.
 * The payload is trimmed to control token usage:
 *  - Last 14 time-series points
 *  - Top 5 collections
 *  - Top 8 categories
 *  - Top 8 users
 */
export function buildReportsSummaryPrompt(
  data: ReportData,
  days: number | null,
  focus: FocusArea,
  promptText?: string,
): GroqMessage[] {
  const windowLabel = days ? `last ${days} days` : 'all time'
  const effectivePrompt = promptText?.trim() || DEFAULT_ADMIN_PROMPT_TEXT

  const payload = {
    scope: data.scopeLabel ?? 'All surveys',
    dataWindow: windowLabel,
    kpi: data.kpi,
    submissionTrend: data.submissionsOverTime.slice(-14),
    topCollections: data.collectionPerformance.slice(0, 5).map((c) => ({
      title: c.title,
      category: c.category ?? 'Uncategorised',
      status: c.status,
      submissions: c.submissionCount,
      lastActivity: c.lastActivity,
    })),
    categoryBreakdown: data.categoryBreakdown.slice(0, 8),
    userActivity:
      data.userActivity.length > 0
        ? data.userActivity.slice(0, 8).map((u) => ({
            name: u.name,
            role: u.role,
            submissions: u.submissionCount,
            lastActive: u.lastActive,
          }))
        : 'Not available for this role.',
  }

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${FOCUS_INSTRUCTIONS[focus]}\n\nAdministrator instructions:\n${effectivePrompt}\n\nData:\n${JSON.stringify(payload, null, 2)}`,
    },
  ]
}

// ── Response validator ────────────────────────────────────────────────────────

export interface AiSummaryOutput {
  summary: string
  findings: string[]
  actions: string[]
  confidenceNote: string
}

/**
 * Parses and validates the model's JSON response.
 * Returns null if the shape is invalid or JSON is malformed.
 */
export function validateSummaryResponse(raw: string): AiSummaryOutput | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>

    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : null
    const findings = Array.isArray(parsed.findings)
      ? (parsed.findings as unknown[]).filter((f): f is string => typeof f === 'string')
      : null
    const actions = Array.isArray(parsed.actions)
      ? (parsed.actions as unknown[]).filter((a): a is string => typeof a === 'string')
      : null
    const confidenceNote =
      typeof parsed.confidenceNote === 'string' ? parsed.confidenceNote.trim() : null

    if (!summary || !findings?.length || !actions?.length || !confidenceNote) return null

    return { summary, findings, actions, confidenceNote }
  } catch {
    return null
  }
}

// ── Deterministic fallback ────────────────────────────────────────────────────

/**
 * Returns a safe, non-AI summary built purely from the KPI values.
 * Used when the Groq call fails or returns an invalid response.
 */
export function buildFallbackSummary(data: ReportData, days: number | null): AiSummaryOutput {
  const windowLabel = days ? `the last ${days} days` : 'all time'
  const scopeLabel = data.scopeLabel ?? 'All surveys'
  const topCollection = data.collectionPerformance[0]
  const topCategory = data.categoryBreakdown[0]

  const findings: string[] = [
    `${data.kpi.totalSubmissions} total submission(s) recorded over ${windowLabel}.`,
    `${data.kpi.activeCollections} collection(s) are currently active.`,
    `${data.kpi.categoriesInUse} category/categories are in use across active collections.`,
    `Average of ${data.kpi.avgSubmissionsPerCollection} submission(s) per active collection.`,
  ]

  if (topCollection) {
    findings.push(
      `Top collection: "${topCollection.title}" with ${topCollection.submissionCount} submission(s).`,
    )
  }
  if (topCategory) {
    findings.push(
      `Most active category: "${topCategory.category}" with ${topCategory.count} submission(s).`,
    )
  }

  return {
    summary: `${scopeLabel} recorded ${data.kpi.totalSubmissions} submission(s) over ${windowLabel}. This summary was generated from live data without AI assistance.`,
    findings,
    actions: [
      'Review collections with zero submissions and consider closing or promoting them.',
      'Ensure all active collections have a defined due date to track completion.',
    ],
    confidenceNote: 'Deterministic summary — AI summarization was unavailable.',
  }
}
