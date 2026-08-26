# Plan: Copy a Question (Field) with All Options

> **Status:** Implemented — see `client/src/pages/CollectionBuilderPage.tsx` (`copyField`, `FieldCard` `onCopy` prop, copy button in the header button group)
> **Date:** 2026-08-26
> **Goal:** Let a user click a **copy** icon on a question in the Collection Builder, and immediately insert an identical question (with all of its options) directly **below** the original.
> **Scope:** Client only — `client/src/pages/CollectionBuilderPage.tsx`. No server, database, or type changes required.

---

## TL;DR

In the **Collection Builder**, each question is rendered as a `FieldCard`. Today the header row has the field-type `<select>`, the field index, move-up/move-down chevrons, and a delete (trash) icon.

This plan adds a **copy** icon beside those move/delete buttons. Clicking it deep-clones the current `BuilderField` (giving it a **new `_key`** and a **new `fieldKey`**), inserts the copy immediately after the original in the `fields` array, and keeps the full option list intact.

The new question appears **below** the original, is fully independent (editable, movable, deletable on its own), and is saved with the rest of the collection on the next save.

---

## Understanding the current data model

`BuilderField` (in `CollectionBuilderPage.tsx`) is the question object:

```ts
interface BuilderField {
  _key: string            // local, stable UI id (must be unique per field)
  fieldKey: string        // persistent key used in submissions/reports
  type: FieldType
  label: string
  subtitle: string
  page: number
  required: boolean
  options: string[]       // <-- the choices (for single/multiple choice)
  displayStyle: FieldDisplayStyle
  branchRules: FieldBranchRule[]
  tableColumns: TableColumn[]
  staffOnly: boolean
  locationFilterEnabled: boolean
}
```

Key facts that shape this plan:

- **`_key`** is generated via `uid()` (`Math.random().toString(36).slice(2)`). It must be **unique** per field or React key collisions will break rendering.
- **`fieldKey`** is a separate persistent identifier (also `uid()` by default in `blankField`). A copied question needs its own `fieldKey` so its submissions/answers are tracked separately from the original.
- **`options`** is the array of choice strings (for `single_choice` and `multiple_choice`). Copying a question must **deep-copy** this array (not pass the same reference) so later edits don't mutate the original.
- **`tableColumns`** and **`branchRules`** are arrays of objects — they must be deep-copied too so the copy doesn't share references with the original.
- **`buildField`** (`blankField(page)`) is the factory for empty fields; `mapCollectionToBuilderFields` shapes existing fields.

---

## Why `_key` and `fieldKey` both need regenerating

| Id | Purpose | Copy behavior |
|----|---------|---------------|
| `_key` | React list key + local UI identity | **Regenerate** (`uid()`). Two fields must never share a `_key` or the UI breaks. |
| `fieldKey` | Persistent answer column key in DB | **Regenerate.** If two fields shared a `fieldKey`, their answers would collide in submissions/reports. |

Every other property (`label`, `subtitle`, `page`, `required`, `options`, `displayStyle`, `branchRules`, `tableColumns`, `staffOnly`, `locationFilterEnabled`) is copied **by value / deep-cloned**.

---

## Implementation steps

### Step 1 — Add a `copyField` helper

Add a function next to the existing field helpers (`updateField`, `removeField`, `moveField`). It finds the source field, clones it, and inserts the clone **immediately after the source** in the same position:

```ts
function copyField(key: string) {
  setFields(prev => {
    const sourceIndex = prev.findIndex(f => f._key === key)
    if (sourceIndex === -1) return prev

    const source = prev[sourceIndex]
    const copy: BuilderField = {
      ...source,                             // primitive fields copied by value
      _key: uid(),                           // new local UI id
      fieldKey: uid(),                       // new persistent answer key
      options: [...source.options],          // deep-copy the choice list
      branchRules: source.branchRules.map(r => ({ ...r })),        // clone objects
      tableColumns: source.tableColumns.map(c => ({ ...c })),      // clone objects
    }

    const next = [...prev]
    next.splice(sourceIndex + 1, 0, copy)    // insert directly below
    return next
  })
}
```

