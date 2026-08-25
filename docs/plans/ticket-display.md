# Plan: Ticket Activity — Show/Hide Tickets (Sidebar + Collections)

> **Status:** Implemented (pending local verification)
> **Date:** 2026-08-24
> **Goal:** Add a Settings option **"Ticket Activity"** that, when enabled, shows the **Tickets** sidebar icon and the ticket surfaces inside Collections; when disabled, hides them everywhere.

---

## TL;DR

A new boolean setting (`ticket_activity_enabled`, default **enabled**) gates three surfaces:

1. The **Tickets** item in the left sidebar (`/ticket-designer`).
2. The **Add Ticket** tab in the Collection Builder.
3. The **Tickets** view in the Records page (per-collection ticket activity).

This mirrors the existing **AI Summary** toggle (`ai_summary_enabled`) end-to-end, so it reuses the exact same setting storage, toggle UI, and `getPublicSetting` read path — no new infrastructure.

---

## Current state (what already exists)

| Surface | Location | Current gating |
|---|---|---|
| Sidebar "Tickets" item | `client/src/components/layout/SideNav.tsx` `NAV_ITEMS` | Always shown (no flag) |
| Collection Builder "Add Ticket" tab | `client/src/pages/CollectionBuilderPage.tsx` (`detailsTab === 'ticket'`) | `ticketSystemFeatureEnabled` from `/api/info` `ticketSystemEnabled` (env `TICKET_SYSTEM_ENABLED`) |
| Records page "Tickets" view | `client/src/pages/RecordsPage.tsx` (`view === 'tickets'`) | `ticketSystemFeatureEnabled` from `/api/info` |
| Export CSV "Ticket Columns" panel | `client/src/pages/ExportCsvPage.tsx` | Always shown (no flag) |
| AI Summary toggle (reference pattern) | `SettingsPage.tsx` `handleAiSummaryToggle` | `ai_summary_enabled` via `updateSetting`/`getPublicSetting`; read in `SideNav.tsx` |

**Key distinction:** `ticketSystemEnabled` is an **environment-level** kill switch (server `.env`, surfaced via `/api/info`) — not user-controllable in Settings. This plan adds a **user-controllable** Settings toggle on top of it. The effective visibility is `envFlag && settingFlag`.

---

## Design decisions

1. **New setting key:** `ticket_activity_enabled` (string `'true'`/`'false'`), stored in the existing `app_settings` table via the existing `updateSetting`/`getPublicSetting` API. **No DB schema change** (the `app_settings` key/value store already exists).

2. **Default = enabled.** When the setting is absent, treat it as enabled (backward compatible — matches `ai_summary_enabled` behavior).

3. **Effective gating = AND of both flags.** A surface shows only if `ticketSystemEnabled (env) !== false` **and** `ticket_activity_enabled (setting) !== 'false'`. This preserves the existing env kill switch while adding the user toggle.

4. **Sidebar reads the setting** the same way it already reads `ai_summary_enabled` (a `getPublicSetting` call in an effect, stored in local state, used to `.filter()` the nav items).

5. **Where the toggle lives in Settings:** a new panel **"Ticket Activity"** added to the existing Settings panel system (a `PanelId`, `PANEL_LABELS` entry, and a `renderPanel` case), following the AI Summary panel pattern. It is a Super Admin / Administrator setting (Settings page is already admin-only).

---

## Implementation steps

### 1. Sidebar (`client/src/components/layout/SideNav.tsx`)

- Add state `const [ticketActivityEnabled, setTicketActivityEnabled] = useState(true)`.
- Add an effect mirroring the existing `ai_summary_enabled` effect:
  ```ts
  useEffect(() => {
    getPublicSetting('ticket_activity_enabled')
      .then(val => setTicketActivityEnabled(val !== 'false'))
      .catch(() => setTicketActivityEnabled(true))
  }, [])
  ```
- Add a `.filter()` to the nav pipeline (next to the existing `ai-summary` filter) that drops the Tickets item when disabled:
  ```ts
  .filter(item => item.to !== '/ticket-designer' || ticketActivityEnabled)
  ```

### 2. Collection Builder (`client/src/pages/CollectionBuilderPage.tsx`)

