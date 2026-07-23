import { Router, type Request, type Response } from 'express'
import { getDbAsync, setConfiguredDatabaseMode } from '../database/db'
import { authenticateToken } from '../middleware/auth'
import { getDocumentStorageMode, isStorageBackendAvailable, getFileCounts, type DocumentStorageMode } from '../services/documentStorage'

const router = Router()

const ALLOWED_KEYS = new Set([
  'login_message',
  'login_subtitle',
  'notification_reminder_days',
  'notification_late_days',
  'qr_code_enabled',
  'submission_confirmation_emails',
  'image_logo_padding_top',
  'image_logo_padding_right',
  'image_logo_padding_bottom',
  'image_logo_padding_left',
  'copy_answers_disclaimer',
  'ai_summary_enabled',
  'about_message',
  'database_mode',
  'login_mode',
  'maintenance_message',
  'document_storage_mode',
])

interface DbSetting {
  key: string
  value: string
}

// ── Settings Tabs CRUD (Super Admin only) ──────────────────────────────────
// NOTE: these must be registered before the generic '/:key' routes below,
// otherwise Express matches '/tabs' as key="tabs" and returns 404 "Setting not found".

interface SettingsTabRow {
  id: number
  name: string
  slug: string
  sort_order: number
  visible_to: 'all' | 'super_admin_only'
}

/**
 * GET /api/settings/tabs
 * List all settings tabs, ordered by sort_order. Any authenticated admin/super_admin
 * may read the list; the client filters out `super_admin_only` tabs for non-super-admins.
 */
router.get('/tabs', authenticateToken, async (req: Request, res: Response) => {
  if (req.user?.role !== 'super_admin' && req.user?.role !== 'administrator') {
    res.status(403).json({ error: 'Administrator access required' })
    return
  }

  const db = await getDbAsync()
  const rows = await db.queryAll<SettingsTabRow>(
    'SELECT id, name, slug, sort_order, visible_to FROM settings_tabs ORDER BY sort_order, id'
  )

  res.json(
    rows.map(row => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      sortOrder: row.sort_order,
      visibleTo: row.visible_to,
    }))
  )
})

/**
 * POST /api/settings/tabs
 * Create a new settings tab. slug must be unique.
 * Body: { name: string, slug: string, visibleTo: 'all' | 'super_admin_only' }
 */
router.post('/tabs', authenticateToken, async (req: Request, res: Response) => {
  if (req.user?.role !== 'super_admin') {
    res.status(403).json({ error: 'Super admin access required' })
    return
  }

  const { name, slug, visibleTo } = req.body as { name?: string; slug?: string; visibleTo?: string }
  if (!name?.trim() || !slug?.trim()) {
    res.status(400).json({ error: 'name and slug are required' })
    return
  }
  if (visibleTo !== 'all' && visibleTo !== 'super_admin_only') {
    res.status(400).json({ error: 'visibleTo must be "all" or "super_admin_only"' })
    return
  }

  const slugPattern = /^[a-z0-9-]+$/
  if (!slugPattern.test(slug.trim())) {
    res.status(400).json({ error: 'slug must contain only lowercase letters, numbers, and hyphens' })
    return
  }

  const db = await getDbAsync()

  // Check slug uniqueness
  const existing = await db.queryOne<{ id: number }>(
    'SELECT id FROM settings_tabs WHERE slug = ?',
    [slug.trim()]
  )
  if (existing) {
    res.status(409).json({ error: `A tab with slug "${slug}" already exists` })
    return
  }

  // Get max sort_order
  const maxOrder = await db.queryOne<{ maxSort: number }>(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS maxSort FROM settings_tabs'
  )

  const result = await db.execute(
    'INSERT INTO settings_tabs (name, slug, sort_order, visible_to) VALUES (?, ?, ?, ?)',
    [name.trim(), slug.trim(), maxOrder?.maxSort ?? 0, visibleTo]
  )

  const created = await db.queryOne<SettingsTabRow>(
    'SELECT id, name, slug, sort_order, visible_to FROM settings_tabs WHERE id = ?',
    [result.lastInsertRowid]
  )

  res.status(201).json({
    id: created!.id,
    name: created!.name,
    slug: created!.slug,
    sortOrder: created!.sort_order,
    visibleTo: created!.visible_to,
  })
})

/**
 * PUT /api/settings/tabs/reorder
 * Batch reorder tabs. Body: { orderedIds: number[] }
 * NOTE: registered before PUT /tabs/:id so "reorder" isn't captured as an :id value.
 */
router.put('/tabs/reorder', authenticateToken, async (req: Request, res: Response) => {
  if (req.user?.role !== 'super_admin') {
    res.status(403).json({ error: 'Super admin access required' })
    return
  }

  const { orderedIds } = req.body as { orderedIds?: number[] }
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    res.status(400).json({ error: 'orderedIds array is required' })
    return
  }

  const db = await getDbAsync()

  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.execute(
        'UPDATE settings_tabs SET sort_order = ?, updated_at = datetime(\'now\') WHERE id = ?',
        [i, orderedIds[i]]
      )
    }
  })

  res.json({ success: true })
})