Notes:
- `options` uses a spread (`[...]`) to make a **new array** so adding/removing options on the copy doesn't affect the original.
- If a question has an "Other" option, `OTHER_OPTION_MARKER` is an element of `options`, so it is preserved automatically by the array copy.
- The copy inherits `page` and `displayStyle` from the source, so it stays on the same builder page and keeps its radio/dropdown appearance.
- A `comment` field holds its content in `label` (HTML), which is a string — copied by value, safe.
- A `document` field stores its config *inside* `options` (via `serialiseDocumentFieldConfig`), so the array spread also copies it correctly.

### Step 2 — Wire an `onCopy` callback into `FieldCard`

The `FieldCard` component already receives an `onRemove` callback. Add a matching `onCopy` prop and render a **copy icon** in the header button group, next to the move chevrons / trash button:

```tsx
<button
  type="button"
  onClick={onCopy}
  title="Duplicate question"
  className="text-[#94A3B8] hover:text-[#2563EB] transition-colors"
>
  <Copy size={14} />
</button>
```

Add to the `FieldCardProps` interface:

```ts
onCopy: () => void
```

And destructure it in the component signature: `onCopy,`.

### Step 3 — Pass the handler at the call site

In the list that renders `visibleFields`, pass the new prop:

```tsx
<FieldCard
  key={field._key}
  field={field}
  ...
  onRemove={() => handleRemoveFieldClick(field)}
  onCopy={() => copyField(field._key)}          // <-- new
  ...
/>
```

### Step 4 — Confirm the `Copy` icon is already imported

`lucide-react`'s `Copy` icon is **already imported** at the top of `CollectionBuilderPage.tsx` (line 14). No import change needed.

---

## Edge cases

| Case | Behavior |
|------|----------|
| **Question with options** | All `options` are deep-copied; new question starts with identical choices. |
| **Question with an "Other" option** | `OTHER_OPTION_MARKER` is preserved because it lives in the `options` array. |
| **Custom Table (`custom_table`)** | `tableColumns` objects are cloned so the copy is independent. |
| **Matrix Likert** | Stored as a JSON string in `options[0]`; copied as a string, so the config is preserved. The matrix config wizard key is **not** carried over — the copy is a normal, fully editable field. |
| **Document field** | Config is serialized into `options`; array spread handles it. |
| **Comment / read-only** | HTML label copied by value; safe. |
| **Branch rules** | `branchRules` objects are cloned so editing one doesn't affect the other. |
| **Same page guarantee** | Copy inherits `page`, so it stays on the source's builder page and appears directly below the original. |
| **Last remaining field** | If `fields.length === 1` before the copy, `copyField` still produces a second field, so there are now two — no empty-field fallback is triggered (that only happens on `removeField`). |
| **Unsaved changes** | The copy lives only in `fields` state until the user saves, consistent with all other builder edits. |
| **Ticket fields** | Ticket templates have their own `ticketFields` state and a separate `updateTicketField`. This plan targets the **collection question** builder only (`fields`). Copying ticket template fields is out of scope unless requested. |

---

## Files touched

- `client/src/pages/CollectionBuilderPage.tsx` — only file changed.
  - Add `copyField` helper (near `moveField`).
  - Add `onCopy` to `FieldCardProps` + destructure it.
  - Render a copy button in the `FieldCard` header button group.
  - Pass `onCopy={() => copyField(field._key)}` at the `visibleFields` call site.

No server routes, DB migrations, or type definition changes are required — this is a pure client-side UX feature.

---

## Verification

1. Open a collection in the Builder.
2. Create a **Multiple Choice** question with 5 options (as in the screenshot).
3. Click the **copy** icon.
4. Confirm a **second, identical question appears directly below** the first, with all 5 options intact.
5. Edit an option on the copy → verify the original's options **do not** change (independent arrays).
6. Move / delete / rename the copy independently of the original.
7. Save the collection; reload and confirm the duplicated question persists in the saved collection.
8. Repeat across field types (single choice, custom table, matrix, document) to confirm options/columns are duplicated.
