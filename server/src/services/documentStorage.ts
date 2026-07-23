import { randomUUID } from 'crypto'
import { isGoogleDriveConfigured, uploadBufferToDrive, downloadDriveFile, deleteDriveFile } from './googleDrive'
import { getDbAsync, getConfiguredDatabaseMode, isPlaceholderValue } from '../database/db'

export type DocumentStorageMode = 'google_drive' | 'turso_db' | 'sql_server'

interface DriveUploadInput {
  fileName: string
  mimeType: string
  buffer: Buffer
}

interface DriveFileMetadata {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  webViewUrl: string | null
  webContentUrl: string | null
}

export interface UploadResult {
  driveFileId: string
  fileDataBase64: string | null
  webViewUrl: string | null
  webContentUrl: string | null
}

export interface DownloadResult {
  buffer: Buffer
  mimeType: string
  fileName: string
}

/**
 * Read the current document storage mode from app_settings.
 * Falls back to backward-compatible detection when not set.
 */
export async function getDocumentStorageMode(): Promise<DocumentStorageMode> {
  try {
    const db = await getDbAsync()
    const row = await db.queryOne<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = 'document_storage_mode'`
    )
    if (row) {
      const normalized = row.value.trim().toLowerCase() as DocumentStorageMode
      if (normalized === 'google_drive' || normalized === 'turso_db' || normalized === 'sql_server') {
        return normalized
      }
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback: backward-compatible detection
  if (isGoogleDriveConfigured()) {
    return 'google_drive'
  }
  const dbMode = getConfiguredDatabaseMode()
  if (dbMode === 'sqlserver') {
    return 'sql_server'
  }
  return 'turso_db'
}

/**
 * Check whether a storage backend is available based on environment variables.
 */
export function isStorageBackendAvailable(mode: DocumentStorageMode): boolean {
  switch (mode) {
    case 'google_drive':
      return isGoogleDriveConfigured()
    case 'turso_db':
      return looksLikeValidTursoConnection(
        process.env.TURSO_DATABASE_URL ?? process.env.DATABASE_URL,
        process.env.TURSO_AUTH_TOKEN ?? process.env.DATABASE_AUTH_TOKEN,
      )
    case 'sql_server':
      return looksLikeValidSqlServerConnection(
        process.env.AZURE_SQL_SERVER,
        process.env.AZURE_SQL_DATABASE,
        process.env.AZURE_SQL_USER,
        process.env.AZURE_SQL_PASSWORD,
      )
    default:
      return false
  }
}

function looksLikeValidTursoConnection(url: string | undefined, authToken: string | undefined): boolean {
  if (!url || !authToken) return false
  if (isPlaceholderValue(url) || isPlaceholderValue(authToken)) return false
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

function looksLikeValidSqlServerConnection(
  server: string | undefined,
  database: string | undefined,
  user: string | undefined,
  password: string | undefined,
): boolean {
  if (!server || !database || !user || !password) return false
  if (isPlaceholderValue(server) || isPlaceholderValue(database)) return false
  return true
}

/**
 * Upload a document to the currently configured storage backend.
 */
export async function uploadDocument(input: DriveUploadInput): Promise<UploadResult> {
  const mode = await getDocumentStorageMode()

  if (mode === 'google_drive') {
    try {
      const result = await uploadBufferToDrive({
        fileName: input.fileName,
        mimeType: input.mimeType,
        buffer: input.buffer,
      })
      return {
        driveFileId: result.id,
        fileDataBase64: null,
        webViewUrl: result.webViewUrl,
        webContentUrl: result.webContentUrl,
      }
    } catch (err) {
      // If Google Drive upload fails, fall back to local storage
      console.warn('[document-storage] Google Drive upload failed, falling back to local storage:', (err as Error).message)
      return storeLocally(input)
    }
  }

  // turso_db or sql_server — store as base64 in the DB
  return storeLocally(input)
}

function storeLocally(input: DriveUploadInput): UploadResult {
  const localId = `local:${randomUUID()}`
  return {
    driveFileId: localId,
    fileDataBase64: input.buffer.toString('base64'),
    webViewUrl: null,
    webContentUrl: null,
  }
}

/**
 * Download a document. Handles both Google Drive and local base64 storage.
 *
 * @param driveFileId - The file ID stored in the database
 * @param fileData - The base64-encoded file data (for locally stored files)
 */
export async function downloadDocument(driveFileId: string, fileData: string | null): Promise<DownloadResult> {
  if (driveFileId.startsWith('local:')) {
    if (!fileData) {
      throw new Error('Local file data not found')
    }
    return {
      buffer: Buffer.from(fileData, 'base64'),
      mimeType: 'application/octet-stream',
      fileName: 'file',
    }
  }

  const file = await downloadDriveFile(driveFileId)
  const chunks: Buffer[] = []
  for await (const chunk of file.stream) {
    chunks.push(Buffer.from(chunk))
  }
  return {
    buffer: Buffer.concat(chunks),
    mimeType: file.mimeType,
    fileName: file.fileName,
  }
}

/**
 * Delete a document from the appropriate storage backend.
 *
 * @param driveFileId - The file ID stored in the database
 */
export async function deleteDocument(driveFileId: string): Promise<void> {
  if (driveFileId.startsWith('local:')) {
    // Data is in the DB row — deletion via row deletion handles this
    return
  }

  try {
    await deleteDriveFile(driveFileId)
  } catch {
    // Ignore missing external files after DB delete
  }
}

/**
 * Get file counts by organization (or across all organizations).
 */
export async function getFileCounts(organizationId?: number): Promise<{
  galleryAssets: number
  responseAttachments: number
  total: number
}> {
  const db = await getDbAsync()

  const galleryParams: unknown[] = []
  const attachmentParams: unknown[] = []

  let galleryWhere = ''
  let attachmentWhere = "WHERE status != 'deleted'"

  if (organizationId !== undefined) {
    galleryWhere = 'WHERE organization_id = ?'
    galleryParams.push(organizationId)
    attachmentWhere = 'WHERE organization_id = ? AND status != \'deleted\''
    attachmentParams.push(organizationId)
  }

  const [galleryRow, attachmentRow] = await Promise.all([
    db.queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM gallery_assets ${galleryWhere}`,
      galleryParams.length > 0 ? galleryParams : undefined,
    ),
    db.queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM response_attachments ${attachmentWhere}`,
      attachmentParams.length > 0 ? attachmentParams : undefined,
    ),
  ])

  const galleryAssets = Number(galleryRow?.count ?? 0)
  const responseAttachments = Number(attachmentRow?.count ?? 0)

  return {
    galleryAssets,
    responseAttachments,
    total: galleryAssets + responseAttachments,
  }
}