/**
 * PUT /api/settings/tabs/:id
 * Update a tab's name, visibility, and/or sort_order.
 * Body (any optional): { name?, visibleTo?, sortOrder? }
 */
router.put('/tabs/:id', authenticateToken, async (req: Request, res: Response) => {
  if (req.user?.role !== 'super_admin') {
    res.status(403).json({ error: 'Super admin access required' })
    return
  }

  const tabId = Number.parseInt(req.params.id, 10)
  if (!Number.isInteger(tabId)) {
    res.status(400).json({ error: 'Invalid tab id' })
    return
  }

  const { name, visibleTo, sortOrder } = req.body as { name?: string; visibleTo?: string; sortOrder?: number }
  if (!name?.trim() && visibleTo == null && sortOrder == null) {
    res.status(400).json({ error: 'At least one field (name, visibleTo, sortOrder) is required' })
    return
  }

  if (visibleTo != null && visibleTo !== 'all' && visibleTo !== 'super_admin_only') {
    res.status(400).json({ error: 'visibleTo must be "all" or "super_admin_only"' })
    return
  }

  const db = await getDbAsync()

  const existing = await db.queryOne<SettingsTabRow>(
    'SELECT id, name, slug, sort_order, visible_to FROM settings_tabs WHERE id = ?',
    [tabId]
  )
  if (!existing) {
    res.status(404).json({ error: 'Tab not found' })
    return
  }

  const updates: string[] = []
  const params: unknown[] = []

  if (name?.trim()) {
    updates.push('name = ?')
    params.push(name.trim())
  }
  if (visibleTo != null) {
    updates.push('visible_to = ?')
    params.push(visibleTo)
  }
  if (sortOrder != null) {
    updates.push('sort_order = ?')
    params.push(sortOrder)
  }

  if (updates.length > 0) {
    updates.push('updated_at = datetime(\'now\')')
    params.push(tabId)
    await db.execute(
      `UPDATE settings_tabs SET ${updates.join(', ')} WHERE id = ?`,
      params
    )
  }

  const updated = await db.queryOne<SettingsTabRow>(
    'SELECT id, name, slug, sort_order, visible_to FROM settings_tabs WHERE id = ?',
    [tabId]
  )

  res.json({
    id: updated!.id,
    name: updated!.name,
    slug: updated!.slug,
    sortOrder: updated!.sort_order,
    visibleTo: updated!.visible_to,
  })
})

/**
 * DELETE /api/settings/tabs/:id
 * Delete a tab. Panels assigned to this tab are reassigned to the first remaining tab.
 */
router.delete('/tabs/:id', authenticateToken, async (req: Request, res: Response) => {
  if (req.user?.role !== 'super_admin') {
    res.status(403).json({ error: 'Super admin access required' })
    return
  }

  const tabId = Number.parseInt(req.params.id, 10)
  if (!Number.isInteger(tabId)) {
    res.status(400).json({ error: 'Invalid tab id' })
    return
  }

  const db = await getDbAsync()

  const existing = await db.queryOne<SettingsTabRow>(
    'SELECT id, slug FROM settings_tabs WHERE id = ?',
    [tabId]
  )
  if (!existing) {
    res.status(404).json({ error: 'Tab not found' })
    return
  }

  // Find the first remaining tab to reassign panels
  const firstTab = await db.queryOne<SettingsTabRow>(
    'SELECT id, slug FROM settings_tabs WHERE id != ? ORDER BY sort_order, id LIMIT 1',
    [tabId]
  )
  if (!firstTab) {
    res.status(400).json({ error: 'Cannot delete the last tab. Create another tab first.' })
    return
  }

  // Reassign user preferences that reference this tab's slug
  // We look for the settings_panel_layout key and replace the old slug with the first tab's slug
  await db.transaction(async (tx) => {
    // Delete the tab
    await tx.execute('DELETE FROM settings_tabs WHERE id = ?', [tabId])
  })

  // Also update user_preferences: reassign panels from the deleted tab to the first tab
  const prefs = await db.queryAll<{ user_id: number; key: string; value: string }>(
    "SELECT user_id, key, value FROM user_preferences WHERE key = 'settings_panel_layout'"
  )

  for (const pref of prefs) {
    try {
      const layout = JSON.parse(pref.value) as Record<string, string[]>
      if (layout[existing.slug]) {
        const panels = layout[existing.slug] ?? []
        delete layout[existing.slug]
        if (!layout[firstTab.slug]) {
          layout[firstTab.slug] = []
        }
        layout[firstTab.slug] = [...panels, ...layout[firstTab.slug]]
        await db.execute(
          'UPDATE user_preferences SET value = ?, updated_at = datetime(\'now\') WHERE user_id = ? AND key = ?',
          [JSON.stringify(layout), pref.user_id, 'settings_panel_layout']
        )
      }
    } catch {
      // Ignore parse errors in individual preferences
    }
  }

  res.json({ success: true, reassignedTo: firstTab.slug })
})

