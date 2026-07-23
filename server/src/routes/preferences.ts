import { Router, type Request, type Response } from 'express'
import { getDbAsync } from '../database/db'
import { authenticateToken } from '../middleware/auth'

const router = Router()

const ALLOWED_KEYS = new Set(['collections_card_order', 'location_import_url', 'settings_panel_layout'])

interface DbPreference {
  value: string
}

router.get('/:key', authenticateToken, async (req: Request, res: Response) => {
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

  const db = await getDbAsync()
  const row = await db.queryOne<DbPreference>('SELECT value FROM user_preferences WHERE user_id = ? AND key = ?', [userId, key])

  res.json({ key, value: row?.value ?? null })
})

router.put('/:key', authenticateToken, async (req: Request, res: Response) => {
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

  const db = await getDbAsync()
  await db.execute(
    `INSERT INTO user_preferences (user_id, key, value, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, key)
     DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [userId, key, rawValue]
  )

  res.json({ key, value: rawValue })
})

export default router