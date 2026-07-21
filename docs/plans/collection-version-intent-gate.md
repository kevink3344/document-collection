# Collection Version Intent Gate

**Date:** 2026-07-21
**Author:** Cline
**Status:** Draft — pending review

---

## Executive Summary

Currently, clicking "New Version" on the Collection Builder immediately creates a new draft version and drops the user into the field editor. This makes it too easy to accidentally create versions. This plan introduces an **intent gate**: a dedicated "New Collection Version" page that requires the user to provide a version title and reason before the version is created. Only after confirming the form does the user land in the field editor. Additionally, draft versions can be deleted from the version history panel with a confirmation dialog.

---

## Scope

### Included
- New React route and page: `/collections/:id/new-version`.
- A minimal form on that page: read-only next version label (e.g. "v9"), required Version Title, optional Version Description/Reason.
- Server endpoint change: `POST /api/collections/:id/versions` gains optional `title` and `reason` fields stored on the version row.
- Database: add `title` and `reason` columns to `collection_versions`.
- Delete-draft endpoint: `DELETE /api/collections/:id/versions/:versionId` (draft only, with guard).
- Client: confirmation dialog before deleting a draft version.
- Redirect "New Version" button from in-place action to the new intent-gate page.

### Excluded
- No changes to the published-version workflow (publish, restore).
- No changes to permissions — same roles that can create a version today can use the gate.
- Version title/reason are not displayed anywhere else in this iteration (can be surfaced in a future improvement).

---

## Database Changes

### Add columns to `collection_versions`

```sql
ALTER TABLE collection_versions ADD COLUMN title  TEXT;
ALTER TABLE collection_versions ADD COLUMN reason TEXT;
```

Both columns are nullable so existing rows are unaffected.

**Turso**: add an incremental migration in `applyIncrementalSchema` (in `server/src/database/db.ts`) using `ALTER TABLE … ADD COLUMN IF NOT EXISTS` wrapped in a try/catch (Turso does not support `IF NOT EXISTS` on `ALTER TABLE`, so catch and ignore "duplicate column" errors).

**SQLite local**: add the two `ALTER TABLE` statements to `runMigrations` in `db.ts` with the existing migration-tracking guard (check `schema_migrations` table before applying).

---

## Step-by-Step Implementation Guide

### Phase 1 — Database Migration

1. **`server/src/database/schema.ts`** — update `CREATE TABLE collection_versions` to include the two new columns so fresh installs get them:
   ```sql
   title   TEXT,
   reason  TEXT,
   ```

2. **`server/src/database/db.ts`** — in `applyIncrementalSchema`, add:
   ```ts
   for (const col of ['title', 'reason']) {
     try {
       database.exec(`ALTER TABLE collection_versions ADD COLUMN ${col} TEXT`)
     } catch { /* column already exists */ }
   }
   ```

3. **`server/src/database/db.ts`** — in `runMigrations`, add a guarded migration:
   ```ts
   runOnce('add-version-title-reason', () => {
     db.exec(`ALTER TABLE collection_versions ADD COLUMN title  TEXT`)
     db.exec(`ALTER TABLE collection_versions ADD COLUMN reason TEXT`)
   })
   ```

### Phase 2 — Server: Update Version Endpoints

1. **`server/src/routes/collections.ts`** — `POST /:id/versions`
   - Accept `title?: string` and `reason?: string` in the request body.
   - Pass them to `INSERT INTO collection_versions`.
   - Include `title` and `reason` in the response object.

2. **`server/src/routes/collections.ts`** — add `DELETE /:id/versions/:versionId`
   - Require `authenticateToken` and `isAdministrator`.
   - Load the version; reject with 404 if not found, 409 if `status !== 'draft'`.
   - Reject with 409 if it is the collection's `active_version_id` AND it is the only version (cannot delete the sole version).
   - If it is the `active_version_id` (but other versions exist), set `active_version_id` to the highest remaining version before deleting.
   - `DELETE FROM collection_versions WHERE id = ?` — cascades to `collection_fields`.
   - Return `204 No Content`.

3. **`server/src/routes/collections.ts`** — `GET /:id/versions` response
   - Include `title` and `reason` in each version object.

4. **`server/src/index.ts`** — no new router mounts needed (same router).

### Phase 3 — Client: New Version Intent-Gate Page

1. **`client/src/App.tsx`** — add route:
   ```tsx
   <Route path="/collections/:id/new-version" element={<CollectionNewVersionPage />} />
   ```
   Place it inside the existing administrator-or-above guard.

