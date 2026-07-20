# Plan: Restore a Collection Version & Confirm Field Removal

## Overview

Two distinct improvements to the Collection Builder:

1. **Restore a Previous Version** — Allow an editor to roll the active collection back to any previously saved version directly from the Versions tab.
2. **Confirm Before Removing a Field** — Require a confirmation step before a field is permanently deleted from the form builder.

---

## 1. Restore a Previous Version

### Current State

The **Versions** tab in the Collection Builder (`CollectionBuilderPage.tsx`) shows a list of versions and a diff between any two chosen versions. The user can see _what changed_ but there is no way to load a past version's content back into the builder or make a past version the active one.

The existing `publishCollectionVersion` API (`POST /api/collections/:id/versions/:versionId/publish`) only moves a version into `published` status and sets `active_version_id`. It does not restore a draft version's _field content_ into the builder for editing.

---

### Desired Behaviour

- In the Versions tab, each version row gets a **"Restore"** button.
- Clicking "Restore" on a non-active version:
  1. Fetches the full snapshot of that version (already available via `getCollectionVersion`).
  2. Loads the snapshot's fields, metadata, and settings into the builder form state (using the existing `applyCollectionToForm` function).
  3. Triggers an **auto-save** so the current draft version is immediately updated with the restored content, _or_ optionally creates a new draft version from the snapshot.
- The user sees a toast confirming the restore: `"Form restored to v{N}"`.
- A confirmation dialog is shown before the restore if the current form has unsaved changes (detected via a `isDirty` flag).

---

### Implementation Plan

#### A. Client — `CollectionBuilderPage.tsx`

1. **Add `isDirty` tracking**
   - Add a `isDirty` state (boolean, default `false`).
   - Set it to `true` on any form-state change after initial load (piggyback on the autosave `useEffect`).
   - Reset it to `false` after a successful save or after a restore.

2. **Add `handleRestoreVersion(versionId: number)` function**
   ```
   async function handleRestoreVersion(versionId: number) {
     if (isDirty) {
       // Show inline confirmation: "You have unsaved changes. Restore will overwrite them."
       if (!window.confirm(...)) return
     }
     const snapshot = versionSnapshots[versionId] ?? await getCollectionVersion(parseInt(id!, 10), versionId)
     applyCollectionToForm(snapshot)
     setIsDirty(false)
     showToast(`Form restored to v${snapshot.currentVersionNumber ?? versionId}`, 'success')
     // Trigger save so the active draft reflects the restored content
     await doSave({ silent: true })
   }
   ```

3. **Versions tab UI — add Restore button per version row**
   - For every version card in the Versions tab, render a `<button>` labelled **"Restore"** (with a `RotateCcw` icon from lucide-react).
   - Disable the button on the currently active version (already loaded).
   - Style consistently with the existing tab action buttons (small, secondary style).

4. **Optional — "Restore as New Version" flow**
   - Instead of overwriting the current draft in-place, call `createCollectionVersion` with the snapshot payload, then load the new version.
   - Keeps full audit history intact. This is the preferred approach for published collections.
   - Add a secondary button **"Branch from this version"** that triggers this path.

#### B. Server — No new endpoint required (initially)

The existing endpoints are sufficient:

| Need | Endpoint |
|---|---|
| Read a version's full field snapshot | `GET /api/collections/:id/versions/:versionId` |
| Save restored content to the current draft | `PUT /api/collections/:id` (existing update) |
| Create a new draft from a snapshot | `POST /api/collections/:id/versions` (existing) |
| Promote a version to active/published | `POST /api/collections/:id/versions/:versionId/publish` |

If a dedicated "restore" endpoint is desired for atomicity, add:

```
POST /api/collections/:id/versions/:versionId/restore
```

This would:
1. Copy the snapshot's fields and metadata into a **new** draft version.
2. Set `active_version_id` to the new version (still as draft, not published).
3. Return the updated collection.

