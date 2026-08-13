# Visibility Settings — Super Admin Panel Checklist

**Date:** 2026-08-13
**Author:** Copilot
**Status:** Draft — pending review
**Related:** `client/src/pages/SettingsPage.tsx` (`PanelId`, `PanelLayout`, `PANEL_LABELS`, `ALL_PANEL_IDS`), `server/src/routes/settings.ts` (`ALLOWED_KEYS`, `settings_tabs`), `server/src/database/schema.ts` / `server/src/database/db.ts` (`app_settings`, `settings_tabs`), `client/src/api/settings.ts`

---

## 1. Goal

Add a new **"Visibility Settings"** panel that is **Super Admin only** and lets a Super Admin control which Settings panels an **Administrator** can see.

- It is a checklist of every Settings panel (e.g. Organizations, Categories, Users, Locations, Gallery, etc.).
- **Checked = visible to Administrators.** Unchecked = hidden from Administrators.
- Visibility is **per-panel, not per-tab** — it applies regardless of which tab the panel is currently assigned to via drag-and-drop / `settings_panel_layout`.
- Super Admins always see every panel regardless of this setting (so they can never lock themselves out).
- Default when no value has been saved yet: **all panels visible** (backward compatible).

---

## 2. Current Behavior

| Layer | Behavior |
|-------|----------|
| **Client** `SettingsPage.tsx` | `PanelId` union (18 ids: `organizations`, `categories`, `notifications`, `login-page`, `navigation`, `menu-labels`, `users`, `groups`, `locations`, `gallery`, `archived-collections`, `qr-code`, `logo-padding`, `database-mode`, `document-storage`, `api`, `seed`, `manage-tabs`) + `PANEL_LABELS` + `ALL_PANEL_IDS` + `DEFAULT_PANEL_LAYOUT` (`general` / `other`). `mergeStoredLayout()` ensures every `ALL_PANEL_IDS` appears somewhere. Rendering filters only `manage-tabs` for non-super-admins: `.filter(id => id !== 'manage-tabs' \|\| isGlobalAdmin)`. No per-panel visibility for Administrators. |
| **Tabs** `settings_tabs` | Tab-level visibility via `visible_to` (`all` vs `super_admin_only`). Client filters `availableTabs` for non-super-admins. No panel-level visibility. |
| **Server** `server/src/routes/settings.ts` | `ALLOWED_KEYS` set for `app_settings` keys (`login_message`, `login_subtitle`, etc.). Generic `GET /api/settings/:key` (public) and `PUT /api/settings/:key` (admin/super_admin). No key for panel visibility. No dedicated visibility endpoint. |
| **DB** `app_settings` | `key TEXT PRIMARY KEY, value TEXT`. Used for all app-wide settings. No row for panel visibility yet. |

---

## 3. Desired Behavior

1. Super Admin opens **Settings** → sees a new panel **"Visibility Settings"** (only Super Admins see this panel).
2. Panel shows a checklist — one row per `PanelId` (except itself and `manage-tabs` which are always super_admin-only). Each row shows `PANEL_LABELS[id]` + checkbox.
3. Checked = that panel will be rendered for Administrators. Unchecked = hidden from Administrators.
4. Super Admin can **Select All / Deselect All** and **Save**. Save persists to the server.
5. When an Administrator loads Settings, the page fetches the visibility list and **filters** `panelLayout[activeTab]` to only visible ids. Hidden panels are not rendered, not draggable, and not counted.
6. If a tab ends up with zero visible panels for an Administrator, the tab **remains visible** but shows an empty-state message (e.g. "No settings available in this tab."). Super Admin still sees all panels.
7. Drag-and-drop is **Super Admin only** — Administrators see a static list with no drag handles. Visibility is applied as a filter on top of layout, not stored in layout.
8. Server validates the payload against the known `PanelId` allowlist.

---

## 4. Data Model

### Option A — Reuse `app_settings` (recommended, no migration)

Add one new key to `ALLOWED_KEYS`:

- **Key:** `admin_visible_panels`
- **Value:** JSON stringified `PanelId[]` — the list of panel ids that are **visible** to Administrators.

Example value:

```json
["organizations","categories","notifications","login-page","navigation","menu-labels","users","groups","locations","gallery","archived-collections","qr-code","logo-padding","database-mode","document-storage","api","seed"]
```