// ── End Settings Tabs CRUD ──────────────────────────────────────────────────

/**
 * @swagger
 * /api/settings/{key}:
 *   get:
 *     summary: Get an app setting by key (public, no auth)
 *     tags: [Settings]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *           enum: [login_message, login_subtitle, notification_reminder_days, notification_late_days, qr_code_enabled, image_logo_padding_top, image_logo_padding_right, image_logo_padding_bottom, image_logo_padding_left, about_message]
 *         description: The setting key to retrieve
 *     responses:
 *       200:
 *         description: Setting value
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AppSetting'
 *       404:
 *         description: Setting not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:key', async (req: Request, res: Response) => {
  const { key } = req.params
  if (!ALLOWED_KEYS.has(key)) {
    res.status(404).json({ error: 'Setting not found' })
    return
  }

  // LOGIN_MODE env var overrides the database value when set to a valid mode
  if (key === 'login_mode') {
    const envOverride = process.env.LOGIN_MODE?.trim().toLowerCase()
    if (envOverride === 'maintenance' || envOverride === 'select' || envOverride === 'password') {
      res.json({ key: 'login_mode', value: envOverride })
      return
    }
  }

  const db = await getDbAsync()
  const row = await db.queryOne<DbSetting>('SELECT key, value FROM app_settings WHERE key = ?', [key])

  if (!row) {
    // Return sensible defaults for keys that haven't been persisted yet
    const defaults: Record<string, string> = { login_mode: 'select' }
    const defaultValue = defaults[key]
    if (defaultValue !== undefined) {
      res.json({ key, value: defaultValue })
      return
    }
    res.status(404).json({ error: 'Setting not found' })
    return
  }

  res.json({ key: row.key, value: row.value })
})

/**
 * @swagger
 * /api/settings/{key}:
 *   put:
 *     summary: Update an app setting (admin only)
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *           enum: [login_message, login_subtitle, notification_reminder_days, notification_late_days, qr_code_enabled, image_logo_padding_top, image_logo_padding_right, image_logo_padding_bottom, image_logo_padding_left, about_message]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [value]
 *             properties:
 *               value:
 *                 type: string
 *                 example: Welcome to Data Collection Pro.
 *     responses:
 *       200:
 *         description: Updated setting
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AppSetting'
 *       400:
 *         description: Value is required
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Administrator access required
 *       404:
 *         description: Setting key not found
 */
router.put('/:key', authenticateToken, async (req: Request, res: Response) => {
  if (req.user?.role !== 'administrator' && req.user?.role !== 'super_admin') {
    res.status(403).json({ error: 'Administrator access required' })
    return
  }

  const { key } = req.params
  if (!ALLOWED_KEYS.has(key)) {
    res.status(404).json({ error: 'Setting not found' })
    return
  }

  const value = ((req.body as { value?: unknown }).value ?? '').toString()
  if (!value.trim() && key !== 'maintenance_message') {
    res.status(400).json({ error: 'value is required' })
    return
  }

  if (key === 'database_mode') {
    const normalized = value.toLowerCase()
    if (normalized !== 'turso' && normalized !== 'sqlserver') {
      res.status(400).json({ error: 'database_mode must be one of: turso, sqlserver' })
      return
    }
    setConfiguredDatabaseMode(normalized as 'turso' | 'sqlserver')
  }

  if (key === 'document_storage_mode') {
    const normalized = value.toLowerCase()
    if (normalized !== 'turso_db' && normalized !== 'sql_server' && normalized !== 'google_drive') {
      res.status(400).json({ error: 'document_storage_mode must be one of: turso_db, sql_server, google_drive' })
      return
    }
  }

  const db = await getDbAsync()
  await db.execute(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  )

  res.json({ key, value })
})

/**
 * GET /api/settings/document-storage/status
 *
 * Returns the current document storage mode, availability of each backend,
 * and per-organization file counts.
 *
 * Query parameters:
 *   organizationId (optional) — scope file counts to a specific organization
 */
router.get('/document-storage/status', authenticateToken, async (req: Request, res: Response) => {
  if (req.user?.role !== 'administrator' && req.user?.role !== 'super_admin') {
    res.status(403).json({ error: 'Administrator access required' })
    return
  }

  const organizationId = req.query.organizationId
    ? Number.parseInt(String(req.query.organizationId), 10)
    : undefined

  const currentMode = await getDocumentStorageMode()

  const backends: Record<DocumentStorageMode, { available: boolean }> = {
    google_drive: { available: isStorageBackendAvailable('google_drive') },
    turso_db: { available: isStorageBackendAvailable('turso_db') },
    sql_server: { available: isStorageBackendAvailable('sql_server') },
  }

  const fileCounts = await getFileCounts(organizationId)

  res.json({
    currentMode,
    backends,
    fileCounts,
  })
})

export default router
