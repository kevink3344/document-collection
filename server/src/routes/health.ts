import { Router, type Request, type Response } from 'express'
import { getConfiguredDatabaseMode } from '../database/db'
import { isGoogleDriveConfigured } from '../services/googleDrive'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('../../package.json') as { version: string }

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

router.get('/info', (_req: Request, res: Response) => {
  const loginModeOverride = process.env.LOGIN_MODE?.trim().toLowerCase()
  // Only pass through valid CSS hex colors to prevent injection.
  // Also add # prefix if omitted (dotenv strips # values unless quoted).
  const rawColor = process.env.LOGIN_SCREEN_COLOR?.trim() ?? ''
  const normalizedColor = rawColor.startsWith('#') ? rawColor : rawColor ? `#${rawColor}` : ''
  const loginScreenColor = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(normalizedColor) ? normalizedColor : null
  res.json({
    version: pkg.version,
    dbMode: getConfiguredDatabaseMode(),
    googleDriveConfigured: isGoogleDriveConfigured(),
    loginModeOverride: (loginModeOverride === 'maintenance' || loginModeOverride === 'select' || loginModeOverride === 'password')
      ? loginModeOverride
      : null,
    loginScreenColor,
  })
})

export default router
