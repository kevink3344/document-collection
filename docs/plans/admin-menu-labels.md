# Admin Menu Labels

**Date:** 2026-07-21
**Author:** Copilot
**Status:** Draft — pending review

---

## Executive Summary

Today the left-hand sidebar labels (Dashboard, Collections, Records, Reports, Settings, Tickets) are hard-coded strings in `SideNav.tsx` and are identical for every organization. This plan adds a new **Admin Menu Labels** section under **Settings** that lets an organization's administrator (or a super admin managing any organization) rename these six sidebar menu items. Overrides are stored per-organization and applied to the sidebar for every user in that organization, across all roles that see the item (user, reviewer, team manager, administrator).

---

## Scope

### Included
- New **Admin Menu Labels** panel in `Settings > General`, following the same expandable-panel pattern as the other Settings sections (Categories, Organizations, etc.).
- Six customizable labels, keyed by a fixed identifier so renames don't break routing or icons:
  | Key | Default label | Route |
  |-----|---------------|-------|
  | `dashboard` | Dashboard | `/dashboard` |
  | `collections` | Collections | `/collections` |
  | `records` | Records | `/records` |
  | `reports` | Reports | `/reports` |
  | `settings` | Settings | `/settings` |
  | `tickets` | Tickets | `/ticket-designer` |
- Labels are stored **per organization** (not per user) — every member of the organization sees the same customized labels.
- `administrator` role can edit labels for their own active organization only. `super_admin` can pick any organization (same org-selector pattern used in the Categories panel) and edit its labels.
- Sidebar (`SideNav.tsx`) resolves labels for the current user's active organization and falls back to the defaults above when no override exists (or the override is blank).
- Each label field has a "Reset to default" action; blank input on save is treated as "use default" rather than storing an empty string.
- Applies to desktop sidebar, the mobile drawer, and the mobile bottom tab bar — all three render from the same `NAV_ITEMS` list in `SideNav.tsx`.

### Excluded
- Items that are conditionally shown and not in the fixed six (`AI Summary`, `Approvals`, `My Submissions`) are **not** customizable in this iteration.
- No re-ordering of menu items and no ability to hide/show a menu item (only the label text changes).
- No per-user override — labels are organization-wide only.
- No i18n/localization — this is a single free-text label per key.

---

## Data Model / Database Changes

### New table: `organization_menu_labels`

