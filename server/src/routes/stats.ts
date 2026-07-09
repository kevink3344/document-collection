import { Router, type Request, type Response } from 'express'
import { getDbAsync } from '../database/db'
import { authenticateToken } from '../middleware/auth'
import { loadRequestUserContext, isAdministrator } from '../middleware/organizationAccess'
import { callGroq, checkRateLimit, GROQ_MAX_TOKENS, GROQ_MAX_DATE_RANGE_DAYS } from '../services/groq'
import {
  buildReportsSummaryPrompt,
  validateSummaryResponse,
  buildFallbackSummary,
  type FocusArea,
  type ReportData,
} from '../services/reportsSummary'

const router = Router()

/**
 * GET /api/stats/public-summary
 * Returns lightweight counts for the signed-out login screen.
 * Accepts an optional ?organizationId= query parameter to scope counts to one org.
 */
router.get('/public-summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const db = await getDbAsync()
    const rawOrgId = req.query.organizationId
    const orgId = rawOrgId && !isNaN(Number(rawOrgId)) ? Number(rawOrgId) : null

    const categorySummary = orgId
      ? await db.queryOne<{ categoryCount: number }>(
          `SELECT COUNT(DISTINCT category) AS categoryCount
             FROM collections
             WHERE organization_id = ? AND category IS NOT NULL`,
          [orgId]
        )
      : await db.queryOne<{ categoryCount: number }>(`SELECT COUNT(*) AS categoryCount FROM categories`)
    const categoryCount = categorySummary?.categoryCount ?? 0

    const orgRow = await db.queryOne<{ organizationCount: number }>(`SELECT COUNT(*) AS organizationCount FROM organizations`)
    const organizationCount = orgRow?.organizationCount ?? 0

    const collectionRow = orgId
      ? await db.queryOne<{ collectionCount: number }>(`SELECT COUNT(*) AS collectionCount FROM collections WHERE organization_id = ?`, [orgId])
      : await db.queryOne<{ collectionCount: number }>(`SELECT COUNT(*) AS collectionCount FROM collections`)
    const collectionCount = collectionRow?.collectionCount ?? 0

    const submissionRow = orgId
      ? await db.queryOne<{ submissionCount: number }>(
          `SELECT COUNT(*) AS submissionCount
             FROM collection_responses cr
             JOIN collections c ON c.id = cr.collection_id
             WHERE c.organization_id = ?`,
          [orgId]
        )
      : await db.queryOne<{ submissionCount: number }>(`SELECT COUNT(*) AS submissionCount FROM collection_responses`)
    const submissionCount = submissionRow?.submissionCount ?? 0

    res.json({
      categoryCount,
      organizationCount,
      collectionCount,
      submissionCount,
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * GET /api/stats/trend
 * Returns daily submission counts per category for the last 21 days.
 * Accessible to super_admin, administrators, team_managers, and reviewers.
 * Categories with zero submissions in the window are omitted.
 */
const TREND_DAYS = 21

router.get('/trend', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const context = await loadRequestUserContext(req)
  const role = context?.role
  if (role !== 'super_admin' && role !== 'administrator' && role !== 'team_manager' && role !== 'reviewer') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  try {
    const db = await getDbAsync()
    const scopeParam = !isAdministrator(context!) && context?.organizationId ? [context.organizationId] : []
    const collectionScopeAnd = !isAdministrator(context!) && context?.organizationId
      ? 'AND c.organization_id = ?'
      : !isAdministrator(context!) ? 'AND 1 = 0' : ''

    // Build ordered array of the last TREND_DAYS dates (oldest → today)
    const dates: string[] = []
    for (let i = TREND_DAYS - 1; i >= 0; i--) {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - i)
      dates.push(d.toISOString().slice(0, 10))
    }

    const rows = await db.queryAll<{ date: string; category: string; count: number }>(
        `SELECT date(cr.submitted_at) AS date,
                COALESCE(c.category, 'Uncategorised') AS category,
                COUNT(*) AS count
         FROM collection_responses cr
         JOIN collections c ON c.id = cr.collection_id
         WHERE cr.submitted_at >= date('now', '-${TREND_DAYS - 1} days') ${collectionScopeAnd}
         GROUP BY date(cr.submitted_at), COALESCE(c.category, 'Uncategorised')
         ORDER BY date ASC`,
        scopeParam
      )

    // Pivot: category → date → count
    const categoryMap = new Map<string, Map<string, number>>()
    for (const row of rows) {
      if (!categoryMap.has(row.category)) categoryMap.set(row.category, new Map())
      categoryMap.get(row.category)!.set(row.date, row.count)
    }

    const series = Array.from(categoryMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, dateMap]) => ({
        category,
        data: dates.map(d => dateMap.get(d) ?? 0),
      }))

    res.json({ dates, series })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * GET /api/stats
 * Returns dashboard KPI metrics. Accessible to super_admin, administrators, team_managers, and reviewers.
 */
router.get('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const context = await loadRequestUserContext(req)
  const role = context?.role
  if (role !== 'super_admin' && role !== 'administrator' && role !== 'team_manager' && role !== 'reviewer') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  try {
    const db = await getDbAsync()
    const collectionParams = !isAdministrator(context!) && context?.organizationId ? [context.organizationId] : []
    const collectionFilter = !isAdministrator(context!) && context?.organizationId ? ' AND organization_id = ?' : !isAdministrator(context!) ? ' AND 1 = 0' : ''
    const submissionJoin = !isAdministrator(context!) && context?.organizationId ? 'JOIN collections c ON c.id = cr.collection_id AND c.organization_id = ?' : !isAdministrator(context!) ? 'JOIN collections c ON 1 = 0' : 'JOIN collections c ON c.id = cr.collection_id'

    const openRow = await db.queryOne<{ openCount: number }>(`SELECT COUNT(*) AS openCount FROM collections WHERE status = 'published'${collectionFilter}`, collectionParams)
    const openCount = openRow?.openCount ?? 0

    const draftRow = await db.queryOne<{ draftCount: number }>(`SELECT COUNT(*) AS draftCount FROM collections WHERE status = 'draft'${collectionFilter}`, collectionParams)
    const draftCount = draftRow?.draftCount ?? 0

    const overdueRow = await db.queryOne<{ overdueCount: number }>(
        `SELECT COUNT(*) AS overdueCount
         FROM collections
         WHERE status = 'published'
           AND date_due IS NOT NULL
           AND date_due < date('now')${collectionFilter}`,
        collectionParams
      )
    const overdueCount = overdueRow?.overdueCount ?? 0

    const totalRow = await db.queryOne<{ totalSubmissions: number }>(`SELECT COUNT(*) AS totalSubmissions FROM collection_responses cr ${submissionJoin}`, collectionParams)
    const totalSubmissions = totalRow?.totalSubmissions ?? 0

    const weekRow = await db.queryOne<{ submissionsThisWeek: number }>(
        `SELECT COUNT(*) AS submissionsThisWeek
         FROM collection_responses cr
         ${submissionJoin}
         WHERE cr.submitted_at >= datetime('now', '-7 days')`,
        collectionParams
      )
    const submissionsThisWeek = weekRow?.submissionsThisWeek ?? 0

    res.json({
      openCount,
      draftCount,
      overdueCount,
      totalSubmissions,
      submissionsThisWeek,
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * GET /api/stats/reports?days=30
 * Full reports data. Accessible to administrators and team_managers only.
 * days: 7 | 30 | 90 | "all"  (default 30)
 */
const VALID_DAYS = new Set([7, 30, 90])

router.get('/reports', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const context = await loadRequestUserContext(req)
  const role = context?.role
  if (role !== 'super_admin' && role !== 'administrator' && role !== 'team_manager') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  try {
    const db = await getDbAsync()
    const scopeParam = !isAdministrator(context!) && context?.organizationId ? [context.organizationId] : []
    const collectionScope = !isAdministrator(context!) && context?.organizationId ? 'WHERE c.organization_id = ?' : !isAdministrator(context!) ? 'WHERE 1 = 0' : ''
    const collectionScopeAnd = !isAdministrator(context!) && context?.organizationId ? 'AND c.organization_id = ?' : !isAdministrator(context!) ? 'AND 1 = 0' : ''
    const daysRaw = req.query.days as string | undefined
    const days: number | null =
      daysRaw === 'all' ? null
      : VALID_DAYS.has(Number(daysRaw)) ? Number(daysRaw)
      : 30

    const dateThreshold = days ? `datetime('now', '-${days} days')` : null

    // ── KPI ─────────────────────────────────────────────────
    const subWhere = dateThreshold
      ? `WHERE ${!isAdministrator(context!) && context?.organizationId ? 'c.organization_id = ? AND ' : !isAdministrator(context!) ? '1 = 0 AND ' : ''}cr.submitted_at >= ${dateThreshold}`
      : (!isAdministrator(context!) && context?.organizationId ? 'WHERE c.organization_id = ?' : !isAdministrator(context!) ? 'WHERE 1 = 0' : '')
    const { totalSubmissions } = (await db.queryOne<{ totalSubmissions: number }>(
        `SELECT COUNT(*) AS totalSubmissions FROM collection_responses cr JOIN collections c ON c.id = cr.collection_id ${subWhere}`,
        scopeParam
      )) ?? { totalSubmissions: 0 }

    const { activeCollections } = (await db.queryOne<{ activeCollections: number }>(
        `SELECT COUNT(*) AS activeCollections FROM collections c WHERE status = 'published' ${collectionScopeAnd}`,
        scopeParam
      )) ?? { activeCollections: 0 }

    const { categoriesInUse } = (await db.queryOne<{ categoriesInUse: number }>(
        `SELECT COUNT(DISTINCT category) AS categoriesInUse
        FROM collections c WHERE category IS NOT NULL AND status = 'published' ${collectionScopeAnd}`,
        scopeParam
      )) ?? { categoriesInUse: 0 }

    const avgSubmissionsPerCollection =
      activeCollections > 0
        ? Math.round((totalSubmissions / activeCollections) * 10) / 10
        : 0

    // ── Submissions over time ────────────────────────────────
    const submissionsOverTime = await db.queryAll<{ date: string; count: number }>(
        `SELECT date(submitted_at) AS date, COUNT(*) AS count
          FROM collection_responses cr
          JOIN collections c ON c.id = cr.collection_id
         ${subWhere}
          GROUP BY date(cr.submitted_at)
         ORDER BY date ASC`,
        scopeParam
      )

    // ── Collection performance ───────────────────────────────
    const crJoinCond = dateThreshold
      ? `ON cr.collection_id = c.id AND cr.submitted_at >= ${dateThreshold}`
      : `ON cr.collection_id = c.id`

    const collectionPerformance = await db.queryAll<{
        id: number
        title: string
        category: string | null
        status: string
        submissionCount: number
        lastActivity: string | null
      }>(
        `SELECT c.id, c.title, c.category, c.status,
                COUNT(cr.id) AS submissionCount,
                MAX(cr.submitted_at) AS lastActivity
         FROM collections c
         LEFT JOIN collection_responses cr ${crJoinCond}
        ${collectionScope}
         GROUP BY c.id
         ORDER BY submissionCount DESC, c.title ASC`,
        scopeParam
      )

    // ── Category breakdown ───────────────────────────────────
    const categoryBreakdown = await db.queryAll<{ category: string; count: number }>(
        `SELECT COALESCE(c.category, 'Uncategorised') AS category,
                COUNT(cr.id) AS count
         FROM collections c
         LEFT JOIN collection_responses cr ${crJoinCond}
        ${collectionScope}
         GROUP BY COALESCE(c.category, 'Uncategorised')
         ORDER BY count DESC`,
        scopeParam
      )

    // ── User activity (admin only) ───────────────────────────
    const crUserJoinCond = dateThreshold
      ? `ON cr.respondent_email = u.email AND cr.submitted_at >= ${dateThreshold}`
      : `ON cr.respondent_email = u.email`

    const userActivity =
      role === 'administrator'
        ? await db.queryAll<{ id: number; name: string; role: string; organization: string | null; submissionCount: number; lastActive: string | null }>(
            `SELECT u.id, u.name, u.role, u.organization,
                      COUNT(cr.id) AS submissionCount,
                      MAX(cr.submitted_at) AS lastActive
               FROM users u
               LEFT JOIN collection_responses cr ${crUserJoinCond}
               GROUP BY u.id
               ORDER BY submissionCount DESC, u.name ASC`
          )
        : []

    res.json({
      kpi: { totalSubmissions, activeCollections, categoriesInUse, avgSubmissionsPerCollection },
      submissionsOverTime,
      collectionPerformance,
      categoryBreakdown,
      userActivity,
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * POST /api/stats/reports/summary-ai
 * Generates an AI-powered summary of the current reports data using Groq.
 * Falls back to a deterministic summary if AI is unavailable.
 * Accessible to administrators and team_managers only.
 *
 * Body: { days?: 7 | 30 | 90 | 'all', focus?: 'general' | 'trend' | 'categories' | 'collections' | 'users' }
 */
const VALID_FOCUS = new Set<FocusArea>(['general', 'trend', 'categories', 'collections', 'users'])

router.post('/reports/summary-ai', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const context = await loadRequestUserContext(req)
  const role = context?.role
  const userId = context?.id

  if (role !== 'super_admin' && role !== 'administrator' && role !== 'team_manager') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  // ── Input validation ────────────────────────────────────────
  const daysRaw = req.body.days as unknown
  const days: number | null =
    daysRaw === 'all' ? null
    : VALID_DAYS.has(Number(daysRaw)) ? Number(daysRaw)
    : Number(daysRaw) <= GROQ_MAX_DATE_RANGE_DAYS && Number(daysRaw) > 0 ? Number(daysRaw)
    : 30

  const focusRaw = req.body.focus as unknown
  const focus: FocusArea =
    typeof focusRaw === 'string' && VALID_FOCUS.has(focusRaw as FocusArea)
      ? (focusRaw as FocusArea)
      : 'general'

  const collectionIdRaw = req.body.collectionId as unknown
  const collectionId =
    typeof collectionIdRaw === 'number' && Number.isInteger(collectionIdRaw) && collectionIdRaw > 0
      ? collectionIdRaw
      : typeof collectionIdRaw === 'string' && /^\d+$/.test(collectionIdRaw)
        ? Number(collectionIdRaw)
        : null

  const promptTextRaw = req.body.promptText as unknown
  const promptText = typeof promptTextRaw === 'string'
    ? promptTextRaw.trim().slice(0, 4000)
    : ''

  // ── Rate limit ───────────────────────────────────────────────
  if (userId !== undefined && !checkRateLimit(userId)) {
    res.status(429).json({ error: 'Rate limit exceeded. Please wait before generating another summary.' })
    return
  }

  try {
    const db = await getDbAsync()
    const scopeParam = !isAdministrator(context!) && context?.organizationId ? [context.organizationId] : []
    const dateThreshold = days ? `datetime('now', '-${days} days')` : null
    const selectedCollection = collectionId
      ? await db.queryOne<{ id: number; title: string; category: string | null; status: string }>(
          `SELECT id, title, category, status FROM collections ${!isAdministrator(context!) && context?.organizationId ? 'WHERE id = ? AND organization_id = ?' : !isAdministrator(context!) ? 'WHERE 1 = 0' : 'WHERE id = ?'}`,
          (!isAdministrator(context!) && context?.organizationId ? [collectionId, context.organizationId] : [collectionId])
        )
      : undefined

    if (collectionId && !selectedCollection) {
      res.status(404).json({ error: 'Survey not found.' })
      return
    }

    const responseWhereParts: string[] = []
    const responseParams: Array<string | number> = []
    const collectionScopeWhere = !isAdministrator(context!) && context?.organizationId ? 'c.organization_id = ?' : !isAdministrator(context!) ? '1 = 0' : ''

    if (collectionScopeWhere) {
      responseWhereParts.push(collectionScopeWhere)
      if (context?.organizationId) {
        responseParams.push(context.organizationId)
      }
    }

    if (collectionId) {
      responseWhereParts.push('collection_id = ?')
      responseParams.push(collectionId)
    }
    if (dateThreshold) {
      responseWhereParts.push(`submitted_at >= ${dateThreshold}`)
    }

    const subWhere = responseWhereParts.length > 0 ? `WHERE ${responseWhereParts.join(' AND ')}` : ''

    // ── Gather aggregates (same logic as /reports) ───────────
    const { totalSubmissions } = (await db.queryOne<{ totalSubmissions: number }>(
        `SELECT COUNT(*) AS totalSubmissions FROM collection_responses cr JOIN collections c ON c.id = cr.collection_id ${subWhere}`,
        responseParams
      )) ?? { totalSubmissions: 0 }

    const activeCollections = selectedCollection
      ? selectedCollection.status === 'published' ? 1 : 0
      : ((await db.queryOne<{ activeCollections: number }>(
          `SELECT COUNT(*) AS activeCollections FROM collections WHERE status = 'published' ${!isAdministrator(context!) && context?.organizationId ? 'AND organization_id = ?' : !isAdministrator(context!) ? 'AND 1 = 0' : ''}`,
          scopeParam
        ))?.activeCollections ?? 0)

    const categoriesInUse = selectedCollection
      ? selectedCollection.category ? 1 : 0
      : ((await db.queryOne<{ categoriesInUse: number }>(
          `SELECT COUNT(DISTINCT category) AS categoriesInUse
             FROM collections WHERE category IS NOT NULL AND status = 'published' ${!isAdministrator(context!) && context?.organizationId ? 'AND organization_id = ?' : !isAdministrator(context!) ? 'AND 1 = 0' : ''}`,
          scopeParam
        ))?.categoriesInUse ?? 0)

    const avgSubmissionsPerCollection =
      activeCollections > 0
        ? Math.round((totalSubmissions / activeCollections) * 10) / 10
        : 0

    const submissionsOverTime2 = await db.queryAll<{ date: string; count: number }>(
        `SELECT date(submitted_at) AS date, COUNT(*) AS count
          FROM collection_responses cr JOIN collections c ON c.id = cr.collection_id ${subWhere}
         GROUP BY date(submitted_at) ORDER BY date ASC`,
        responseParams
      )

    const collectionPerformance2 = selectedCollection
      ? ([await db.queryOne<{ id: number; title: string; category: string | null; status: string; submissionCount: number; lastActivity: string | null }>(
            `SELECT c.id, c.title, c.category, c.status,
                    COUNT(cr.id) AS submissionCount, MAX(cr.submitted_at) AS lastActivity
             FROM collections c
             LEFT JOIN collection_responses cr
               ON cr.collection_id = c.id ${dateThreshold ? `AND cr.submitted_at >= ${dateThreshold}` : ''}
             WHERE c.id = ? ${!isAdministrator(context!) && context?.organizationId ? 'AND c.organization_id = ?' : !isAdministrator(context!) ? 'AND 1 = 0' : ''}
             GROUP BY c.id`,
            (!isAdministrator(context!) && context?.organizationId ? [collectionId, context.organizationId] : [collectionId])
          )].filter(Boolean) as { id: number; title: string; category: string | null; status: string; submissionCount: number; lastActivity: string | null }[])
      : (await db.queryAll<{ id: number; title: string; category: string | null; status: string; submissionCount: number; lastActivity: string | null }>(
          `SELECT c.id, c.title, c.category, c.status,
                    COUNT(cr.id) AS submissionCount, MAX(cr.submitted_at) AS lastActivity
             FROM collections c
             LEFT JOIN collection_responses cr ${dateThreshold
               ? `ON cr.collection_id = c.id AND cr.submitted_at >= ${dateThreshold}`
               : `ON cr.collection_id = c.id`}
             ${!isAdministrator(context!) && context?.organizationId ? 'WHERE c.organization_id = ?' : !isAdministrator(context!) ? 'WHERE 1 = 0' : ''}
             GROUP BY c.id ORDER BY submissionCount DESC, c.title ASC`,
          scopeParam
        ))

    const categoryBreakdown2 = selectedCollection
      ? [{ category: selectedCollection.category ?? 'Uncategorised', count: totalSubmissions }]
      : (await db.queryAll<{ category: string; count: number }>(
          `SELECT COALESCE(c.category, 'Uncategorised') AS category, COUNT(cr.id) AS count
             FROM collections c
             LEFT JOIN collection_responses cr ${dateThreshold
               ? `ON cr.collection_id = c.id AND cr.submitted_at >= ${dateThreshold}`
               : `ON cr.collection_id = c.id`}
             ${!isAdministrator(context!) && context?.organizationId ? 'WHERE c.organization_id = ?' : !isAdministrator(context!) ? 'WHERE 1 = 0' : ''}
             GROUP BY COALESCE(c.category, 'Uncategorised') ORDER BY count DESC`,
          scopeParam
        ))

    const userActivityWhereParts: string[] = ['cr.respondent_email = u.email']
    const userActivityParams: Array<string | number> = []
    if (collectionId) {
      userActivityWhereParts.push('cr.collection_id = ?')
      userActivityParams.push(collectionId)
    }
    if (dateThreshold) {
      userActivityWhereParts.push(`cr.submitted_at >= ${dateThreshold}`)
    }

    const crUserJoinCond = `ON ${userActivityWhereParts.join(' AND ')}`

    const userActivity2 =
      role === 'administrator'
        ? await db.queryAll<{ id: number; name: string; role: string; organization: string | null; submissionCount: number; lastActive: string | null }>(
            `SELECT u.id, u.name, u.role, u.organization,
                      COUNT(cr.id) AS submissionCount, MAX(cr.submitted_at) AS lastActive
               FROM users u
               LEFT JOIN collection_responses cr ${crUserJoinCond}
               GROUP BY u.id ORDER BY submissionCount DESC, u.name ASC`,
            userActivityParams
          )
        : []

    const reportData: ReportData = {
      scopeLabel: selectedCollection ? `Survey: ${selectedCollection.title}` : 'All surveys',
      kpi: { totalSubmissions, activeCollections, categoriesInUse, avgSubmissionsPerCollection },
      submissionsOverTime: submissionsOverTime2,
      collectionPerformance: collectionPerformance2,
      categoryBreakdown: categoryBreakdown2,
      userActivity: userActivity2,
    }

    // ── Call Groq ────────────────────────────────────────────
    const groqEnabled =
      !!process.env.GROQ_API_URL && !!process.env.GROQ_API_KEY && !!process.env.GROQ_MODEL

    let output = buildFallbackSummary(reportData, days)
    let usedAi = false
    let aiFailureReason: string | null = null

    if (groqEnabled) {
      try {
        const messages = buildReportsSummaryPrompt(reportData, days, focus, promptText)
        const result = await callGroq(messages, GROQ_MAX_TOKENS)
        const validated = validateSummaryResponse(result.content)
        if (validated) {
          output = validated
          usedAi = true
        } else {
          aiFailureReason = 'Groq returned a response that did not match the expected JSON summary format.'
        }
      } catch (err) {
        aiFailureReason = err instanceof Error ? err.message : 'Unknown Groq error.'
        console.error('[stats] Groq summary failed:', aiFailureReason)
      }
    }

    const dataWindow = days ? `Last ${days} days` : 'All time'

    res.json({
      ...output,
      generatedAt: new Date().toISOString(),
      model: usedAi ? (process.env.GROQ_MODEL ?? 'unknown') : 'fallback',
      dataWindow,
      scopeLabel: reportData.scopeLabel,
      focus,
      aiAvailable: groqEnabled,
      usedAi,
      aiFailureReason,
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * GET /api/stats/global
 * Returns cross-org counts for the super_admin dashboard.
 */
router.get('/global', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const context = await loadRequestUserContext(req)
  if (context?.role !== 'super_admin') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  try {
    const db = await getDbAsync()
    const orgRow = await db.queryOne<{ organizationCount: number }>(`SELECT COUNT(*) AS organizationCount FROM organizations`)
    const colRow = await db.queryOne<{ collectionCount: number }>(`SELECT COUNT(*) AS collectionCount FROM collections`)
    const subRow = await db.queryOne<{ submissionCount: number }>(`SELECT COUNT(*) AS submissionCount FROM collection_responses`)
    res.json({
      organizationCount: orgRow?.organizationCount ?? 0,
      collectionCount: colRow?.collectionCount ?? 0,
      submissionCount: subRow?.submissionCount ?? 0,
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
