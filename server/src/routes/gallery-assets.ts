import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import { randomUUID } from 'crypto'
import { getDbAsync } from '../database/db'
import { authenticateToken } from '../middleware/auth'
import { isAdminOrSuperAdmin, loadRequestUserContext, resolveManagedOrganizationId } from '../middleware/organizationAccess'
import { deleteDriveFile, downloadDriveFile, isGoogleDriveConfigured, uploadBufferToDrive } from '../services/googleDrive'
import { getConfiguredDatabaseMode } from '../database/db'

function resolveStorageLocation(driveFileId: string): 'google_drive' | 'turso_db' | 'sql_server' {
  if (!driveFileId.startsWith('local:')) return 'google_drive'
  const mode = getConfiguredDatabaseMode()
  return mode === 'sqlserver' ? 'sql_server' : 'turso_db'
}

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
})

interface DbGalleryAssetRow {
  id: number
  organization_id: number
  organization_name: string | null
  name: string
  alt_text: string | null
  tags: string | null
  mime_type: string
  size_bytes: number
  drive_file_id: string
  file_data: string | null
  created_by_user_id: number | null
  created_at: string
  updated_at: string
  usage_count?: number
}

function parseTags(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.map(value => String(value).trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function serialiseTags(raw: string | undefined): string | null {
  if (!raw) return null
  const tags = raw
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean)
  return tags.length > 0 ? JSON.stringify(tags) : null
}

function toApiGalleryAsset(row: DbGalleryAssetRow) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    name: row.name,
    altText: row.alt_text,
    tags: parseTags(row.tags),
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    usageCount: row.usage_count ?? 0,
    fileUrl: `/api/gallery-assets/${row.id}/file`,
    storageLocation: resolveStorageLocation(row.drive_file_id),
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

router.get('/', authenticateToken, async (req: Request, res: Response) => {
  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  if (!isAdminOrSuperAdmin(context)) {
    res.status(403).json({ error: 'Administrator access is required' })
    return
  }

  const requestedOrganizationId = req.query.organizationId == null
    ? null
    : Number.parseInt(String(req.query.organizationId), 10)
  const organizationId = resolveManagedOrganizationId(
    context,
    Number.isInteger(requestedOrganizationId) ? requestedOrganizationId : null,
  )

  const db = await getDbAsync()
  const rows = organizationId
    ? await db.queryAll<DbGalleryAssetRow>(`
        SELECT
          ga.*,
          o.name AS organization_name,
          (SELECT COUNT(*) FROM collections c WHERE c.cover_photo_asset_id = ga.id) AS usage_count
        FROM gallery_assets ga
        JOIN organizations o ON o.id = ga.organization_id
        WHERE ga.organization_id = ?
        ORDER BY ga.created_at DESC, ga.id DESC
      `, [organizationId])
    : await db.queryAll<DbGalleryAssetRow>(`
        SELECT
          ga.*,
          o.name AS organization_name,
          (SELECT COUNT(*) FROM collections c WHERE c.cover_photo_asset_id = ga.id) AS usage_count
        FROM gallery_assets ga
        JOIN organizations o ON o.id = ga.organization_id
        ORDER BY ga.created_at DESC, ga.id DESC
      `)

  res.json(rows.map(toApiGalleryAsset))
})

router.post('/', authenticateToken, upload.single('file'), async (req: Request, res: Response) => {
  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  if (!isAdminOrSuperAdmin(context)) {
    res.status(403).json({ error: 'Administrator access is required' })
    return
  }

  const requestedOrganizationId = req.body.organizationId == null
    ? null
    : Number.parseInt(String(req.body.organizationId), 10)
  const organizationId = resolveManagedOrganizationId(
    context,
    Number.isInteger(requestedOrganizationId) ? requestedOrganizationId : null,
  )

  if (!organizationId) {
    res.status(400).json({ error: 'An organization must be selected' })
    return
  }

  if (!req.file) {
    res.status(400).json({ error: 'An image file is required' })
    return
  }

  if (!req.file.mimetype.startsWith('image/')) {
    res.status(400).json({ error: 'Only image uploads are supported' })
    return
  }

  const name = String(req.body.name ?? req.file.originalname).trim()
  if (!name) {
    res.status(400).json({ error: 'Image name is required' })
    return
  }

  const db = await getDbAsync()

  if (!isGoogleDriveConfigured()) {
    // ── Local DB storage fallback ──────────────────────────────────────────
    const localId = `local:${randomUUID()}`
    const fileDataBase64 = req.file.buffer.toString('base64')

    const result = await db.execute(`
      INSERT INTO gallery_assets (
        organization_id,
        name,
        alt_text,
        tags,
        mime_type,
        size_bytes,
        drive_file_id,
        file_data,
        created_by_user_id,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `, [
      organizationId,
      name,
      String(req.body.altText ?? '').trim() || null,
      serialiseTags(typeof req.body.tags === 'string' ? req.body.tags : undefined),
      req.file.mimetype,
      req.file.buffer.byteLength,
      localId,
      fileDataBase64,
      context.id,
    ])

    const row = await db.queryOne<DbGalleryAssetRow>(`
      SELECT ga.*, o.name AS organization_name, 0 AS usage_count
      FROM gallery_assets ga
      JOIN organizations o ON o.id = ga.organization_id
      WHERE ga.id = ?
    `, [Number(result.lastInsertRowid)])

    if (!row) {
      res.status(500).json({ error: 'Failed to load uploaded gallery asset' })
      return
    }

    res.status(201).json(toApiGalleryAsset(row))
    return
  }

  try {
    const uploaded = await uploadBufferToDrive({
      fileName: req.file.originalname,
      mimeType: req.file.mimetype || 'application/octet-stream',
      buffer: req.file.buffer,
    })

    const result = await db.execute(`
      INSERT INTO gallery_assets (
        organization_id,
        name,
        alt_text,
        tags,
        mime_type,
        size_bytes,
        drive_file_id,
        drive_web_view_url,
        drive_download_url,
        created_by_user_id,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `, [
      organizationId,
      name,
      String(req.body.altText ?? '').trim() || null,
      serialiseTags(typeof req.body.tags === 'string' ? req.body.tags : undefined),
      uploaded.mimeType,
      uploaded.sizeBytes,
      uploaded.id,
      uploaded.webViewUrl,
      uploaded.webContentUrl,
      context.id,
    ])

    const row = await db.queryOne<DbGalleryAssetRow>(`
      SELECT ga.*, o.name AS organization_name, 0 AS usage_count
      FROM gallery_assets ga
      JOIN organizations o ON o.id = ga.organization_id
      WHERE ga.id = ?
    `, [Number(result.lastInsertRowid)])

    if (!row) {
      res.status(500).json({ error: 'Failed to load uploaded gallery asset' })
      return
    }

    res.status(201).json(toApiGalleryAsset(row))
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'Failed to upload gallery image' })
  }
})