This keeps a clean audit trail and avoids mutating historical version records.

---

### UX Flow (summary)

```
Versions Tab
  └─ Version list (v3, v2, v1, ...)
       └─ Each row: [label] [status badge] [date] [Restore ↺] [Branch ⎇]
            │
            ▼  (click Restore on v1)
       Confirmation if dirty → "Overwrite current draft with v1?"
            │
            ▼
       applyCollectionToForm(v1 snapshot)
       doSave({ silent: true })   ← saves as new draft or updates current draft
            │
            ▼
       Toast: "Form restored to v1"
```

---

## 2. Confirm Before Removing a Field

### Current State

In `CollectionBuilderPage.tsx`, the `removeField(key)` function deletes the field immediately when the trash icon button is clicked. There is no confirmation step.

```tsx
// Current — immediate deletion
function removeField(key: string) {
  setFields(prev => {
    const next = prev.filter(f => f._key !== key)
    return next.length > 0 ? next : [blankField()]
  })
}
```

---

### Desired Behaviour

- Clicking the **trash icon** on a field opens a small confirmation prompt.
- The prompt should clearly name the field being deleted: `"Remove field: [Field Label]?"`
- Two actions: **Confirm Remove** (destructive, red) and **Cancel**.
- If the field has no label yet (blank/new field), skip the confirmation and remove immediately.

---

### Implementation Plan

#### A. Inline confirmation state (no modal needed)

Add a `pendingRemoveKey` state: `string | null`. When set, the matching field row renders an inline confirmation bar instead of the normal controls.

```tsx
const [pendingRemoveKey, setPendingRemoveKey] = useState<string | null>(null)
```

**Trash button click:**
```tsx
onClick={() => {
  if (!field.label.trim()) {
    removeField(field._key)   // blank field — no confirm needed
  } else {
    setPendingRemoveKey(field._key)
  }
}}
```

**Inline confirmation UI (rendered in the field card when `pendingRemoveKey === field._key`):**
```tsx
<div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 ...">
  <span>Remove "{field.label}"?</span>
  <button onClick={() => { removeField(field._key); setPendingRemoveKey(null) }}
          className="...red destructive button...">
    Remove
  </button>
  <button onClick={() => setPendingRemoveKey(null)}
          className="...cancel button...">
    Cancel
  </button>
</div>
```

**Reset pending remove** if the field list changes externally (version restore, etc.):
```tsx
useEffect(() => { setPendingRemoveKey(null) }, [fields.length])
```

#### B. Alternative — Modal dialog

If the team prefers a modal, use the existing pattern from the codebase (e.g., similar to `TableWizardModal`) with a controlled `isOpen` boolean and a small confirmation dialog component. This is slightly heavier but gives a more polished feel.

Recommended approach: **inline confirmation** for speed, since it avoids the visual jump of a modal for a simple destructive action.

---

## Files Affected

| File | Change |
|---|---|
| `client/src/pages/CollectionBuilderPage.tsx` | Add `isDirty`, `pendingRemoveKey`, `handleRestoreVersion`; update versions tab UI; update field card trash button |
| `server/src/routes/collections.ts` | Optional: add `POST /:id/versions/:versionId/restore` endpoint |
| `client/src/api/collections.ts` | Optional: add `restoreCollectionVersion()` if a dedicated endpoint is added |

---

## Open Questions

1. **Restore target**: Should "Restore" overwrite the _current draft version_ in-place, or always create a _new draft version_ (preferred for auditability)?
2. **Permission guard**: Should restore be limited to `administrator` / `team_manager` roles, or available to anyone who can edit the collection?
3. **Field removal on published collections**: Should the confirm dialog include a stronger warning (e.g., "Submissions already collected for this field may lose data") when the collection status is `published`?
4. **Dirty-state detection**: Use the autosave timer's `useEffect` dependency array to mark dirty, or compare current form state against the last-saved server state?
