import { Router, type Request, type Response } from 'express'
import { getDbAsync } from '../database/db'
import type { DbAdapter } from '../database/types'
import { authenticateToken } from '../middleware/auth'
import { loadRequestUserContext } from '../middleware/organizationAccess'

const router = Router()

router.use(authenticateToken)

interface DbPendingApprovalRow {
  response_id: number
  collection_id: number
  collection_title: string
  collection_slug: string
  stage_name: string
  stage_order: number
  submitted_at: string
  respondent_name: string | null
  respondent_email: string | null
}

export interface PendingApprovalItem {
  responseId: number
  collectionId: number
  collectionTitle: string
  collectionSlug: string
  stageName: string
  stageOrder: number
  submittedAt: string
  respondentName: string | null
  respondentEmail: string | null
}

/**
 * GET /api/approvals/pending
 * Returns all responses where the authenticated user has a pending approver assignment.
 */
router.get('/pending', async (req: Request, res: Response): Promise<void> => {
  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  if (context.role === 'user') {
    res.json([])
    return
  }

  try {
    const db = await getDbAsync()

    const rows = await db.queryAll<DbPendingApprovalRow>(
        `
        SELECT
          cr.id          AS response_id,
          c.id           AS collection_id,
          c.title        AS collection_title,
          c.slug         AS collection_slug,
          si.stage_name,
          si.stage_order,
          cr.submitted_at,
          cr.respondent_name,
          cr.respondent_email
        FROM approval_workflow_approver_instances ai
        JOIN approval_workflow_stage_instances si ON si.id = ai.stage_instance_id
        JOIN approval_workflow_instances wi       ON wi.id = si.workflow_instance_id
        JOIN collection_responses cr             ON cr.id = wi.response_id
        JOIN collections c                       ON c.id  = wi.collection_id
        WHERE ai.user_id = ?
          AND ai.status  = 'pending'
          AND si.status  = 'pending'
          AND wi.status  = 'pending'
        ORDER BY cr.submitted_at DESC
        `,
      [context.id])

    const items: PendingApprovalItem[] = rows.map(row => ({
      responseId: row.response_id,
      collectionId: row.collection_id,
      collectionTitle: row.collection_title,
      collectionSlug: row.collection_slug,
      stageName: row.stage_name,
      stageOrder: row.stage_order,
      submittedAt: row.submitted_at,
      respondentName: row.respondent_name,
      respondentEmail: row.respondent_email,
    }))

    res.json(items)
  } catch (err) {
    console.error('[approvals] GET /pending failed:', (err as Error).message)
    res.status(500).json({ error: 'Failed to fetch pending approvals' })
  }
})

export default router
