# Plan: Document Storage — Admin Toggle for Blob/Image Storage Backend

**Date:** 2026-07-23  
**Status:** Draft — awaiting review before implementation  
**Primary files:** `server/src/routes/settings.ts`, `client/src/pages/SettingsPage.tsx`, `server/src/services/documentStorage.ts` (new), `server/src/services/googleDrive.ts`, `server/src/routes/gallery-assets.ts`, `server/src/routes/collections.ts`

---

## Executive Summary

Today, document and image storage implicitly follows a two-tier logic: if Google Drive environment variables are present, files go to Google Drive; otherwise they fall back to base64 storage in whichever database is active (Turso or SQL Server). The database mode and the document storage location are tied together in the `/api/info` endpoint and the `resolveStorageLocation()` helper, with no way for an administrator to independently choose where documents are stored.

This plan introduces a **new "Document Storage" panel** in Settings that lets administrators explicitly choose one of three storage backends:

1. **Google Drive** — files uploaded to Google Drive via the existing `googleDrive.ts` service
2. **Turso DB** — files stored as base64 in the `file_data` column of the current database (Turso)
3. **SQL Server** — files stored as base64 in the `file_data` column of the current database (SQL Server)

The selection is persisted in `app_settings` under the key `document_storage_mode`. Each option displays an availability status based on whether the required environment variables are present and valid ("available" / "offline"). The selected mode applies to **all future uploads only** — previously saved items retain their current storage location and continue to be served correctly.

---

## Scope

### In scope

1. New `document_storage_mode` app setting (`turso_db` | `sql_server` | `google_drive`)
2. New `DocumentStorageService` abstraction that routes uploads/downloads/deletes to the chosen backend
3. New "Document Storage" panel in `SettingsPage.tsx` with three radio-card-style options
4. Availability detection for each backend based on environment variables
5. Existing files (both Google Drive and local/base64) continue to serve correctly regardless of the selected mode
6. Backward compatibility: if no `document_storage_mode` is set, the system falls back to the current behavior (Google Drive if configured, else base64 in active DB)

### Out of scope

- Migrating previously stored files from one backend to another
- Changing the database mode (that remains a separate setting)
- Support for additional storage backends (S3, Azure Blob, etc.)
- Per-organization storage settings (this is a global/application-level setting)

---

## Step-by-Step Implementation Guide

### Phase 1: Server — Document Storage Service Abstraction

**Step 1.1: Create `server/src/services/documentStorage.ts`**

This new service provides a unified interface for storing, retrieving, and deleting blob files. It reads the `document_storage_mode` app setting and delegates to the appropriate backend.

```typescript
// Conceptual interface:
export type DocumentStorageMode = 'google_drive' | 'turso_db' | 'sql_server'

export function getDocumentStorageMode(): Promise<DocumentStorageMode>
export function isStorageBackendAvailable(mode: DocumentStorageMode): boolean
export function uploadDocument(input: { fileName: string; mimeType: string; buffer: Buffer }): Promise<{ driveFileId: string; fileDataBase64: string | null; webViewUrl: string | null; webContentUrl: string | null }>
export function downloadDocument(driveFileId: string, fileData: string | null): Promise<{ buffer: Buffer; mimeType: string; fileName: string }>
export function deleteDocument(driveFileId: string): Promise<void>
```

**Availability detection logic:**
- `google_drive`: available if `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN`, `GOOGLE_DRIVE_FOLDER_ID` are all present and non-placeholder values
- `turso_db`: available if Turso connection is valid (`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` present, or currently connected to Turso)
- `sql_server`: available if `AZURE_SQL_SERVER`, `AZURE_SQL_DATABASE`, `AZURE_SQL_USER`, `AZURE_SQL_PASSWORD` are all present and non-placeholder values

**Fallback resolution** (when no `document_storage_mode` is set):
1. If Google Drive is configured → use `google_drive`
2. If SQL Server is the active database → use `sql_server`
3. Otherwise → use `turso_db`

**Upload logic per mode:**
- `google_drive`: call `uploadBufferToDrive()`, return `driveFileId` (Google ID), `fileDataBase64: null`
- `turso_db` or `sql_server`: generate `local:{uuid}` as `driveFileId`, store `fileDataBase64` from buffer, return both