- If the row does not exist → treat as **all panels visible** (except `manage-tabs` + `visibility-settings` which are always super_admin-only).
- If the row exists but is `[]` → Administrators see no panels (edge case — show empty state).
- `visibility-settings` itself is **never** included in the stored array — it is implicitly super_admin-only.

**Why this option:** No new table, no schema migration, consistent with how `login_message`, `database_mode`, etc. are stored. Works on both Turso and SQL Server via existing `INSERT ... ON CONFLICT(key) DO UPDATE` path. Startup migrations already handle `app_settings`.

### Option B — New table `settings_panel_visibility` (alternative, not recommended for v1)

```sql
CREATE TABLE IF NOT EXISTS settings_panel_visibility (
  panel_id TEXT PRIMARY KEY,
  visible_to_admin INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

More queryable but heavier for a simple checklist. Only consider if per-panel audit or per-org visibility is needed later.

**Decision for this plan: Option A.**

---

## 5. API Design

### Reuse existing `app_settings` endpoints (minimal change)

Add `'admin_visible_panels'` to `ALLOWED_KEYS` in `server/src/routes/settings.ts`.

- `GET /api/settings/admin_visible_panels` — currently public in the generic handler. For this key, require `authenticateToken` and allow `administrator` + `super_admin` to read. Return `{ key, value }` where `value` is the JSON array string. If no row, return `{ key, value: JSON.stringify(allVisibleIds) }` or 404 and let client fall back to "all visible".
- `PUT /api/settings/admin_visible_panels` — already requires `authenticateToken` + admin check. Tighten to **super_admin only** for this key (return 403 for administrators). Validate `value` is a JSON array of known `PanelId`s.

**Validation:** Add Zod schema in `server/src/lib/schemas.ts`:

```ts
export const adminVisiblePanelsSchema = z.object({
  value: z.string().refine(val => {
    try {
      const arr = JSON.parse(val)
      return Array.isArray(arr) && arr.every(id => ALL_PANEL_IDS.includes(id))
    } catch { return false }
  }, { message: 'value must be a JSON array of valid PanelIds' })
})
```

Or validate inside the route handler before `INSERT`.

### Dedicated endpoints (alternative, cleaner auth)

If we want stricter auth without overloading the generic handler:

- `GET /api/settings/visibility` — `authenticateToken`, allowed `administrator` + `super_admin`, returns `{ visiblePanelIds: PanelId[] }`.
- `PUT /api/settings/visibility` — `authenticateToken`, `super_admin` only, body `{ visiblePanelIds: PanelId[] }`, validates against allowlist, persists to `app_settings` (`admin_visible_panels`).

Either approach is fine — dedicated endpoints are slightly more explicit and avoid making `GET /:key` authenticated for one key. Recommend **dedicated endpoints** and keep `admin_visible_panels` out of the public `GET /:key` path (return 404 for unauthenticated).

---

## 6. Client Design

### 6.1 New `PanelId` and constants

In `client/src/pages/SettingsPage.tsx`:

```ts
type PanelId =
  | 'organizations'
  // ... existing
  | 'manage-tabs'
  | 'visibility-settings'   // ← new

const PANEL_LABELS: Record<PanelId, string> = {
  // ... existing
  'manage-tabs': 'Manage Tabs',
  'visibility-settings': 'Visibility Settings',
}

const ALL_PANEL_IDS: PanelId[] = [
  // ... existing, plus 'visibility-settings'
]

// Panels that are always super_admin-only and never shown in the checklist
const VISIBILITY_EXCLUDED: PanelId[] = ['manage-tabs', 'visibility-settings']

// Checklist = ALL_PANEL_IDS minus excluded
const VISIBILITY_CHECKLIST_IDS: PanelId[] = ALL_PANEL_IDS.filter(id => !VISIBILITY_EXCLUDED.includes(id))
```

Add to `DEFAULT_PANEL_LAYOUT` — place `visibility-settings` in `general` or `other` (recommend `general` last, or a dedicated position). Since `mergeStoredLayout` auto-assigns missing panels to `tabs[0]`, it will appear even without explicit placement, but explicit is clearer.

### 6.2 New API helpers

In `client/src/api/settings.ts`:

```ts
export async function getAdminVisiblePanels(): Promise<string[]> {
  const res = await fetch('/api/settings/visibility', { headers: authHeaders() })
  return handleResponse<{ visiblePanelIds: string[] }>(res).then(d => d.visiblePanelIds)
}

