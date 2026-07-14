import { Readable } from 'stream'
import { google } from 'googleapis'

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

function createOAuthClient() {
  const clientId = getRequiredEnv('GOOGLE_DRIVE_CLIENT_ID')
  const clientSecret = getRequiredEnv('GOOGLE_DRIVE_CLIENT_SECRET')
  const refreshToken = getRequiredEnv('GOOGLE_DRIVE_REFRESH_TOKEN')

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret)
  oauth2Client.setCredentials({ refresh_token: refreshToken })
  return oauth2Client
}

function createDriveClient() {
  return google.drive({ version: 'v3', auth: createOAuthClient() })
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
  const drive = createDriveClient()
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
  const drive = createDriveClient()
  await drive.files.delete({
    fileId,
    supportsAllDrives: true,
  })
}

export async function downloadDriveFile(fileId: string): Promise<{ stream: NodeJS.ReadableStream; mimeType: string; fileName: string }> {
  const drive = createDriveClient()
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