**Download logic per mode:**
- If `driveFileId` starts with `local:` → decode `fileData` base64 back to buffer
- Otherwise → call `downloadDriveFile()`

**Delete logic per mode:**
- If `driveFileId` starts with `local:` → no-op (data is in DB row, deleted by row deletion)
- Otherwise → call `deleteDriveFile()`

---

### Phase 2: Server — Add `document_storage_mode` to Allowed Settings

**Step 2.1: Update `server/src/routes/settings.ts`**

Add `'document_storage_mode'` to the `ALLOWED_KEYS` set.

Add validation in the `PUT /:key` handler:
```typescript
if (key === 'document_storage_mode') {
  const normalized = value.toLowerCase()
  if (normalized !== 'turso_db' && normalized !== 'sql_server' && normalized !== 'google_drive') {
    res.status(400).json({ error: 'document_storage_mode must be one of: turso_db, sql_server, google_drive' })
    return
  }
}
```

---

### Phase 3: Server — Document Storage Status Endpoint (with Per-Organization File Counts)

**Step 3.1: Add a new route or extend `/api/info`**

Add a new endpoint (or extend the existing `/api/info`) to return the document storage status, including per-organization file counts. The endpoint accepts an optional `?organizationId=` query parameter to scope counts to a specific organization.

```json
// GET /api/info  (or GET /api/settings/document-storage/status?organizationId=5)
{
  "documentStorage": {
    "currentMode": "google_drive",
    "backends": {
      "google_drive": { "available": true },
      "turso_db": { "available": true },
      "sql_server": { "available": false }
    },
    "fileCounts": {
      "galleryAssets": 8,
      "responseAttachments": 12,
      "total": 20
    }
  }
}
```

**File count queries** (scoped by `organization_id` when the query parameter is provided):

```sql
-- Gallery assets for the org (Google Drive files only, since base64 local files count toward DB)
SELECT COUNT(*) FROM gallery_assets
WHERE organization_id = ?
  AND drive_file_id NOT LIKE 'local:%'

-- Response attachments for the org (Google Drive files, excluding soft-deleted)
SELECT COUNT(*) FROM response_attachments
WHERE organization_id = ?
  AND drive_file_id NOT LIKE 'local:%'
  AND status != 'deleted'
```

When `organizationId` is omitted (super admin view), the query runs without the `WHERE organization_id = ?` clause, returning totals across all organizations.

**Availability detection** (no DB query needed — based purely on environment variables):
- `google_drive`: available if all four `GOOGLE_DRIVE_*` env vars are present and non-placeholder
- `turso_db`: available if `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` are present and non-placeholder
- `sql_server`: available if all four `AZURE_SQL_*` env vars are present and non-placeholder

**Implementation option A:** Add a dedicated route in `settings.ts`:
```typescript
router.get('/document-storage/status', authenticateToken, async (req, res) => {
  const organizationId = req.query.organizationId
    ? Number.parseInt(String(req.query.organizationId), 10)
    : undefined
  // ... query file counts scoped to organizationId, check env vars for availability
})
```

**Implementation option B:** Extend the existing `/api/info` endpoint in `index.ts` or `health.ts`. This is preferred since the Settings page already calls `/api/info` for `dbMode` and `googleDriveConfigured`.

---

### Phase 4: Server — File Count Service

**Step 4.1: Add `getFileCounts()` helper in `documentStorage.ts`**

```typescript
export async function getFileCounts(organizationId?: number): Promise<{
  galleryAssets: number
  responseAttachments: number
  total: number
}>
```

This function queries the `gallery_assets` and `response_attachments` tables, scoped to the given `organizationId` when provided. It counts all files regardless of storage backend (Google Drive or local DB), since the count represents "files managed by this application" which is what the administrator cares about.

For Google Drive specifically, an additional optional breakdown could distinguish "files in Google Drive" (non-`local:` prefix) vs "files in local DB" (`local:` prefix), but per the user's request, the primary display is total file count by organization.

---

### Phase 5: Refactor Existing Upload/Download Code to Use the New Service

**Step 5.1: Update `server/src/routes/gallery-assets.ts`**

Replace direct calls to `uploadBufferToDrive()` / `downloadDriveFile()` / `deleteDriveFile()` with calls to the new `documentStorage` service.