```sql
CREATE TABLE IF NOT EXISTS organization_menu_labels (
  organization_id    INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  labels             TEXT    NOT NULL DEFAULT '{}',
  updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

- `labels` is a JSON object storing only the **overridden** keys, e.g. `{"records":"Submissions","tickets":"Work Orders"}`. Missing keys mean "use the default".
- One row per organization (upsert on save); a brand-new organization simply has no row, so all defaults apply.
- `updated_by_user_id` / `updated_at` are for basic auditing, following the existing convention seen on `saved_export_presets`.

**Turso**: add table creation to `applyIncrementalSchema()` in [server/src/database/db.ts](../../server/src/database/db.ts) (same pattern used for `saved_export_presets`).

**SQLite local**: add the `CREATE TABLE IF NOT EXISTS` to [server/src/database/schema.ts](../../server/src/database/schema.ts) so fresh installs get it, and add a guarded entry in `runMigrations()` for existing local databases.

---

## API Design

Add two endpoints to [server/src/routes/organizations.ts](../../server/src/routes/organizations.ts) (keeps organization-scoped resources together, matching the existing router):

### `GET /api/organizations/:id/menu-labels`
- Auth required (`authenticateToken`).
- Access: `super_admin`, or a user who is a member of organization `:id` (any role) — this is what allows every role's `SideNav` to read the labels for their own active org, not just admins.
- Response merges stored overrides with defaults so the client always receives all six keys:
  ```json
  { "organizationId": 4, "labels": { "dashboard": "Dashboard", "records": "Submissions", ... } }
  ```

### `PUT /api/organizations/:id/menu-labels`
- Auth required.
- Access: `super_admin`, or `administrator` **and** `:id` matches the caller's active organization (reuse `resolveManagedOrganizationId` / `isAdminOrSuperAdmin` from [server/src/middleware/organizationAccess.ts](../../server/src/middleware/organizationAccess.ts)).
- Body: `{ labels: Partial<Record<MenuLabelKey, string>> }`.
- Server validation:
  - Only the six known keys are accepted; unknown keys are rejected with 400.
  - Each value is trimmed; empty string after trim is stored as "not overridden" (key omitted from the JSON blob) rather than saved as blank.
  - Max length (e.g. 40 chars) enforced to avoid breaking the sidebar layout — reject with 400 if exceeded.
- Upserts the row (`INSERT ... ON CONFLICT(organization_id) DO UPDATE`), returns the merged labels object (same shape as GET).

---

## Step-by-Step Implementation Guide

### Phase 1 — Database
1. **`server/src/database/schema.ts`** — add the `organization_menu_labels` table definition.
2. **`server/src/database/db.ts`** — add the same `CREATE TABLE IF NOT EXISTS` to `applyIncrementalSchema()` for Turso, and a guarded migration entry in `runMigrations()` for local SQLite installs that predate this change.

### Phase 2 — Server API
1. **`server/src/routes/organizations.ts`**
   - Add a shared list of valid keys: `const MENU_LABEL_KEYS = ['dashboard', 'collections', 'records', 'reports', 'settings', 'tickets'] as const`.
   - Add a `mergeWithDefaults(labels)` helper returning the full 6-key object.
   - `GET /:id/menu-labels` — verify membership (query `user_organizations` for the caller, or `super_admin`), load the row (if any), return merged labels.
   - `PUT /:id/menu-labels` — verify admin access to `:id`, validate/trim/whitelist keys, upsert the row, return merged labels.
2. No new router mounts needed — same `organizationsRouter` already registered in [server/src/index.ts](../../server/src/index.ts).

### Phase 3 — Client: Shared Constants & API Helper
1. **Create `client/src/utils/menuLabels.ts`**
   ```ts
   export const MENU_LABEL_KEYS = ['dashboard', 'collections', 'records', 'reports', 'settings', 'tickets'] as const
   export type MenuLabelKey = typeof MENU_LABEL_KEYS[number]
   export const DEFAULT_MENU_LABELS: Record<MenuLabelKey, string> = {
     dashboard: 'Dashboard',
     collections: 'Collections',
     records: 'Records',
     reports: 'Reports',
     settings: 'Settings',
     tickets: 'Tickets',
   }
   ```
2. **Create `client/src/api/menuLabels.ts`**
   ```ts
   export function getMenuLabels(organizationId: number): Promise<Record<MenuLabelKey, string>>
   export function updateMenuLabels(organizationId: number, labels: Partial<Record<MenuLabelKey, string>>): Promise<Record<MenuLabelKey, string>>
   ```
   Follows the fetch/error-handling pattern used in `client/src/api/settings.ts` (bearer token from `localStorage`, JSON error parsing).

### Phase 4 — Client: Sidebar Consumption
1. **`client/src/components/layout/SideNav.tsx`**
   - Add `labelKey?: MenuLabelKey` to the `NavItem` interface and set it on the six customizable entries across `NAV_ITEMS`, `USER_NAV_ITEMS`, and `REVIEWER_NAV_ITEMS` (`dashboard` appears in all three; `collections`/`records`/`reports` in `NAV_ITEMS`/`REVIEWER_NAV_ITEMS`; `settings`/`tickets` only in `NAV_ITEMS`).
   - New state: `const [menuLabels, setMenuLabels] = useState<Record<MenuLabelKey, string>>(DEFAULT_MENU_LABELS)`.
   - New effect keyed on the user's active organization (`user?.activeOrganizationId ?? user?.organizationId`): call `getMenuLabels(orgId)` and store the result; on error, silently keep defaults (same resilience pattern as the existing `getPublicSetting` calls in this file).
   - When rendering each `NavItem`, resolve the displayed text as `item.labelKey ? menuLabels[item.labelKey] : item.label` for all three render blocks (desktop nav, mobile drawer, mobile bottom bar).
   - Re-fetch whenever the resolved organization id changes (e.g. after `switchOrganization`), so switching orgs updates labels without a full page reload.

### Phase 5 — Client: Settings Panel
1. **`client/src/pages/SettingsPage.tsx`**
   - Add `'menu-labels'` to the `PanelId` union, `PANEL_LABELS` (`'Admin Menu Labels'`), and `DEFAULT_PANEL_LAYOUT.general` (placed after `'navigation'`).
   - New state: `menuLabelsExpanded`, `menuLabelsOrgId` (super-admin org selector, mirrors `categoriesOrgId`), `menuLabelsDraft: Record<MenuLabelKey, string>`, `menuLabelsSaving`, `menuLabelsError`, `menuLabelsSaved`.
   - Load effect: for `administrator`, load labels for the caller's own org on mount; for `super_admin`, load labels whenever `menuLabelsOrgId` changes (mirrors the `categoriesOrgId` effect already in the file). No org selected (super admin) ⇒ panel shows a prompt to pick an organization, matching the Categories panel's "select an organization" empty state.
   - Render a new `case 'menu-labels':` panel (same expandable-card shell as `case 'navigation':`) with:
     - Org selector (super admin only), reusing the `organizations` list already loaded for the Categories panel.
     - Six labeled text inputs (one per `MENU_LABEL_KEYS`), each pre-filled with the effective label (override or default) and a small "Reset" button that clears that field back to the default.
     - A single **Save** button that calls `updateMenuLabels(orgId, menuLabelsDraft)`, then updates local state and shows the existing Saving…/Saved! affordance used elsewhere on this page.

---

## Impacted Files

### New Files
| File | Purpose |
|------|---------|
| `client/src/utils/menuLabels.ts` | Shared keys + default labels. |
| `client/src/api/menuLabels.ts` | `getMenuLabels` / `updateMenuLabels` fetch helpers. |

### Existing Files to Edit
| File | Change |
|------|--------|
| `server/src/database/schema.ts` | Add `organization_menu_labels` table. |
| `server/src/database/db.ts` | Incremental (Turso) + guarded (local) migration for the new table. |
| `server/src/routes/organizations.ts` | Add `GET`/`PUT /:id/menu-labels`. |
| `client/src/components/layout/SideNav.tsx` | Add `labelKey` to nav items; fetch and apply org label overrides. |
| `client/src/pages/SettingsPage.tsx` | Add "Admin Menu Labels" panel (org selector + six inputs + save). |

---

## UI Flow

```
Settings (administrator or super_admin)
  └─ Admin Menu Labels (panel)
       ├─ [super_admin only] Organization selector
       ├─ Dashboard   [ Dashboard________ ]  [Reset]
       ├─ Collections [ Collections______ ]  [Reset]
       ├─ Records     [ Submissions_______]  [Reset]
       ├─ Reports     [ Reports__________ ]  [Reset]
       ├─ Settings    [ Settings_________ ]  [Reset]
       ├─ Tickets     [ Work Orders______ ]  [Reset]
       └─ [Save]
             ↓ PUT /api/organizations/:id/menu-labels
   Sidebar (all users in that org, next load/org-switch)
       Dashboard → Dashboard
       Collections → Collections
       Records → Submissions
       Reports → Reports
       Settings → Settings
       Tickets → Work Orders
