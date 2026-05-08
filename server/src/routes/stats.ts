import { Router, type Request, type Response } from 'express'
import { getDb } from '../database/db'
import { authenticateToken } from '../middleware/auth'

const router = Router()

/**
 * GET /api/stats/public-summary
 * Returns lightweight counts for the signed-out login screen.
 */
router.get('/public-summary', (_req: Request, res: Response): void => {
  try {
    const db = getDb()

    const { categoryCount } = db
      .prepare(`SELECT COUNT(*) AS categoryCount FROM categories`)
      .get() as { categoryCount: number }

    const { collectionCount } = db
      .prepare(`SELECT COUNT(*) AS collectionCount FROM collections`)
      .get() as { collectionCount: number }

    const { submissionCount } = db
      .prepare(`SELECT COUNT(*) AS submissionCount FROM collection_responses`)
      .get() as { submissionCount: number }

    res.json({
      categoryCount,
      collectionCount,
      submissionCount,
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * GET /api/stats
 * Returns dashboard KPI metrics. Accessible to administrators and team_managers only.
 */
router.get('/', authenticateToken, (req: Request, res: Response): void => {
  const role = req.user?.role
  if (role !== 'administrator' && role !== 'team_manager') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  try {
    const db = getDb()

    const { openCount } = db
      .prepare(`SELECT COUNT(*) AS openCount FROM collections WHERE status = 'published'`)
      .get() as { openCount: number }

    const { draftCount } = db
      .prepare(`SELECT COUNT(*) AS draftCount FROM collections WHERE status = 'draft'`)
      .get() as { draftCount: number }

    const { overdueCount } = db
      .prepare(
        `SELECT COUNT(*) AS overdueCount
         FROM collections
         WHERE status = 'published'
           AND date_due IS NOT NULL
           AND date_due < date('now')`
      )
      .get() as { overdueCount: number }

    const { totalSubmissions } = db
      .prepare(`SELECT COUNT(*) AS totalSubmissions FROM collection_responses`)
      .get() as { totalSubmissions: number }

    const { submissionsThisWeek } = db
      .prepare(
        `SELECT COUNT(*) AS submissionsThisWeek
         FROM collection_responses
         WHERE submitted_at >= datetime('now', '-7 days')`
      )
      .get() as { submissionsThisWeek: number }

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

router.get('/reports', authenticateToken, (req: Request, res: Response): void => {
  const role = req.user?.role
  if (role !== 'administrator' && role !== 'team_manager') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  try {
    const db = getDb()
    const daysRaw = req.query.days as string | undefined
    const days: number | null =
      daysRaw === 'all' ? null
      : VALID_DAYS.has(Number(daysRaw)) ? Number(daysRaw)
      : 30

    const dateThreshold = days ? `datetime('now', '-${days} days')` : null

    // ── KPI ─────────────────────────────────────────────────
    const subWhere = dateThreshold ? `WHERE submitted_at >= ${dateThreshold}` : ''
    const { totalSubmissions } = db
      .prepare(`SELECT COUNT(*) AS totalSubmissions FROM collection_responses ${subWhere}`)
      .get() as { totalSubmissions: number }

    const { activeCollections } = db
      .prepare(`SELECT COUNT(*) AS activeCollections FROM collections WHERE status = 'published'`)
      .get() as { activeCollections: number }

    const { categoriesInUse } = db
      .prepare(
        `SELECT COUNT(DISTINCT category) AS categoriesInUse
         FROM collections WHERE category IS NOT NULL AND status = 'published'`
      )
      .get() as { categoriesInUse: number }

    const avgSubmissionsPerCollection =
      activeCollections > 0
        ? Math.round((totalSubmissions / activeCollections) * 10) / 10
        : 0

    // ── Submissions over time ────────────────────────────────
    const submissionsOverTime = db
      .prepare(
        `SELECT date(submitted_at) AS date, COUNT(*) AS count
         FROM collection_responses
         ${subWhere}
         GROUP BY date(submitted_at)
         ORDER BY date ASC`
      )
      .all() as { date: string; count: number }[]

    // ── Collection performance ───────────────────────────────
    const crJoinCond = dateThreshold
      ? `ON cr.collection_id = c.id AND cr.submitted_at >= ${dateThreshold}`
      : `ON cr.collection_id = c.id`

    const collectionPerformance = db
      .prepare(
        `SELECT c.id, c.title, c.category, c.status,
                COUNT(cr.id) AS submissionCount,
                MAX(cr.submitted_at) AS lastActivity
         FROM collections c
         LEFT JOIN collection_responses cr ${crJoinCond}
         GROUP BY c.id
         ORDER BY submissionCount DESC, c.title ASC`
      )
      .all() as {
        id: number
        title: string
        category: string | null
        status: string
        submissionCount: number
        lastActivity: string | null
      }[]

    // ── Category breakdown ───────────────────────────────────
    const categoryBreakdown = db
      .prepare(
        `SELECT COALESCE(c.category, 'Uncategorised') AS category,
                COUNT(cr.id) AS count
         FROM collections c
         LEFT JOIN collection_responses cr ${crJoinCond}
         GROUP BY COALESCE(c.category, 'Uncategorised')
         ORDER BY count DESC`
      )
      .all() as { category: string; count: number }[]

    // ── User activity (admin only) ───────────────────────────
    const crUserJoinCond = dateThreshold
      ? `ON cr.respondent_email = u.email AND cr.submitted_at >= ${dateThreshold}`
      : `ON cr.respondent_email = u.email`

    const userActivity =
      role === 'administrator'
        ? (db
            .prepare(
              `SELECT u.id, u.name, u.role, u.organization,
                      COUNT(cr.id) AS submissionCount,
                      MAX(cr.submitted_at) AS lastActive
               FROM users u
               LEFT JOIN collection_responses cr ${crUserJoinCond}
               GROUP BY u.id
               ORDER BY submissionCount DESC, u.name ASC`
            )
            .all() as {
              id: number
              name: string
              role: string
              organization: string | null
              submissionCount: number
              lastActive: string | null
            }[])
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

export default router
