# Organizing Settings — Dynamic Tabs with Role-Based Visibility

**Date:** 2026-07-23  
**Status:** Draft — Awaiting Review

---

## Executive Summary

Replace the hardcoded two-tab system (`general` / `other`) on the Settings page with a **dynamic, database-driven tab framework**. Super Admins can create, rename, reorder, and delete tabs, and assign each tab a visibility level (`all` or `super_admin_only`). Tabs marked `super_admin_only` are hidden from regular Administrators. The existing drag-and-drop panel reordering via `@dnd-kit` is preserved and extended to support the dynamic tab model.

---

## Scope

### Included

- New `settings_tabs` database table to store tab definitions.
- Server-side CRUD routes for tab management (Super Admin only).
- A "Manage Tabs" panel inside the Settings page for Super Admins to create, rename, reorder, and delete tabs.
- Role-based filtering: tabs marked `super_admin_only` are hidden from Administrators.
- Migration of existing hardcoded `general`/`other` tabs into the new database table.
- Evolution of the `PanelLayout` type from `Record<TabId, PanelId[]>` to `Record<string, PanelId[]>` to support arbitrary tab IDs.
- Preservation of existing `@dnd-kit` drag-and-drop between and within tabs, with tabs rendering dynamically from the database.

### Excluded

- Per-organization tab configurations (this is a global/system-level feature).
- Row-level visibility per individual panel (panels remain grouped into tabs as today).
- Changes to the panel rendering logic itself (each panel's `renderPanel` switch case is not modified).

---

## Step-by-Step Implementation Guide

### Step 1: Database Schema — Add `settings_tabs` Table

**File:** `server/src/database/schema.ts`

Add a new table definition inside `createSchema()`:

```sql
CREATE TABLE IF NOT EXISTS settings_tabs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  slug        TEXT    NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  visible_to  TEXT    NOT NULL DEFAULT 'all'
                      CHECK(visible_to IN ('all', 'super_admin_only')),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

Also add an index on `sort_order`:

```sql
CREATE INDEX IF NOT EXISTS idx_settings_tabs_sort ON settings_tabs(sort_order);
```

### Step 2: Add Migration Script

**File:** `server/scripts/migrate-settings-tabs.mjs`

A standalone migration script that:
1. Creates the `settings_tabs` table (using `CREATE TABLE IF NOT EXISTS`).
2. Checks if the table is empty; if so, seeds two default tabs:
   - `{ name: 'General', slug: 'general', sort_order: 0, visible_to: 'all' }`
   - `{ name: 'Other', slug: 'other', sort_order: 1, visible_to: 'all' }`
3. Copies existing panel assignments from the `settings_panel_layout` user preference (if any) to preserve the user's current layout under the new tab IDs.

The script should be idempotent — safe to run multiple times.

### Step 3: Server API Routes

**File:** `server/src/routes/settings.ts`

Add five new routes (all require authentication + `super_admin` role):

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/settings/tabs` | List all tabs, sorted by `sort_order`. |
| `POST` | `/api/settings/tabs` | Create a new tab. Body: `{ name, slug, visible_to }`. Auto-assign `sort_order` to the end. |
| `PUT` | `/api/settings/tabs/:id` | Update tab name, visibility, or sort order. Body: `{ name?, visible_to?, sort_order? }`. |
| `DELETE` | `/api/settings/tabs/:id` | Delete a tab. Reassign any panels currently in this tab to the first remaining tab. |
| `PUT` | `/api/settings/tabs/reorder` | Batch reorder tabs. Body: `{ orderedIds: number[] }`. |

Also modify the existing `GET /api/settings/:key` and `PUT /api/settings/:key` routes to include `settings_tabs` in the allowed set if needed (unlikely — tabs are a separate resource).

**Authorization check:**
```typescript
if (req.user?.role !== 'super_admin') {
  res.status(403).json({ error: 'Super admin access required' })
  return
}
```

### Step 4: Client-Side API Module

**File:** `client/src/api/settings.ts` (new file, or add to existing settings API module)

Functions:

```typescript
export interface SettingsTab {
  id: number
  name: string
  slug: string
  sortOrder: number
  visibleTo: 'all' | 'super_admin_only'
}

export async function listSettingsTabs(): Promise<SettingsTab[]>
export async function createSettingsTab(data: { name: string; slug: string; visibleTo: 'all' | 'super_admin_only' }): Promise<SettingsTab>
export async function updateSettingsTab(id: number, data: Partial<{ name: string; visibleTo: 'all' | 'super_admin_only'; sortOrder: number }>): Promise<SettingsTab>
export async function deleteSettingsTab(id: number): Promise<void>
export async function reorderSettingsTabs(orderedIds: number[]): Promise<void>
```

### Step 5: Update SettingsPage State & Types

**File:** `client/src/pages/SettingsPage.tsx`

#### 5a. Type Changes

Replace:
```typescript
type TabId = 'general' | 'other'
type PanelLayout = Record<TabId, PanelId[]>
```

With:
```typescript
type PanelLayout = Record<string, PanelId[]>  // tab slug → panel IDs
```

#### 5b. Remove Hardcoded Default

Remove `DEFAULT_PANEL_LAYOUT` and `ALL_PANEL_IDS` (or derive them from the loaded tabs).

#### 5c. Load Tabs on Mount

In the `useEffect` that loads preferences, also fetch tabs:
```typescript
listSettingsTabs()
  .then(tabs => {
    const visibleTabs = user?.role === 'super_admin'
      ? tabs
      : tabs.filter(t => t.visibleTo === 'all')
    setAvailableTabs(visibleTabs)
    // Initialize panelLayout from loaded layout preference or default from tabs
  })
```

#### 5d. State Additions

```typescript
const [availableTabs, setAvailableTabs] = useState<SettingsTab[]>([])
const [activeTab, setActiveTab] = useState<string>('general')  // string instead of TabId
const [manageTabsExpanded, setManageTabsExpanded] = useState(false)
// Tab CRUD state:
const [newTabName, setNewTabName] = useState('')
const [newTabSlug, setNewTabSlug] = useState('')
const [newTabVisibility, setNewTabVisibility] = useState<'all' | 'super_admin_only'>('all')
const [editingTabId, setEditingTabId] = useState<number | null>(null)
const [editingTabName, setEditingTabName] = useState('')
const [tabSaving, setTabSaving] = useState(false)
const [tabError, setTabError] = useState<string | null>(null)
```

#### 5e. Merge Layout Logic Update

`mergeStoredLayout` must now handle dynamic tab keys:
```typescript
function mergeStoredLayout(stored: unknown, tabs: SettingsTab[]): PanelLayout {
  // Start with tabs as keys, empty arrays as default
  const defaultLayout: PanelLayout = {}
  for (const tab of tabs) {
    defaultLayout[tab.slug] = []
  }
  // Assign default panel groupings (later step — or keep all panels in first tab by default)
  // Overlay stored layout on top
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return defaultLayout
  const s = stored as Record<string, unknown>
  const result = { ...defaultLayout }
  for (const [key, val] of Object.entries(s)) {
    if (Array.isArray(val)) {
      result[key] = val.filter(id => ALL_PANEL_IDS.includes(id as PanelId)) as PanelId[]
    }
  }
  // Ensure all panels are present somewhere
  const assigned = new Set(Object.values(result).flat())
  for (const id of ALL_PANEL_IDS) {
    if (!assigned.has(id)) {
      result[tabs[0].slug].push(id)
    }
  }
  return result
}
```

#### 5f. Tab Rendering

Replace the hardcoded tab buttons:
```tsx
<div className="flex border-b border-[#E2E8F0] dark:border-[#334155] mb-6">
  {availableTabs.map(tab => (
    <DroppableTabButton
      key={tab.slug}
      tab={tab.slug}
      label={tab.name}
      isActive={activeTab === tab.slug}
      isDragging={draggingId !== null}
      onClick={() => setActiveTab(tab.slug)}
    />
  ))}
</div>
```

#### 5g. "Manage Tabs" Panel (Super Admin Only)

Add a new `PanelId` entry `'manage-tabs'` (or a new panel within the first tab) with CRUD UI:

- **List View:** Table showing tab name, slug, visibility badge, sort order.
- **Create:** Form with name, slug, visibility dropdown, and "Add Tab" button.
- **Edit:** Inline edit for name and visibility.
- **Delete:** Delete button with confirmation. Deleting a tab moves its panels to the first remaining tab.
- **Reorder:** Up/down arrow buttons or drag handles to reorder tabs (simpler than integrating `@dnd-kit` for tab ordering within a panel). On reorder, call `reorderSettingsTabs`.

#### 5h. Drag-and-Drop Adjustments

The `DroppableTabButton` component currently uses `tab: TabId` — change this to accept `tab: string`. The collision detection already uses `drop-tab-{tab}` prefix matching, so it works with any string tab ID natively.

The `handleDragEnd` function's tab references (`'drop-tab-general'` / `'drop-tab-other'`) must be generalized to check against `availableTabs.map(t => 'drop-tab-' + t.slug)`.

#### 5i. Preference Persistence

The `settings_panel_layout` preference continues to be saved/loaded as before. When tabs change (add/delete/rename), the stored layout must be migrated:
- If a tab is deleted, its panels are moved to the first remaining tab in the stored preference.
- If a tab is renamed, the old slug key is renamed in the stored layout.

### Step 6: Reorder API for Panels (Existing — No Changes)

No changes needed for panel drag-and-drop persistence — `updatePreference` already handles this. The only change is that the stored layout keys are now dynamic slugs rather than hardcoded `'general'` / `'other'`.

---

## Impacted Files

| File | Change Type | Summary |
|------|-------------|---------|
| `server/src/database/schema.ts` | **Edit** | Add `settings_tabs` table and index |
| `server/scripts/migrate-settings-tabs.mjs` | **New** | Migration script to seed default tabs and migrate existing layout |
| `server/src/routes/settings.ts` | **Edit** | Add tab CRUD routes (GET/POST/PUT/DELETE for `/api/settings/tabs`, PUT for reorder) |
| `client/src/api/settings.ts` | **New** (or edit existing) | Client API functions for tab CRUD |
| `client/src/pages/SettingsPage.tsx` | **Major Edit** | Replace `TabId`/`PanelLayout` types, load tabs dynamically, add "Manage Tabs" panel, update drag-drop handlers, render tabs dynamically |

---

## Rollback / Verification Plan

### Verification

1. **Database:** Run `SELECT * FROM settings_tabs` — two default tabs should exist after migration.
2. **Super Admin UI:** Navigate to Settings — both default tabs ("General", "Other") should appear. Panels should be in their previous layout.
3. **Admin UI:** Navigate to Settings as a non-Super-Admin Administrator — only tabs with `visible_to = 'all'` should appear.
4. **Tab CRUD:** Create a new tab `"Restricted"` with `visible_to = 'super_admin_only'`. It should appear for Super Admin but not for Administrator.
5. **Drag-and-Drop:** Drag a panel from one tab to another — it should move and persist on page reload.
6. **Delete Tab:** Delete a tab — its panels should move to the first remaining tab for all users.

### Rollback

If the migration fails or needs reverting:
1. Delete the `settings_tabs` table: `DROP TABLE IF EXISTS settings_tabs;`
2. Revert the `SettingsPage.tsx` changes to the hardcoded `general`/`other` tab system.
3. Remove the new server routes from `settings.ts`.
4. The `settings_panel_layout` user preference will continue to work with the old code since the old keys (`general`/`other`) are the default tab slugs anyway.

---

## Notes

- The `DropableTabButton` component already supports dynamic drop zones via the `drop-tab-` prefix pattern. This makes the transition to dynamic tabs straightforward.
- Tab slugs are stored in the database. The `general` slug should be reserved/created by the migration to avoid breaking references.
- The "Manage Tabs" panel itself could be placed in a persistent first tab (e.g., "General") or as a floating panel outside the tab/drag system to keep it always accessible. The plan places it as a regular panel (`'manage-tabs'`) that can be dragged like any other — Super Admins will see it; Administrators will not (since the render logic checks `user?.role === 'super_admin'` within the panel renderer itself).