2. **Create `client/src/pages/CollectionNewVersionPage.tsx`**
   - On mount: call `getCollection(id)` to load the collection name and current version number.
   - Derive next version label: `v${currentVersionNumber + 1}` (display only, not editable).
   - Form fields:
     | Field | Type | Required | Notes |
     |-------|------|----------|-------|
     | Next Version | Text (read-only) | — | Shows e.g. "v9" |
     | Version Title | Text input | Yes | e.g. "Spring 2027 intake" |
     | Version Description / Reason | Textarea | No | Reason for the new version |
   - **Save** button: calls `createCollectionVersion(id, payload)` (new API helper or existing one extended with `title`/`reason`).
     - On success: redirect to `/collections/:id/edit` (the builder).
     - On error: show inline error message.
   - **Cancel** button: `navigate(-1)` back to the builder.
   - Use existing Tailwind card/form styling matching other pages.

3. **`client/src/api/collections.ts`** — extend `createCollectionVersion` to accept optional `title` and `reason`:
   ```ts
   export async function createCollectionVersion(
     id: number,
     payload: CollectionInput & { title?: string; reason?: string }
   ): Promise<Collection>
   ```

### Phase 4 — Client: Redirect "New Version" Button

1. **`client/src/pages/CollectionBuilderPage.tsx`**
   - Remove the call to `handleCreateNewVersion()` from the "New Version" button's `onClick`.
   - Replace with `navigate(\`/collections/${id}/new-version\`)`.
   - Remove (or keep private) the `handleCreateNewVersion` function — it is no longer wired to the button but may remain for the "restore" flow.
   - Update the `versions` side-panel: the "Create New Version" shortcut link, if present, also navigates to the intent-gate page.

### Phase 5 — Client: Delete Draft Version

1. **`client/src/api/collections.ts`** — add:
   ```ts
   export async function deleteCollectionVersion(collectionId: number, versionId: number): Promise<void>
   ```

2. **`client/src/pages/CollectionBuilderPage.tsx`** — in the version history panel, for each version with `status === 'draft'` and `!isActive`:
   - Show a **Delete** (trash) icon button.
   - Clicking it opens an inline confirmation: `"Delete draft v{n}? This cannot be undone."` with Confirm / Cancel.
   - On confirm: call `deleteCollectionVersion`, then refresh the version list via `setLoadTick`.
   - Disable the button while deleting.

   > **Note:** The active draft (the one currently being edited) should NOT show a delete button — the user must switch to a different version first, or the server will reject it.

---

## Impacted Files

### New Files
| File | Purpose |
|------|---------|
| `client/src/pages/CollectionNewVersionPage.tsx` | Intent-gate form page. |

### Existing Files to Edit
| File | Change |
|------|--------|
| `client/src/App.tsx` | Register `/collections/:id/new-version` route. |
| `client/src/api/collections.ts` | Add `title`/`reason` to `createCollectionVersion`; add `deleteCollectionVersion`. |
| `client/src/pages/CollectionBuilderPage.tsx` | Change "New Version" button to navigate; add delete-draft UI in version panel. |
| `server/src/routes/collections.ts` | Accept `title`/`reason` on POST; add DELETE endpoint. |
| `server/src/database/schema.ts` | Add `title` and `reason` columns to `collection_versions`. |
| `server/src/database/db.ts` | Incremental + guarded migration for the two new columns. |

---

## UI Flow

```
Collection Builder (edit mode)
  └─ Click "New Version"
       ↓
  /collections/:id/new-version
  ┌─────────────────────────────────┐
  │  New Collection Version         │
  │                                 │
  │  Next Version:  v9  (read-only) │
  │  Version Title: [____________]  │ ← required
  │  Reason:        [____________]  │ ← optional textarea
  │                                 │
  │  [Cancel]        [Create Version]│
  └─────────────────────────────────┘
       ↓ (on save)
  /collections/:id/edit  (builder, now on new draft v9)
```

---

## Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Where is `title` stored? | `collection_versions.title` — separate from the collection title. |
| 2 | Can a published version be deleted? | No — server rejects with 409 if `status !== 'draft'`. |
| 3 | Can the active version be deleted? | Only if another version exists; server automatically promotes the next-highest version. |
| 4 | Who can delete draft versions? | Same roles that can create versions (administrators). |
| 5 | Is Version Title required? | Yes — it forces the user to think about intent before creating a version. |

---

## Rollback / Verification Plan

### Verification
1. Navigate to an existing published collection with responses.
2. Click "New Version" — confirm it navigates to `/collections/:id/new-version` instead of creating immediately.
3. Submit the form with a title and reason — confirm redirect to builder with new draft version active.
4. In the version panel, confirm the new draft shows a **Delete** button.
5. Click Delete — confirm confirmation dialog appears.
6. Confirm deletion — confirm the draft is removed and the version list refreshes.
7. Try to delete a published version — confirm the button is absent.

### Rollback
- Revert the "New Version" button `onClick` to `handleCreateNewVersion`.
- Remove the new route and page.
- The `title`/`reason` columns and `DELETE` endpoint are additive and safe to leave in place.
