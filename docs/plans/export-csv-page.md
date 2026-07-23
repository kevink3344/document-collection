# Dedicated “Export CSV” Page

**Date:** 2026-07-21
**Author:** Cline
**Status:** Draft — pending review

---

## Executive Summary

Create a standalone `/export-csv` page where users can generate a single CSV report that mixes **Submission** columns and **Ticket** columns on the same row. The page will let users select a published collection, optionally choose which submission columns to include, optionally choose which ticket (and ticket columns) to include, and download a unified CSV. Users who are assigned to one or more Locations will only see submissions whose location-filter field matches their assigned locations.

---

## Scope

### Included
- New React route and page component: `/export-csv`.
- Client-side UI for selecting Submission columns and Ticket columns.
- Server endpoint to fetch combined submission + ticket data for export.
- Server-side enforcement of organization scoping and location-based filtering.
- CSV generation and browser download.

### Excluded
- Does not add new permissions/roles; reuses existing `canViewResponses` / `canViewAllResponses` helpers.
- Does not support filtering by date range in the first iteration.

---

## Requirements Recap

1. A user clicks a button and is taken to `/export-csv`.
2. On the page the user picks a collection.
3. By default **“All Submission Columns”** and **“All Ticket Columns”** are checked.
4. Unchecking either exposes a panel of available checkboxes:
   - Top panel: available Submission columns.
   - Bottom panel: available Ticket columns (template selector + field checkboxes).
5. The final CSV contains one row per submission/ticket pair, with selected submission columns and selected ticket columns side-by-side.
6. Example selection:
   - Submission columns: Student Name, Student Id, School, Parent Name, Email Address.
   - Ticket columns: Status, Notes, Meeting Date.
   - All appear in the same report row.
7. Users with a Location assignment are restricted to submissions whose enabled location-filter field matches one of their assigned locations.

---

## Step-by-Step Implementation Guide

### Phase 1 — Route & Page Shell

1. **Add route in `client/src/App.tsx`.**
   - Import `ExportCsvPage`.
   - Place it inside the existing reviewer-and-up guard:
     ```tsx
     <Route path="/export-csv" element={<ExportCsvPage />} />
     ```
2. **Create `client/src/pages/ExportCsvPage.tsx`.**
   - Use existing page layout conventions (white card, dark-mode classes, `space-y-6` wrapper).
   - Add a header with page title and short description.
   - Add a collection `<select>` populated from the existing `listCollections()` API.

### Phase 2 — Column Metadata API

1. **Create `server/src/routes/export-csv.ts` (new router).**
   - `GET /api/export-csv/collections/:id/schema`
     - Requires `authenticateToken`.
     - Loads `RequestUserContext`.
     - Verifies the user can view responses (`canViewResponses`).
     - Verifies the collection belongs to the user’s active organization.
     - Returns:
       ```json
       {
         "submissionColumns": [
           { "fieldId": null, "key": "id", "label": "Submission ID" },
           { "fieldId": null, "key": "submittedAt", "label": "Submitted At" },
           { "fieldId": null, "key": "respondentName", "label": "Respondent Name" },
           { "fieldId": null, "key": "respondentEmail", "label": "Respondent Email" },
           { "fieldId": 42, "key": "field", "label": "Student Name" }
         ],
         "ticketTemplates": [
           {
             "templateId": 3,
             "title": "Follow-up Ticket",
             "columns": [
               { "fieldId": 101, "key": "status", "label": "Status" },
               { "fieldId": 102, "key": "field", "label": "Notes" },
               { "fieldId": 103, "key": "field", "label": "Meeting Date" }
             ]
           }
         ]
       }
       ```
   - The route should reuse existing collection/ticket field-fetching helpers from `collections.ts` if possible; otherwise duplicate the small fetch queries in the new router.

2. **Wire the router in `server/src/index.ts`.**
   ```ts
   import exportCsvRouter from './routes/export-csv'
   app.use('/api/export-csv', exportCsvRouter)
   ```

3. **Create `client/src/api/exportCsv.ts`.**
   - `getExportSchema(collectionId: number): Promise<ExportSchema>`.
   - `postExportCsv(body: ExportRequest): Promise<Blob>` (for Phase 4).

### Phase 3 — Column Selection UI

1. **State shape in `ExportCsvPage.tsx`.**
   ```ts
   const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(null)
   const [schema, setSchema] = useState<ExportSchema | null>(null)
   const [allSubmissionColumns, setAllSubmissionColumns] = useState(true)
   const [selectedSubmissionColumns, setSelectedSubmissionColumns] = useState<Set<string>>(new Set())
   const [selectedTicketTemplateId, setSelectedTicketTemplateId] = useState<number | null>(null)
   const [allTicketColumns, setAllTicketColumns] = useState(true)
   const [selectedTicketColumns, setSelectedTicketColumns] = useState<Set<string>>(new Set())
   const [loading, setLoading] = useState(false)
   ```

