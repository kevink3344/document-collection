import { Router, type Request, type Response } from 'express'
import { getDb } from '../database/db'
import { authenticateToken } from '../middleware/auth'

const router = Router()

const ALLOWED_KEYS = new Set(['collections_card_order'])

interface DbPreference {
  value: string
}

router.get('/:key', authenticateToken, (req: Request, res: Response) => {
  const { key } = req.params
  if (!ALLOWED_KEYS.has(key)) {
    res.status(404).json({ error: 'Preference not found' })
    return
  }

  const userId = req.user?.sub
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const db = getDb()
  const row = db
    .prepare('SELECT value FROM user_preferences WHERE user_id = ? AND key = ?')
    .get(userId, key) as unknown as DbPreference | undefined

  res.json({ key, value: row?.value ?? null })
})

router.put('/:key', authenticateToken, (req: Request, res: Response) => {
  const { key } = req.params
  if (!ALLOWED_KEYS.has(key)) {
    res.status(404).json({ error: 'Preference not found' })
    return
  }

  const userId = req.user?.sub
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const rawValue = (req.body as { value?: unknown }).value
  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    res.status(400).json({ error: 'value is required' })
    return
  }

  const db = getDb()
  db.prepare(
    `INSERT INTO user_preferences (user_id, key, value, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, key)
     DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(userId, key, rawValue)

  res.json({ key, value: rawValue })
})

export default router