export async function updateAdminVisiblePanels(visiblePanelIds: string[]): Promise<void> {
  const res = await fetch('/api/settings/visibility', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ visiblePanelIds }),
  })
  return handleResponse<void>(res)
}
```

Or if reusing `app_settings`:

```ts
export async function getAdminVisiblePanels(): Promise<string[]> {
  const raw = await getPublicSetting('admin_visible_panels') // or authenticated fetch
  try { return JSON.parse(raw) } catch { return [...VISIBILITY_CHECKLIST_IDS] }
}
```

### 6.3 Visibility Settings panel UI (Super Admin only)

New `case 'visibility-settings':` in `renderPanel()`:

- Header: icon `Eye` / `EyeOff`, title "Visibility Settings", subtitle "Choose which Settings panels Administrators can see. Checked = visible."
- Body (only if `isGlobalAdmin`):
  - `Select All` / `Deselect All` buttons.
  - List of checkboxes: `VISIBILITY_CHECKLIST_IDS.map(id => <label><input type="checkbox" checked={draft.includes(id)} onChange={toggle(id)} /> {PANEL_LABELS[id]}</label>)`
  - Save button → `updateAdminVisiblePanels(draft)` → show Saved! / error.
  - On mount, fetch current value via `getAdminVisiblePanels()` → populate `draft` and `saved` state.
  - While loading, show "Loading visibility…".
  - On save, update local `adminVisiblePanels` state so the current session reflects the change immediately.

State:

```ts
const [visibilityDraft, setVisibilityDraft] = useState<PanelId[]>([])
const [visibilitySaved, setVisibilitySaved] = useState<PanelId[]>([])
const [visibilityLoading, setVisibilityLoading] = useState(false)
const [visibilitySaving, setVisibilitySaving] = useState(false)
const [visibilityError, setVisibilityError] = useState<string | null>(null)
const [visibilitySavedOk, setVisibilitySavedOk] = useState(false)
```

### 6.4 Filtering for Administrators

After loading `adminVisiblePanels` (or defaulting to all), compute:

```ts
const [adminVisiblePanels, setAdminVisiblePanels] = useState<PanelId[] | null>(null) // null = not loaded yet / super_admin sees all

// After fetch — new panels default to visible (decision 1):
// If no row exists → all VISIBILITY_CHECKLIST_IDS visible.
// If row exists → visible = stored ∪ any new ids not yet in storage.
const visibleSet = isGlobalAdmin
  ? null
  : new Set(adminVisiblePanels === null ? VISIBILITY_CHECKLIST_IDS : [...adminVisiblePanels, ...VISIBILITY_CHECKLIST_IDS.filter(id => !adminVisiblePanels.includes(id))])

// In render:
const panelsForTab = (panelLayout[activeTab] ?? []).filter(id => {
  if (isGlobalAdmin) return true
  if (id === 'visibility-settings' || id === 'manage-tabs') return false
  return visibleSet!.has(id)
})

