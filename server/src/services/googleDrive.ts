import { Readable } from 'stream'
import { google } from 'googleapis'
import { getDbAsync } from '../database/db'

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

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required Google Drive configuration: ${name}`)
  }
  return value
}

/** Read the refresh token — DB value takes priority over env var. */
async function getRefreshToken(): Promise<string> {
  try {
    const db = await getDbAsync()
    const row = await db.queryOne<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = 'google_drive_refresh_token'`
    )
    if (row?.value?.trim()) return row.value.trim()
  } catch {
    // DB unavailable — fall through to env var
  }
  return getRequiredEnv('GOOGLE_DRIVE_REFRESH_TOKEN')
}

/** Persist a new refresh token issued by Google back to app_settings. */
async function persistRefreshToken(token: string): Promise<void> {
  try {
    const db = await getDbAsync()
    await db.execute(
      `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ['google_drive_refresh_token', token]
    )
    console.log('[googleDrive] Refresh token rotated and saved to app_settings.')
  } catch (err) {
    console.warn('[googleDrive] Could not persist new refresh token:', (err as Error).message)
  }
}

async function createOAuthClient() {
  const clientId = getRequiredEnv('GOOGLE_DRIVE_CLIENT_ID')
  const clientSecret = getRequiredEnv('GOOGLE_DRIVE_CLIENT_SECRET')
  const refreshToken = await getRefreshToken()

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret)
  oauth2Client.setCredentials({ refresh_token: refreshToken })

  // When Google issues a new refresh token, save it to the DB automatically
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
      void persistRefreshToken(tokens.refresh_token)
    }
  })

  return oauth2Client
}

async function createDriveClient() {
  return google.drive({ version: 'v3', auth: await createOAuthClient() })
}

function getDriveParentIds(): string[] {
  return [getRequiredEnv('GOOGLE_DRIVE_FOLDER_ID')]
}

export function isGoogleDriveConfigured(): boolean {
  return [
    process.env.GOOGLE_DRIVE_CLIENT_ID,
    process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
    process.env.GOOGLE_DRIVE_FOLDER_ID,
  ].every((value) => !!value?.trim())
}

export async function uploadBufferToDrive(input: DriveUploadInput): Promise<DriveFileMetadata> {
  const drive = await createDriveClient()
  const response = await drive.files.create({
    requestBody: {
      name: input.fileName,
      parents: getDriveParentIds(),
    },
    media: {
      mimeType: input.mimeType,
      body: Readable.from(input.buffer),
    },
    fields: 'id,name,mimeType,size,webViewLink,webContentLink',
    supportsAllDrives: true,
  })

  if (!response.data.id || !response.data.name || !response.data.mimeType) {
    throw new Error('Google Drive upload did not return complete file metadata')
  }

  return {
    id: response.data.id,
    name: response.data.name,
    mimeType: response.data.mimeType,
    sizeBytes: Number(response.data.size ?? input.buffer.byteLength),
    webViewUrl: response.data.webViewLink ?? null,
    webContentUrl: response.data.webContentLink ?? null,
  }
}

export async function deleteDriveFile(fileId: string): Promise<void> {
  const drive = await createDriveClient()
  await drive.files.delete({
    fileId,
    supportsAllDrives: true,
  })
}

export async function downloadDriveFile(fileId: string): Promise<{ stream: NodeJS.ReadableStream; mimeType: string; fileName: string }> {
  const drive = await createDriveClient()
  const [metadataResponse, contentResponse] = await Promise.all([
    drive.files.get({
      fileId,
      fields: 'name,mimeType',
      supportsAllDrives: true,
    }),
    drive.files.get(
      {
        fileId,
        alt: 'media',
        supportsAllDrives: true,
      },
      { responseType: 'stream' },
    ),
  ])

  if (!metadataResponse.data.name || !metadataResponse.data.mimeType) {
    throw new Error('Google Drive download metadata is incomplete')
  }

  return {
    stream: contentResponse.data,
    mimeType: metadataResponse.data.mimeType,
    fileName: metadataResponse.data.name,
  }
}