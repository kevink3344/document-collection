import type { Request, Response, NextFunction } from 'express'
import { isDatabaseAvailable } from '../database/db'

/**
 * Pre-check middleware: returns HTTP 503 immediately when no database backend
 * is configured/reachable, instead of letting every route attempt (and fail)
 * its own connection. Mount this before the API routers, e.g.:
 *
 *   app.use('/api', requireDatabase)
 *
 * Health/info endpoints are exempt so they can report status even when the
 * database is down.
 */
export function requireDatabase(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith('/health') || req.path.startsWith('/info')) {
    next()
    return
  }
  if (!isDatabaseAvailable()) {
    res.status(503).json({ error: 'Database connectivity not available. Please try again later.' })
    return
  }
  next()
}
