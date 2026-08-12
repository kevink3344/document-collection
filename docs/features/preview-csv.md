# CSV Preview Page

**Date:** 2026-08-12
**Author:** Copilot
**Status:** Draft — pending review

---

## Goal

Add a dedicated preview page for Export CSV so a user can inspect the generated CSV data in the browser before downloading it. The existing **Download CSV** button should stay on the Export CSV page, and a new **Preview CSV** button beside it should open the preview page with the same export parameters.

---

## Current Behavior

The Export CSV page already lets a user:

- choose a collection
- choose submission columns
- choose ticket columns
- download the CSV file directly

At the moment, the user cannot review the rows that will be exported unless they download the file first.

---

## Desired Behavior

1. Add a **Preview CSV** button next to **Download CSV**.
2. When clicked, the app should navigate to a dedicated preview page.
3. The preview page should generate the same export data used for the CSV download.
4. The preview must show:
   - column headers
   - row data
   - the same selected submission/ticket columns that will be exported
5. The preview should not replace download. It is a companion action.
6. The preview should respect the same permissions and filters as the final CSV.
7. The preview should be capped at the first 100 rows of data.
8. The preview should support a preview flag so the server can return preview-specific data when needed.
9. The preview must match the CSV output exactly for the rows and columns it shows.

---

## Proposed UX

### Button layout

Place the new button beside the existing download button in the page action row:

- **Preview CSV**
- **Download CSV**

The preview button should be visually secondary to download, but still prominent enough to discover.

### Preview display

Use a dedicated page for previewing the export. This keeps the table larger, avoids crowding the export controls, and gives enough room for wide CSV output.

Recommended approach: a dedicated page with a large, scrollable table and a summary header showing the selected collection and column groups.

### Preview table behavior

- Keep the table header fixed if the preview is long.
- Allow horizontal scrolling for wide exports.
- Allow vertical scrolling for large row sets.
- Show a small note above the table if the preview is truncated.
- Provide a way to return to the Export CSV page without losing the current selection state.

---

## Implementation Plan

### 1. Reuse the export payload

The preview should use the same selection state already built for download:

- selected collection
- selected submission columns
- selected ticket template
- selected ticket columns

This avoids introducing a second export definition and keeps preview and download aligned.

### 2. Add a preview endpoint or preview mode

The backend should expose a preview-friendly response rather than forcing the client to reconstruct rows on its own.

Two viable approaches:

- **Preferred:** add a JSON preview endpoint that returns structured rows and headers for the currently selected export
- **Alternative:** reuse the existing CSV endpoint and parse the CSV on the client for preview

Preferred approach: JSON preview endpoint. It is safer, easier to render as a table, and avoids CSV parsing quirks in the browser.

The endpoint should support a `preview=true` flag so the server can intentionally cap the result set at 100 rows and return a preview-friendly payload.

Suggested shape:

```json
{
  "headers": ["Submission ID", "Student Name", "Status"],
  "rows": [
    ["123", "Alice Johnson", "Open"],
    ["124", "Jordan Smith", "Closed"]
  ],
  "truncated": false,
  "rowCount": 2
}
```

### 3. Keep preview logic aligned with download logic

The preview should call the same row-building code path that generates the export data.

That means the server should ideally factor the export assembly into a shared helper that can return either:

- CSV text for download
- structured rows for preview

This avoids drift where preview and download no longer match.

### 4. Add client state for preview

In the Export CSV page and preview page, add state for:

- preview loading state
- preview data
- preview error state
- whether the preview page should show a loading skeleton or table

The preview button should:

- validate the current selection
- request preview data
- open the preview page when data returns
- show an error message if the request fails

### 5. Render the preview table

Use a simple table layout:

- first row: headers
- body rows: preview data
- optional empty state if no rows are returned

If the export is wide, keep it inside a horizontally scrollable container.

Show a small note above the table stating that the preview is limited to the first 100 rows.

### 6. Enforce safe preview limits

To keep the page responsive, the preview should be bounded at 100 rows.

If the dataset is larger, show a message that the preview is truncated and the CSV download will include the full export.

---

## Edge Cases

- If the export has no selected columns, disable preview the same way download is disabled.
- If the collection has no eligible rows, show an empty preview state instead of an error.
- If the ticket template selection changes, refresh or clear the preview so it never shows stale columns.
- If the preview is truncated, make that explicit in the UI.
- If a preview request fails, keep the download action available.
- If preview mode is requested, ensure the same row and column ordering used by CSV generation is preserved.

---

## Files Likely to Change

- `client/src/pages/ExportCsvPage.tsx` — add preview button, preview panel, preview state
- `client/src/pages/ExportCsvPreviewPage.tsx` — new dedicated preview page
- `client/src/api/exportCsv.ts` — add preview API call
- `server/src/routes/export-csv.ts` — add preview endpoint or preview mode
- `server/src/routes/collections.ts` or shared export helper — reuse row assembly logic
- `docs/features/preview-csv.md` — this plan

---

## Testing Plan

1. Open the Export CSV page for a collection with data.
2. Select several submission columns and a ticket template.
3. Click **Preview CSV**.
4. Confirm the preview page shows matching headers and rows.
5. Change column selections and confirm the preview updates.
6. Confirm **Download CSV** still downloads the same data.
7. Test an empty result set and confirm the preview shows a helpful empty state.
8. Test with a larger dataset and confirm the preview is capped at 100 rows and clearly marked as truncated.

---

## Decisions Confirmed

1. Preview should be a page.
2. Preview should be capped at the first 100 rows.
3. The backend may support a preview flag.
4. The preview must match the CSV output exactly.

---

## Recommendation

Use a structured JSON preview endpoint, support a `preview` flag, and render the result on a dedicated preview page. That keeps the UI fast, keeps preview and download aligned, and makes the table rendering straightforward.