- Load the setting alongside the existing `/api/info` fetch (or a separate `getPublicSetting('ticket_activity_enabled')` effect).
- Combine into the existing gates: change `ticketSystemFeatureEnabled &&` to `ticketSystemFeatureEnabled && ticketActivityEnabled &&` at the two "Add Ticket" tab render sites (desktop tab ~line 1633 and mobile overflow ~line 1647).

### 3. Records page (`client/src/pages/RecordsPage.tsx`)

- Load the setting (mirror the existing `/api/info` `ticketSystemEnabled` effect).
- Gate the Tickets view (`view === 'tickets'`) and any "Tickets" tab/button that switches to it, using the combined `ticketSystemFeatureEnabled && ticketActivityEnabled`.

### 4. Settings panel (`client/src/pages/SettingsPage.tsx`)

- Add `'ticket-activity'` to the `PanelId` union, `PANEL_LABELS`, `ALL_PANEL_IDS`, and `DEFAULT_PANEL_LAYOUT`.
- Add state + a `handleTicketActivityToggle(nextValue: boolean)` mirroring `handleAiSummaryToggle`, calling `updateSetting('ticket_activity_enabled', nextValue ? 'true' : 'false')`.
- Add a `renderPanel` case `'ticket-activity'` rendering a toggle (copy the AI Summary panel's markup/semantics).
- **Super Admin only:** gate the toggle control on `isGlobalAdmin` (the existing super-admin flag), so Administrators see the panel read-only (or the panel is only rendered for super admins). Reuse the same guard used by other super-admin-only panels (e.g. "Visibility Settings", "Manage Tabs").
- Confirm whether it should appear in the `VISIBILITY_CHECKLIST_IDS` (i.e. controllable via the existing "Visibility Settings" panel) — recommended **yes**, so Super Admins can hide it from Administrators if desired.

### 5. Export CSV (`client/src/pages/ExportCsvPage.tsx`)

- Load `ticket_activity_enabled` (via `getPublicSetting`) and gate the **"Ticket Columns"** panel and its related controls on the combined `ticketSystemEnabled && ticketActivityEnabled` flag.

---

## Behavior matrix

| Env `TICKET_SYSTEM_ENABLED` | Setting `ticket_activity_enabled` | Sidebar Tickets | Builder tab | Records view | Export CSV panel |
|---|---|---|---|---|---|
| true (default) | true (default) | ✅ | ✅ | ✅ | ✅ |
| true | false | ❌ | ❌ | ❌ | ❌ |
| false | true | ❌ | ❌ | ❌ | ❌ |
| false | false | ❌ | ❌ | ❌ | ❌ |

---

## Files touched

| File | Change |
|---|---|
| `client/src/components/layout/SideNav.tsx` | read setting, filter Tickets item |
| `client/src/pages/CollectionBuilderPage.tsx` | combined gate on "Add Ticket" tabs |
| `client/src/pages/RecordsPage.tsx` | combined gate on Tickets view |
| `client/src/pages/SettingsPage.tsx` | new "Ticket Activity" panel + toggle (super-admin only) |
| `client/src/pages/ExportCsvPage.tsx` | gate "Ticket Columns" panel |
| `docs/plans/ticket-display.md` | this plan |

No server changes and no DB migration are required.

---

## Verification checklist

1. `npm run build --prefix server` and `npm run build --prefix client` pass.
2. Default state (setting absent): Tickets icon visible in sidebar; "Add Ticket" tab and Records "Tickets" view visible.
3. Toggle **off** in Settings → Tickets icon disappears from sidebar immediately (after nav refresh); "Add Ticket" tab and Records "Tickets" view disappear.
4. Toggle **on** → everything returns.
5. With env `TICKET_SYSTEM_ENABLED=false`, everything stays hidden regardless of the setting.
6. Setting persists across server restart (stored in `app_settings`).

---

## Open questions (resolved)

1. **Scope:** ✅ Gate the **Export CSV "Ticket Columns" panel** too, for consistency.
2. **Who can toggle:** ✅ **Super Admin only** (Administrators cannot toggle).
3. **Label wording:** ✅ "Ticket Activity" + the proposed helper text are approved.