2. **Load schema when collection changes.**
   - Call `getExportSchema`.
   - Default to selecting all submission keys and all ticket columns for the first ticket template.

3. **Render selection panels.**
   - Two checkbox groups:
     - **Submission Columns**
       - Master checkbox: “All Submission Columns”.
       - When unchecked, show list of `submissionColumns` with individual checkboxes.
     - **Ticket Columns**
       - Template `<select>` listing `ticketTemplates`.
       - Master checkbox: “All Ticket Columns” for the selected template.
       - When unchecked, show list of that template’s `columns`.
   - Use existing Tailwind checkbox/input styling.

4. **Validation.**
   - Disable the export button if no collection is selected, no columns are selected, or no ticket template is selected when ticket export is desired.

### Phase 4 — Server-Side Export Endpoint

1. **Add `POST /api/export-csv/collections/:id/export` in `server/src/routes/export-csv.ts`.**
   - Request body:
     ```json
     {
       "submissionColumnKeys": ["id", "submittedAt", "respondentName", "field-42"],
       "ticketTemplateId": 3,
       "ticketColumnKeys": ["status", "field-101", "field-102"]
     }
     ```
   - Response: `Content-Type: text/csv` with `Content-Disposition: attachment; filename="<collection-title>-export.csv"`.

2. **Data fetch with location filtering.**
   - Reuse the exact logic from `GET /api/collections/:id/responses` in `server/src/routes/collections.ts`:
     - If `!canViewAllResponses(context)`, find the location field (`type = 'location' AND location_filter_enabled = 1`) for the collection.
     - Load the user’s assigned location names from `user_locations`.
     - Restrict `collection_responses` to those whose response value for the location field is in the user’s assigned locations.
   - Fetch the selected submission field values for the filtered responses.
   - Fetch all ticket responses for the selected template joined to the filtered submissions.

3. **Row assembly.**
   - Produce one row per `(submission, ticketResponse)` pair.
   - If a submission has no ticket response, emit one row with empty ticket cells (this matches “submission + ticket on the same line” requirement while preserving every submission).
   - Build CSV with proper escaping (commas, quotes, newlines).

4. **Column key mapping.**
   - Built-in submission keys: `id`, `submittedAt`, `respondentName`, `respondentEmail`.
   - Dynamic field keys: `field-{fieldId}`.
   - Built-in ticket keys: `status`, `finalizedAt`, `finalizedByName`, `submittedAt`.
   - Dynamic ticket field keys: `field-{fieldId}`.

### Phase 5 — Client CSV Download

1. In `ExportCsvPage.tsx`, on export click:
   - Build the request body from current selections.
   - Call `postExportCsv`.
   - Create a Blob and trigger an `<a download>` click (same pattern as `RecordsPage.tsx`).
2. Show loading and error states.

### Phase 6 — Redirect Existing Records “Export CSV” Button

1. **Update `client/src/pages/RecordsPage.tsx`.**
   - Locate the existing **“Export CSV”** button in the collection header (currently calls `downloadCollectionCsv`).
   - Change its `onClick` to navigate to `/export-csv`:
     ```tsx
     import { useNavigate } from 'react-router-dom'
     // ...
     const navigate = useNavigate()
     // ...
     <button
       type="button"
       onClick={() => navigate('/export-csv', { state: { collectionId: selectedCollection.id } })}
       disabled={!selectedCollection || responses.length === 0}
       // keep existing styling
     >
       <Download size={14} />
       Export CSV
     </button>
     ```
   - Optionally remove or deprecate the local `downloadCollectionCsv` helper if it is no longer used elsewhere.

### Phase 7 — Saved Export Presets