router.get('/:id/file', authenticateToken, async (req: Request, res: Response) => {
  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  if (!isAdminOrSuperAdmin(context)) {
    res.status(403).json({ error: 'Administrator access is required' })
    return
  }

  const id = Number.parseInt(req.params.id, 10)
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: 'Invalid gallery asset ID' })
    return
  }

  const db = await getDbAsync()
  const row = await db.queryOne<{ id: number; organization_id: number; drive_file_id: string; file_data: string | null; mime_type: string; name: string }>(`
    SELECT id, organization_id, drive_file_id, file_data, mime_type, name
    FROM gallery_assets
    WHERE id = ?
  `, [id])

  if (!row || (context.role !== 'super_admin' && row.organization_id !== context.organizationId)) {
    res.status(404).json({ error: 'Gallery asset not found' })
    return
  }

  // Local DB storage — serve directly from base64 field
  if (row.drive_file_id.startsWith('local:')) {
    if (!row.file_data) {
      res.status(404).json({ error: 'Gallery asset file data not found' })
      return
    }
    const buffer = Buffer.from(row.file_data, 'base64')
    res.setHeader('Content-Type', row.mime_type)
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.send(buffer)
    return
  }

  try {
    const file = await downloadDriveFile(row.drive_file_id)
    res.setHeader('Content-Type', file.mimeType)
    res.setHeader('Cache-Control', 'private, max-age=300')
    file.stream.pipe(res)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'Failed to load gallery image' })
  }
})

router.delete('/:id', authenticateToken, async (req: Request, res: Response) => {
  const context = await loadRequestUserContext(req)
  if (!context) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  if (!isAdminOrSuperAdmin(context)) {
    res.status(403).json({ error: 'Administrator access is required' })
    return
  }

  const id = Number.parseInt(req.params.id, 10)
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: 'Invalid gallery asset ID' })
    return
  }

  const db = await getDbAsync()
  const asset = await db.queryOne<{ id: number; organization_id: number; drive_file_id: string }>(`
    SELECT id, organization_id, drive_file_id
    FROM gallery_assets
    WHERE id = ?
  `, [id])

  if (!asset || (context.role !== 'super_admin' && asset.organization_id !== context.organizationId)) {
    res.status(404).json({ error: 'Gallery asset not found' })
    return
  }

  const usage = await db.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM collections WHERE cover_photo_asset_id = ?', [id])
  if ((usage?.count ?? 0) > 0) {
    res.status(409).json({ error: `This image is currently used by ${usage?.count ?? 0} collection${(usage?.count ?? 0) === 1 ? '' : 's'}` })
    return
  }

  await db.execute('DELETE FROM gallery_assets WHERE id = ?', [id])

  // Only attempt Drive deletion for non-local assets
  if (!asset.drive_file_id.startsWith('local:')) {
    try {
      await deleteDriveFile(asset.drive_file_id)
    } catch {
      // Ignore missing external files after DB delete.
    }
  }

  res.status(204).send()
})

export default router