# Per-Row Required on Matrix / Likert Questions

**Date:** 2026-11-03
**Status:** Approved — Ready for Implementation
**Decisions:** All 4 open questions resolved 2026-11-03 (see [Resolved Decisions](#resolved-decisions))
**Related:** [webhooks-student-id.md](./webhooks-student-id.md), [organizing-settings.md](./organizing-settings.md)

---

## Executive Summary

A **Matrix Likert Scale** field is currently all-or-nothing: the field has one `required` flag, and when it is on, the whole matrix is treated as a single required answer. Staff want **row-level** control — in a 4-row matrix, mark 2 rows required and 2 optional.

This adds an optional `requiredRows: number[]` list to the matrix config. When present, validation checks only those rows. When absent, existing behaviour is unchanged (whole field required / not required).

**No database migration.** The matrix config already lives in `collection_fields.options[0]` as a JSON blob, so the new property rides along in that existing JSON.

---

## Current Behaviour (as-is)

| Piece | Location | Notes |
|-------|----------|-------|
| Matrix config | `collection_fields.options[0]` = `JSON.stringify({ rows, columns })` | Set by `MatrixLikertConfigModal` via `updateField(..., { options: [JSON.stringify(config)] })` |
| Builder UI | `CollectionBuilderPage.tsx` — "Configure Matrix" button (line ~3266) | Shows `({field.options.length} rows)` — which is actually the **options array length (always 1)**, not the row count |
| Config modal | `components/collections/MatrixLikertConfigModal.tsx` | Rows + columns editors, live preview |
| Fill rendering | `CollectionFillPage.tsx` — `MatrixLikertScaleInput` (line ~287) | Stores `Record<rowIdx, colLabel>` as JSON in the field value |
| Required check | `CollectionFillPage.tsx` — `isRequiredFieldFilled` (line ~1133) | `matrix_likert_scale` falls through to `default: value.trim() !== ''` |
| Records display | `RecordsPage.tsx` (line ~718) | Dumps raw JSON in a `<pre>` |
| Submission detail | `MySubmissionDetailPage.tsx` (line ~46) | Renders `Row N: <label>` |

**The gap:** with `required = true`, a respondent can answer **one** row and satisfy the field. There is no way to say "rows 1 and 3 must be answered."

---

## Scope

### Included

- `requiredRows: number[]` added to the matrix config JSON (row indices).
- Per-row **Required** checkbox in `MatrixLikertConfigModal`.
- Visual indicator (asterisk) on required rows in the builder preview and on the fill page.
- Validation that only the marked rows must be answered.
- A generic error message when required rows are unanswered.
- Backward compatibility: configs without `requiredRows` behave exactly as today.

### Excluded

- Per-**column** required rules (columns are scale labels, not answerable items).
- Per-row required on `custom_table` fields (different structure — a possible follow-up).
- Changing how the field-level `required` toggle behaves for other field types.
- Server-side enforcement of row requirements (client-only, consistent with all other field types).

---

## Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Store `requiredRows` **inside the existing config JSON**, not a new column. | The config is already a JSON blob in `options[0]`; adding a property needs no schema change and no migration. |
| D2 | Row indices, not labels. | Labels are user-editable and can duplicate; indices are stable and already how responses are keyed (`Record<rowIdx, colLabel>`). |
| D3 | **Absent `requiredRows` = current behaviour.** | Existing published forms must not suddenly start rejecting answers. |
| D4 | Required rows only apply when the **field-level `required` toggle is on**. | Keeps one obvious switch ("this question matters") and one refinement ("these parts of it matter"). Avoids a confusing state where the field is optional but rows are required. |
| D5 | The modal keeps the row list in sync when rows are added/removed/reordered. | Indices shift when a row is deleted; the checkbox state must follow the row, not the index. |
| D6 | The error message is **generic**. | "Please answer all required rows" — consistent with the app's other required-field messages, and avoids leaking row labels that may be long or duplicated. |

---

## Step-by-Step Implementation Guide

### Step 1: Extend the config type

**File:** `client/src/components/collections/MatrixLikertConfigModal.tsx`

```ts
export interface MatrixConfig {
  rows: string[]
  columns: string[]
  /** Row indices that must be answered. Absent/empty = no per-row requirement. */
  requiredRows?: number[]
}
```

Export the type so the builder and fill page can share it (currently it is declared locally in both the modal and `CollectionFillPage`).

**File:** `client/src/types/index.ts` (optional but recommended)

Add a shared type so three files stop re-declaring the shape:

```ts
export interface MatrixLikertConfig {
  rows: string[]
  columns: string[]
  requiredRows?: number[]
}
```

---

### Step 2: Modal — per-row Required checkbox

**File:** `client/src/components/collections/MatrixLikertConfigModal.tsx`

1. Track required rows as a **parallel array of booleans aligned to `rows`**, not as raw indices:

   ```ts
   const [requiredFlags, setRequiredFlags] = useState<boolean[]>(() => {
     const initial = config?.requiredRows ?? []
     return (config?.rows ?? defaultConfig.rows).map((_, i) => initial.includes(i))
   })
   ```

   > This is the key detail for D5. Keeping flags index-aligned with `rows` means `addRow` / `removeRow` can splice both arrays together and the checkbox stays with its row.

2. Update the row editors:

   ```ts
   function addRow() {
     setRows(prev => [...prev, ''])
     setRequiredFlags(prev => [...prev, false])
   }

   function removeRow(idx: number) {
     setRows(prev => prev.filter((_, i) => i !== idx))
     setRequiredFlags(prev => prev.filter((_, i) => i !== idx))
   }
   ```

3. Add a checkbox to each row, before the delete button:

   ```tsx
   <label className="flex items-center gap-1.5 shrink-0 text-xs text-[#475569] dark:text-[#CBD5E1]">
     <input
       type="checkbox"
       checked={requiredFlags[i] ?? false}
       onChange={e => setRequiredFlags(prev => prev.map((v, j) => (j === i ? e.target.checked : v)))}
       className="h-3.5 w-3.5 accent-[#2563EB]"
     />
     Required
   </label>
   ```

4. Update the section heading and add a hint:

   > **Rows (Left side labels)** — tick **Required** on any row that must be answered. Leave all unticked to require the whole matrix only when the question itself is marked required.

5. In `handleSave`, compute indices **after** filtering blank rows (blank rows are dropped, so indices must be recomputed against `validRows`):

   ```ts
   function handleSave() {
     const kept: { label: string; required: boolean }[] = []
     rows.forEach((r, i) => {
       const label = r.trim()
       if (label) kept.push({ label, required: requiredFlags[i] ?? false })
     })
     const validColumns = columns.filter(c => c.trim() !== '').map(c => c.trim())

     if (kept.length === 0 || validColumns.length === 0) {
       alert('Please add at least one row and one column.')
       return
     }

     const requiredRows = kept
       .map((row, idx) => (row.required ? idx : -1))
       .filter(idx => idx >= 0)

     onSave({
       rows: kept.map(r => r.label),
       columns: validColumns,
       // Omit entirely when nothing is required, so old configs stay byte-identical.
       ...(requiredRows.length > 0 ? { requiredRows } : {}),
     })
   }
   ```

6. **Preview table** — prefix required row labels with a red asterisk:

   ```tsx
   {row || `Row ${i + 1}`}
   {requiredFlags[i] && <span className="text-red-500 ml-0.5">*</span>}
   ```

---

### Step 3: Builder — show required rows

**File:** `client/src/pages/CollectionBuilderPage.tsx`

1. Fix the misleading row count on the "Configure Matrix" button (line ~3270). It currently reads `field.options.length`, which is always `1`:

   ```tsx
   {matrixConfigFromField && (
     <span className="ml-1 text-white font-medium">
       ({matrixConfigFromField.rows.length} rows
       {matrixConfigFromField.requiredRows?.length
         ? `, ${matrixConfigFromField.requiredRows.length} required`
         : ''})
     </span>
   )}
   ```

   `matrixConfigFromField` is already computed at line ~1310 — it just isn't in scope in `FieldCard`. Pass it down as a prop (e.g. `matrixConfig`) or parse `field.options[0]` inside `FieldCard`.

2. When the field-level `required` toggle is **off** but `requiredRows` is non-empty, show a hint under the button:

   > *"Row requirements only apply when this question is marked required."*

   This prevents the silent no-op described in D4.

---

### Step 4: Fill page — validate only the required rows

**File:** `client/src/pages/CollectionFillPage.tsx`

1. Add a helper next to `isRequiredFieldFilled` (line ~1133):

   ```ts
   function getMatrixConfig(field: CollectionField): MatrixLikertConfig | null {
     try {
       const first = field.options?.[0]
       if (typeof first === 'string' && first.startsWith('{')) {
         return JSON.parse(first) as MatrixLikertConfig
       }
     } catch {
       // fall through
     }
     return null
   }

   /** True when any required row is unanswered. */
   function hasUnansweredRequiredRows(field: CollectionField, value: string): boolean {
     const config = getMatrixConfig(field)
     if (!config?.requiredRows?.length) return false

     let responses: Record<string, string> = {}
     try {
       responses = value ? (JSON.parse(value) as Record<string, string>) : {}
     } catch {
       responses = {}
     }

     return config.requiredRows.some(idx => (responses[idx] ?? '').trim() === '')
   }
   ```

2. Update `isRequiredFieldFilled` — add a `matrix_likert_scale` case **before** `default`:

   ```ts
   case 'matrix_likert_scale': {
     const hasUnanswered = hasUnansweredRequiredRows(field, value)
     if (hasUnanswered) return false
     // No per-row rules: fall back to "at least one row answered".
     return value.trim() !== ''
   }
   ```

   > With `requiredRows` set, answering only those rows satisfies the field — the optional rows can be left blank, which is the whole point.

3. Update `getFieldValidationError` (line ~1160) to produce a generic message:

   ```ts
   if (field.type === 'matrix_likert_scale') {
     if (hasUnansweredRequiredRows(field, value)) {
       return 'Please answer all required rows.'
     }
   }
   ```

   This runs before the generic `isRequiredFieldFilled` message, so the respondent gets a matrix-specific hint rather than "Please complete all required fields on this page." Row labels are deliberately **not** included.

4. **`MatrixLikertScaleInput`** — mark required rows visually. It already parses the config; extend the parse to include `requiredRows` and render:

   ```tsx
   const isRequiredRow = config.requiredRows?.includes(rowIdx) ?? false
   ```

   - Mobile: append `<span className="text-red-500 ml-0.5">*</span>` after the row label.
   - Desktop: same, inside the row header `<td>`.

   Keep the asterisk **conditional on `field.required`** — if the question isn't required, the rows aren't either (D4).

---

### Step 5: Nothing to change server-side

`collection_fields.options` is already a free-form `TEXT` column that the API round-trips verbatim (`toApiCollection`, `dbFieldsToFieldInput`, `insertFields`, `insertFieldsForVersion`). The new property flows through untouched.

**No migration, no schema change, no SQL Server DDL.**

---

## Files Touched

| File | Change |
|------|--------|
| `client/src/components/collections/MatrixLikertConfigModal.tsx` | `requiredRows` in type; per-row Required checkbox; index-safe add/remove; preview asterisk; save logic |
| `client/src/pages/CollectionBuilderPage.tsx` | Accurate row/required count on the button; hint when field isn't required |
| `client/src/pages/CollectionFillPage.tsx` | `getMatrixConfig`, `hasUnansweredRequiredRows`, matrix case in `isRequiredFieldFilled`, generic error message, asterisks in `MatrixLikertScaleInput` |
| `client/src/types/index.ts` | Shared `MatrixLikertConfig` type (optional) |
| `docs/APPLICATION_GUIDE.md` | Document per-row required |

**No server files. No database changes.**

---

## Edge Cases & Behaviours

| Scenario | Behaviour |
|----------|-----------|
| Existing matrix config with no `requiredRows` | Unchanged — field-level `required` still means "answer at least one row". |
| Field `required` off, `requiredRows` set | Rows are **not** enforced; builder shows a hint explaining why. |
| Field `required` on, `requiredRows` set | Only those rows are enforced; optional rows may be blank. |
| All rows marked required | Equivalent to the old behaviour, but with a per-row error message. |
| Required row deleted in the modal | Flag is spliced out with the row; indices recompute on save. |
| Blank row left in the modal | Dropped on save; required flags follow the surviving rows via `kept`. |
| Two rows with the same label | Indices keep them distinct; the error message may repeat the label — acceptable. |
| Respondent answers only optional rows | Fails with "Please answer all required rows." |
| Malformed stored value | Treated as no answers; required rows reported as unanswered. |
| Matrix in a **ticket** template | Out of scope — ticket fields are a separate table/model; unchanged. |

---

## Testing Plan

**Builder**
- Open Configure Matrix on a 4-row matrix → tick rows 1 and 3 → Save → reopen → same two ticked.
- Add a row after ticking → new row unticked, existing ticks unchanged.
- Delete a ticked row above another ticked row → the remaining tick stays on the correct row.
- Leave a blank row in the middle → saved config drops it and indices still point at the right labels.
- Button summary reads e.g. "4 rows, 2 required".
- With field `required` off, the hint appears.

**Fill page**
- Required field + rows 1,3 required: answer only row 1 → blocked with "Please answer all required rows."
- Answer rows 1 and 3, leave 2 and 4 blank → submits successfully.
- Required field, no `requiredRows`: answer one row → submits (unchanged).
- Optional field with `requiredRows`: answer nothing → submits (rows not enforced).
- Asterisks appear only on required rows, and only when the field is required.
- Mobile (narrow viewport) shows the same asterisks.

**Regression**
- A form saved **before** this change loads and submits exactly as before.
- Records and My Submission Detail render matrix answers unchanged.
- `npm run build` (client) passes.

---

## Resolved Decisions

All questions answered by the product owner on 2026-11-03.

| # | Question | Decision | Where it lands |
|---|----------|----------|----------------|
| 1 | Enforce required rows server-side too? | **No — client-only.** | Consistent with every other field type; no server changes in this plan. |
| 2 | Name the unanswered rows in the error, or use a generic message? | **Generic.** | `"Please answer all required rows."` — see D6 and Step 4.3. |
| 3 | Auto-enable the field-level `required` toggle when a row is ticked? | **No.** | The builder shows a hint instead; the admin makes the choice explicitly. See Step 3.2. |
| 4 | Same treatment for Custom Table fields? | **Separate follow-up.** | Listed in `docs/plans/future-improvements.md`; not part of this change. |