Users can save a named set of column selections (e.g., “Report export #1”) and reload it later.

1. **Database schema additions.**
   - Add to `server/src/database/schema.ts`:
     ```sql
     CREATE TABLE IF NOT EXISTS saved_export_presets (
       id                     INTEGER PRIMARY KEY AUTOINCREMENT,
       created_by_user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
       organization_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
       collection_id          INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
       name                   TEXT    NOT NULL,
       all_submission_columns INTEGER NOT NULL DEFAULT 1,
       submission_columns     TEXT    NOT NULL DEFAULT '[]',
       ticket_template_id     INTEGER,
       all_ticket_columns     INTEGER NOT NULL DEFAULT 1,
       ticket_columns         TEXT    NOT NULL DEFAULT '[]',
       created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
       updated_at             TEXT    NOT NULL DEFAULT (datetime('now')),
       UNIQUE(organization_id, collection_id, name)
     );
     ```
   - `submission_columns` and `ticket_columns` store JSON arrays of selected column keys.

2. **Server API for presets.**
   - In `server/src/routes/export-csv.ts` add:
     - `GET /api/export-csv/presets?collectionId=<id>` — list presets for the current organization + collection.
     - `POST /api/export-csv/presets` — create a new preset.
     - `PUT /api/export-csv/presets/:presetId` — rename or update selections.
     - `DELETE /api/export-csv/presets/:presetId` — delete a preset.
   - Validate that the preset’s collection is accessible and belongs to the user’s active organization.

3. **Client API helpers.**
   - Extend `client/src/api/exportCsv.ts` with:
     - `getExportPresets(collectionId: number)`
     - `createExportPreset(body: ExportPresetInput)`
     - `updateExportPreset(presetId: number, body: ExportPresetInput)`
     - `deleteExportPreset(presetId: number)`

4. **UI updates in `ExportCsvPage.tsx`.**
   - Add a **“Save Selection”** button near the export button.
   - Clicking it opens a small modal/prompt for the preset name (default e.g., `Report export #1`).
   - Save the current selections via `createExportPreset`.
   - Add a `<select>` labeled **“Load saved report”** above the column panels.
   - On selecting a preset, restore:
     - `allSubmissionColumns`
     - `selectedSubmissionColumns`
     - `selectedTicketTemplateId`
     - `allTicketColumns`
     - `selectedTicketColumns`
   - Add a **“Rename”** and **“Delete”** option next to each loaded preset.

5. **Default name generation.**
   - When saving, if no name is provided, auto-generate `Report export #<n>` where `<n>` is the next available number for that organization/collection.

---

## Impacted Files

### New Files
| File | Purpose |
|------|---------|
| `client/src/pages/ExportCsvPage.tsx` | New export page UI. |
| `client/src/api/exportCsv.ts` | API helpers for schema and CSV export. |
| `server/src/routes/export-csv.ts` | New REST endpoint for schema + CSV generation. |

### Existing Files to Edit
| File | Change |
|------|--------|
| `client/src/App.tsx` | Register `/export-csv` route. |
| `server/src/index.ts` | Mount `/api/export-csv` router. |
| `client/src/pages/RecordsPage.tsx` | Redirect existing “Export CSV” button to `/export-csv`. |
| `server/src/database/schema.ts` | Add `saved_export_presets` table. |
| `client/src/types/index.ts` | Add `ExportSchema`, `ExportRequest`, `ExportColumn`, `ExportTicketTemplate`, `ExportPreset`, `ExportPresetInput` types. |

> **Note on preset scope:** Presets are shared across organization users. The `saved_export_presets` table uses `organization_id + collection_id` as the sharing scope with `UNIQUE(organization_id, collection_id, name)`. The `created_by_user_id` column is retained only as an audit field (who created the preset) and is not used for access control.

### Files Referenced for Logic but Not Edited
- `server/src/routes/collections.ts` (location filter and response-fetching patterns).
- `server/src/middleware/organizationAccess.ts` (role helpers).
- `server/src/database/schema.ts` (table definitions).

---

## Rollback / Verification Plan

### Verification
1. Run the client and server locally.
2. Log in as an administrator:
   - Navigate to `/export-csv`.
   - Select a collection with submissions and tickets.
   - Verify defaults (all submission + all ticket columns checked).
   - Uncheck “All Submission Columns” and select a subset.
   - Uncheck “All Ticket Columns” and select a subset.
   - Export and open the CSV; confirm columns are side-by-side.
3. Log in as a reviewer assigned to one location:
   - Confirm the exported rows only include submissions whose location field matches the assigned location.
4. Log in as a plain `user`:
   - Confirm `/export-csv` route redirects away (no access).

### Rollback
- Remove the route from `client/src/App.tsx`.
- Remove the router mount from `server/src/index.ts`.
- Delete the three new files.
- Revert the one-line link addition in `RecordsPage.tsx`.
- No database migrations are required, so rollback is fully code-based.

---

## Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Multiple ticket templates per export? | **No** — each export supports **one ticket** only. The UI exposes a single ticket-template selector. |
| 2 | Date range filtering for submissions? | **No** — not included in the first iteration. |
| 3 | Include submission staff-only fields? | **Yes** — staff-only fields are available as selectable columns (users who can access the page already have reviewer-level access or higher). |
| 4 | Include submissions without a ticket response? | **Yes** — every visible submission appears in the report; ticket cells are blank when no ticket response exists. |
| 5 | Share presets across organization users? | **Yes** — presets are scoped to `organization_id + collection_id` so any user in the same organization and collection can see and use them. |

> **Note:** The schema and API sections above already reflect this shared scope (e.g., `UNIQUE(organization_id, collection_id, name)` and listing presets by organization + collection). The `created_by_user_id` column is retained only as an audit column (who created the preset) and is not used for access control.
