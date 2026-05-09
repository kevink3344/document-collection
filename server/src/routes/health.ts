import { Router, type Request, type Response } from 'express'

const router = Router()

/**
 * @openapi
 * /api/health:
 *   get:
 *     tags:
 *       - Health
 *     summary: Health check endpoint
 *     description: Returns the server health status and current timestamp. Used by load balancers, monitoring systems, and platform probes.
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                   description: Server status indicator
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: 2026-05-09T12:34:56.789Z
 *                   description: Current server timestamp in ISO 8601 format
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

export default router