// Tab bar: all tabs remain visible for Administrators (decision 3) — empty tabs show a message instead of being hidden
const tabsForRole = availableTabs // no filtering; empty state handled in render
```

- `SortableContext items` should receive the filtered list (`panelsForTab`), not the raw layout.
- `handleDragEnd` persists the full `panelLayout` (including hidden panels) so Super Admin ordering is preserved.
- **Dragging is Super Admin only (decision 2):** Administrators render panels without `SettingsSortablePanel` drag handles and with `DndContext` disabled (or `sensors` disabled / `SortableContext` not rendered). Super Admins retain full drag-and-drop within and across tabs.
- Empty tab for Administrator: if `panelsForTab.length === 0`, render `<p className="text-sm text-[#64748B]">No settings available in this tab.</p>` instead of the sortable list.

### 6.5 Loading sequence

1. Load `availableTabs` + `panelLayout` (existing effect).
2. In parallel, if `user.role === 'administrator'`, fetch `adminVisiblePanels` (or if `super_admin`, fetch for editing the checklist).
3. Until visibility is loaded, show all panels (or skeleton) to avoid flash — then filter.

---

## 7. Implementation Steps

1. **Server — allowlist + endpoints**
   - Add `'admin_visible_panels'` to `ALLOWED_KEYS` (if reusing generic handler) or create dedicated `GET /api/settings/visibility` + `PUT /api/settings/visibility`.
   - Add Zod validation for the payload (array of known `PanelId`s).
   - Enforce `super_admin` only for `PUT`; allow `administrator` + `super_admin` for `GET`.
   - Ensure `GET` returns all-visible default when no row exists.

2. **Server — DB**
   - No schema migration needed for Option A. Optionally seed `admin_visible_panels` with all ids on first read (or leave absent and treat as all visible).

3. **Client — constants**
   - Add `'visibility-settings'` to `PanelId`, `PANEL_LABELS`, `ALL_PANEL_IDS`, `DEFAULT_PANEL_LAYOUT`.

4. **Client — API**
   - Add `getAdminVisiblePanels` / `updateAdminVisiblePanels` in `client/src/api/settings.ts`.

5. **Client — SettingsPage**
   - Add visibility state + fetch effect (merge stored + new ids → default visible).
   - Add `case 'visibility-settings':` panel with checklist UI (Select All / Deselect All / Save).
   - Add filtering logic for `panelsForTab`; keep `tabsForRole = availableTabs` and render empty-state message when `panelsForTab.length === 0`.
   - Ensure `visibility-settings` and `manage-tabs` are always filtered out for non-super-admins.
   - Gate drag-and-drop to Super Admin only: conditionally render `DndContext`/`SortableContext`/`SettingsSortablePanel` for Super Admin; Administrators render static panels. Update `DragOverlay` accordingly.

6. **Docs**
   - Update `docs/APPLICATION_GUIDE.md` Settings section to mention Visibility Settings.

7. **Testing**
   - Manual: Super Admin checks/unchecks → Administrator refreshes → panels appear/disappear regardless of tab assignment. Drag a hidden panel to another tab as Super Admin → Administrator still doesn't see it.
   - Verify `PUT` as Administrator → 403.
   - Verify default (no row) → Administrator sees all.

---

## 8. Edge Cases & Decisions

| Case | Handling |
|------|----------|
| No `admin_visible_panels` row yet | Treat as all `VISIBILITY_CHECKLIST_IDS` visible. |
| Super Admin unchecks everything | Administrator sees empty Settings (show "No settings available" empty state). Super Admin still sees all. |
| New `PanelId` added in future | **Defaults to visible** for Administrators (decision 1). Client merges stored array with `VISIBILITY_CHECKLIST_IDS` — any id not yet in storage is treated as visible. No migration needed; Super Admin can uncheck it later. |
| `visibility-settings` itself | Never shown to Administrators, never in checklist, always visible to Super Admin. |
| `manage-tabs` | Already super_admin-only; exclude from checklist. |
| Tab with zero visible panels | **Show tab with empty-state message** "No settings available in this tab." (decision 3). Do not hide the tab. |
| `settings_panel_layout` contains hidden panels | Keep them in storage; just filter at render. Super Admin can still move them. |

---

## 9. Security

- Server is source of truth for visibility — client filtering is UX, but sensitive panel data is already protected by role checks on each panel's data endpoints (users, organizations, etc.). No new data leak.
- `PUT` must be `super_admin` only — add explicit check before `INSERT INTO app_settings`.
- Validate panel ids against allowlist to prevent storing arbitrary strings.

---

## 10. Future Improvements

- Per-organization visibility (e.g., different admin visibility per org) — would require moving from `app_settings` to a per-org table.
- Per-role visibility (e.g., `team_manager` vs `administrator` vs `reviewer` if reviewers ever see Settings).
- Audit log for visibility changes.

---

## 11. Decisions (Resolved 2026-08-13)

1. **New panels default to visible** for Administrators — any `PanelId` not yet in the stored `admin_visible_panels` array is treated as visible.
2. **Dragging is Super Admin only** — Administrators see a static, non-draggable list.
3. **Empty tabs show a message** — tabs with zero visible panels remain in the tab bar and render "No settings available in this tab." for Administrators.
