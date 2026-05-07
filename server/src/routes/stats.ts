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

export default router