```

---

## Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Per-user or per-organization? | Per-organization — consistent for every member so shared terminology (e.g. "Records" vs "Submissions") doesn't diverge by user. |
| 2 | Who can edit? | `administrator` (own org only) and `super_admin` (any org, via selector). Same gating as the Categories panel. |
| 3 | Storage shape? | Single JSON blob per org (`organization_menu_labels.labels`) rather than one row per key — simpler upsert, matches the `settings_panel_layout` preference precedent already used on this page. |
| 4 | What happens with a blank label? | Treated as "use default" — never stores/renders an empty sidebar label. |
| 5 | Which items are customizable? | Exactly the six requested: Dashboard, Collections, Records, Reports, Settings, Tickets. AI Summary/Approvals/My Submissions stay fixed. |
| 6 | Icons/routes affected? | No — only the visible text changes; `to` and `icon` are untouched. |

---

## Rollback / Verification Plan

### Verification
1. As an `administrator`, open Settings → Admin Menu Labels, change "Records" to "Submissions", Save.
2. Confirm the sidebar (desktop, mobile drawer, mobile bottom bar) now shows "Submissions" for that organization, for every role (user/reviewer/team manager) belonging to it.
3. Log in as a user from a **different** organization — confirm their sidebar still shows the default "Records".
4. As `super_admin`, switch the org selector in the panel to a different org and confirm its labels load independently and save independently.
5. Clear a field and Save — confirm it reverts to the default label rather than showing a blank sidebar entry.
6. Confirm non-administrator/non-super_admin users cannot reach the Settings page at all (existing route guard), and that a `PUT` from a non-admin/non-member is rejected with 403 via direct API call.

### Rollback
- Remove the `'menu-labels'` panel from `SettingsPage.tsx` and the `labelKey` resolution in `SideNav.tsx` (sidebar falls back to the original hard-coded labels immediately since it just reads `item.label` again).
- The `organization_menu_labels` table and its endpoints are additive and safe to leave in place if only the UI is reverted.