Changes:
- In `POST /`: Replace `!isGoogleDriveConfigured()` branch + the Google Drive upload block with a single call to `uploadDocument()`
- In `GET /:id/file`: Use `downloadDocument()` instead of the current `local:` prefix check + `downloadDriveFile()`
- In `DELETE /:id`: Use `deleteDocument()` instead of the current `local:` prefix check + `deleteDriveFile()`
- Remove the `resolveStorageLocation()` function (it was used for UI display only; we'll derive this from the new mode)
- Update `toApiGalleryAsset()` to use the new storage mode for the `storageLocation` field

**Step 5.2: Update `server/src/routes/collections.ts`**

Replace direct calls to `uploadBufferToDrive()` / `downloadDriveFile()` / `deleteDriveFile()` for attachment uploads/downloads/deletes with the new `documentStorage` service.

Changes in attachment-related routes (the `multer`-based upload endpoints, download endpoints, and response deletion logic).

---

### Phase 6: Client — New "Document Storage" Panel in Settings

**Step 6.1: Add `'document-storage'` to the `PanelId` type and layout**

In `client/src/pages/SettingsPage.tsx`:
- Add `'document-storage'` to the `PanelId` union type
- Add a label: `'document-storage': 'Document Storage'` in `PANEL_LABELS`
- Add it to the `other` tab in `DEFAULT_PANEL_LAYOUT` (alongside `'database-mode'`)
- Re-export with all existing panel IDs

**Step 6.2: Implement the `'document-storage'` case in `renderPanel()`**

Create a new panel section with:

1. **Header**: Database icon, title "Document Storage", description text: "Choose where uploaded documents, images, and attachments are stored. Changing this setting only affects new uploads — existing files remain in their current location."

2. **Three radio-card options**, each showing:
   - Icon (cloud for Google Drive, database for Turso, server for SQL Server)
   - Title: "Google Drive", "Turso DB", "SQL Server"
   - Description of where files go
   - **Status badge**: 
     - Green "Available" badge if the backend's env vars are configured
     - Gray/red "Offline" badge if not available
   - Radio selection indicator (currently selected mode highlighted with blue border)

3. **Current storage location summary** (optional but nice): "Current storage: 📁 Google Drive" or similar

**Step 6.3: API integration**

- On panel expand → call `GET /api/info` (or new endpoint) to get `documentStorage` status
- On mode selection → call `PUT /api/settings/document_storage_mode` with the selected value
- Show saving/saved/error states like other settings panels

**Step 6.4: State management**

Add state variables similar to the `database-mode` panel:
```typescript
const [documentStorageMode, setDocumentStorageMode] = useState<'google_drive' | 'turso_db' | 'sql_server'>('google_drive')
const [documentStorageStatus, setDocumentStorageStatus] = useState<Record<string, boolean>>({})
const [documentStorageSaving, setDocumentStorageSaving] = useState(false)
const [documentStorageError, setDocumentStorageError] = useState<string | null>(null)
const [documentStorageSaved, setDocumentStorageSaved] = useState(false)
```

---

### Phase 7: Seed Data & Defaults

**Step 7.1: Update `server/src/database/schema.ts` seed data**

No seed value for `document_storage_mode` is needed. The absence of the setting triggers the backward-compatible fallback logic in `documentStorage.ts`, which preserves existing behavior for deployments that haven't yet configured this setting.

**Step 7.2: Update the gallery storage label logic**

Currently `galleryStorageLabel` is set based on `/api/info` (`googleDriveConfigured` and `dbMode`). Update this to use the new document storage status endpoint instead, so the gallery panel reflects the actual storage mode.

---

### Phase 8: Remove Deprecated Imports & Cleanup

**Step 8.1: Clean up direct Google Drive imports**

After refactoring `gallery-assets.ts` and `collections.ts` to use `documentStorage.ts`:
- Remove direct imports of `uploadBufferToDrive`, `deleteDriveFile`, `downloadDriveFile`, `isGoogleDriveConfigured` from `gallery-assets.ts` and `collections.ts`
- These functions remain exported from `googleDrive.ts` for use by `documentStorage.ts`

**Step 8.2: Remove `resolveStorageLocation()`**

This function in `gallery-assets.ts` is no longer needed since `documentStorage.ts` will handle the resolution.

---

## Impacted Files

### New files
| File | Purpose |
|------|---------|
| `server/src/services/documentStorage.ts` | Unified document storage service — routes uploads/downloads/deletes to the configured backend |

### Modified files (server)
| File | Changes |
|------|---------|
| `server/src/routes/settings.ts` | Add `document_storage_mode` to `ALLOWED_KEYS`; add validation; add status endpoint |
| `server/src/routes/gallery-assets.ts` | Replace direct Google Drive calls with `documentStorage` service; remove `resolveStorageLocation()` |
| `server/src/routes/collections.ts` | Replace direct Google Drive calls for attachment uploads/downloads/deletes |
| `server/src/index.ts` | Add `/api/info` extension for `documentStorage` status (or wire new route) |
| `server/src/database/schema.ts` | No schema changes needed (uses existing `app_settings` table) |

### Modified files (client)
| File | Changes |
|------|---------|
| `client/src/pages/SettingsPage.tsx` | Add `'document-storage'` to `PanelId`, `PANEL_LABELS`, `DEFAULT_PANEL_LAYOUT`; implement new panel case; update gallery storage label logic |

---

## Rollback / Verification Plan

### Verification

1. **Unit/Manual Tests:**
   - Verify the Settings page shows all three storage options
   - Verify each option shows "Available" or "Offline" based on `.env`
   - Select each mode and confirm the setting is persisted (refresh page, check DB)
   - Upload a gallery image with Google Drive mode → verify it appears in Google Drive
   - Upload a gallery image with Turso DB mode → verify it's stored as base64 in the DB
   - Upload a gallery image with SQL Server mode → verify it's stored as base64 in SQL Server
   - Download a previously uploaded Google Drive file when mode is switched to Turso DB → verify it still downloads correctly
   - Download a previously uploaded base64 file when mode is switched to Google Drive → verify it still downloads correctly
   - Upload an attachment via a collection response → verify it goes to the selected storage
   - Delete a gallery asset → verify the file is removed from the correct storage backend

2. **Regression Tests:**
   - All existing collection response attachments continue to work
   - All existing gallery assets continue to display
   - Database mode toggle (separate panel) still works independently
   - Login, categories, users, and other settings panels are unaffected

### Rollback

If issues arise after deployment:
1. **Revert the `document_storage_mode` setting**: Set it to empty string or delete the row from `app_settings` — this triggers the backward-compatible fallback logic
2. **Redeploy previous server code**: The `documentStorage.ts` service, if removed, is replaced by the original direct Google Drive calls. All existing files (both Google Drive and base64) have their storage location encoded in the `drive_file_id` prefix (`local:` for base64), so they'll continue to resolve correctly whether or not the new service is present.
3. **Client rollback**: Remove the `'document-storage'` panel ID, label, and panel case. The other panels are unaffected.

---

## Design Decisions & Notes

1. **Why `turso_db` / `sql_server` / `google_drive` as mode values?**
   - `turso_db` and `sql_server` match the existing `database_mode` values for consistency
   - `google_drive` matches the existing service name
   - Underscore separator used for multi-word keys (consistent with existing `login_mode`, `database_mode`)

2. **Why not combine with `database_mode`?**
   - Database mode and document storage are orthogonal concerns. A user might want Turso for structured data (fast, edge-distributed) but Google Drive for blob storage (cheaper, better for large files). Keeping them separate allows this flexibility.

3. **Why base64 in DB instead of a proper BLOB column?**
   - The current `file_data` column is `TEXT`, storing base64. This is already working and is compatible across both Turso/SQLite and SQL Server without binary encoding issues. A migration to BLOB can be considered separately.

4. **Turso DB vs SQL Server for base64 storage:**
   - Both modes store files as base64 in the `file_data` column. The distinction matters for availability detection — if you're running on SQL Server as your database, `turso_db` storage would show "offline" since Turso isn't configured. The actual storage mechanism in the DB is identical; the mode name reflects which database engine is available.

5. **Previously saved items are not migrated:**
   - Files already in Google Drive keep their Google `drive_file_id` (no `local:` prefix)
   - Files stored as base64 keep their `local:{uuid}` `drive_file_id`
   - The download logic in `documentStorage.ts` handles both cases transparently
   - This is by design to avoid costly data migrations