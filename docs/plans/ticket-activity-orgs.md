# Plan: Ticket Activity — Enable Tickets Per Organization

> **Status:** Implemented and verified live (2026-08-24)
> **Date:** 2026-08-24
> **Supersedes the gate in:** [`ticket-display.md`](./ticket-display.md) — that plan added the global
> on/off switch; this one adds *which organizations* it applies to. The global switch is unchanged and
> still the first of three gates.

---

## TL;DR

The **Ticket Activity** panel in Settings gains an **Enabled Organizations** checklist below the
existing *Show Tickets* switch. Tickets are visible only when **all three** of these are true:

1. `TICKET_SYSTEM_ENABLED` — the environment kill switch (`server/.env` → `/api/info` → `ticketSystemEnabled`).
2. `ticket_activity_enabled` — the global master switch (from `ticket-display.md`).
3. The user's **active organization** is enabled in `ticket_activity_orgs`.

All three are evaluated in **one place** — a hook — so a fourth layer later means editing one file,
not four surfaces.

**No database schema change and no server-side settings-route change was needed for the new key beyond
registering it** (`app_settings` is already a key/value store; the generic `PUT /api/settings/:key`
route does the write).

---

## Storage decision

One setting, **one string**, not one key per organization:

```
key:   ticket_activity_orgs
value: '*' | 'none' | '1,4,7'
```

**Why not `ticket_activity_org_1 = 'true'`, `ticket_activity_org_2 = 'false'`, …**
That shape would require editing the server's static `ALLOWED_KEYS` set once per organization, adding a
default per key, and it would leave **stale keys behind forever** when an organization is deleted — a
row that names an organization which no longer exists and that nothing will ever clean up. A single
string tracks the organization list as it actually is. This mirrors the existing
`admin_visible_panels` setting, which made the same choice for the same reason.

### Grammar (`client/src/utils/ticketActivity.ts`)

| Stored value | Meaning |
|---|---|
| `'*'` | **Every** organization, **including ones created later** (the server default) |
| `''` (empty) | Treated as `'*'` — an absent/blank value must never mean "nobody" |
| `'none'` | Nobody |
| `'1,4,7'` | Only those organization ids |

Helpers: `parseTicketActivityOrgIds` (→ `null` for "all", `number[]` otherwise),
`serializeTicketActivityOrgIds`, `isTicketActivityAllowedForOrg`, `describeTicketActivityOrgScope`.

**Selecting all stores `'*'`, not the current id list.** This is the whole point of the wildcard: an
organization created next month is enabled without anyone revisiting this panel. It was proven live —
`TRN` (id 341) was created after the feature shipped and appeared in the panel already checked under
the `'*'` default. If "all" were stored as `1,2,33,34,340`, TRN would have silently been excluded.

**Unchecking one while everything is enabled** first materialises the current id list, then removes the
id — otherwise `draft === null` ("all") would make the first uncheck a no-op and the checkbox would
look dead.

---

## The three-layer gate

`client/src/hooks/useTicketActivityEnabled.ts` is the single owner:

```ts
ticketActivityGateEnabled =
  ticketSystemEnabled            // env kill switch, via /api/info
  && ticketActivityEnabled       // global master switch, via app_settings
  && organizationEnabled         // active org is in ticket_activity_orgs
```

It returns `{ ticketSystemEnabled, ticketActivityEnabled, enabledOrganizationIds, activeOrganizationId,
organizationEnabled, ticketActivityGateEnabled }`, so a surface can show *why* something is hidden if it
ever needs to.

**`activeOrganizationId`** = `user?.activeOrganizationId ?? user?.organizationId ?? null`.

**`isTicketActivityAllowedForOrg(ids, null)` returns `true`.** An allowlist must never silently revoke a
context it was not asked about; a user with no active organization keeps whatever the other two layers
allow.

Every consumer reads the hook's single boolean. The four surfaces:

| Surface | File | What it gates |
|---|---|---|
| Sidebar **Tickets** item | `components/layout/SideNav.tsx` | `.filter(item => item.to !== '/ticket-designer' \|\| ticketActivityGateEnabled)` |
| Collection Builder **Add Ticket** tab + panel body | `pages/CollectionBuilderPage.tsx` | both the tab buttons and the panel body (this closed a pre-existing gap where the body ignored the master switch) |
| Records page **Tickets** panel | `pages/RecordsPage.tsx` | `ticketActivityGateEnabled && collectionTicketTemplates.length > 0` |
| Export CSV **Ticket Columns** | `pages/ExportCsvPage.tsx` | the column panel, `selectedTicketKeys`, and `ticketsEnabled` inside `handleExport` / `handlePreview` / `handleSavePreset` |

---

## Server change

`server/src/routes/settings.ts` only:

- `'ticket_activity_orgs'` added to `ALLOWED_KEYS`.
- `ticket_activity_orgs: '*'` added to the `GET /:key` defaults map, with a comment recording that the
  default deliberately covers organizations created later.

No dedicated `PATCH /ticket-activity/orgs` route. The existing generic `PUT /:key` (admin+) already
validates against `ALLOWED_KEYS` and coerces to a string, which is exactly what this key needs — a
bespoke route would duplicate that logic for no gain. (The `admin_visible_panels` setting takes the
same route for the same reason.)

---

## Settings panel UI

Below the *Show Tickets* switch:

- Heading **Enabled Organizations** + an explanation of what an unchecked organization loses (the
  Tickets icon, the Add Ticket tab, the ticket columns in CSV export) and that the list only applies
  while *Show Tickets* is on.
- **Select All** / **Deselect All**, with a right-aligned scope summary —
  `describeTicketActivityOrgScope` renders e.g. *"All 6 organizations, including ones added later."* or
  *"Tickets are available in 5 of 6 organizations."*
- A `grid grid-cols-1 sm:grid-cols-2` checklist, one row per organization (`ACC`, `ADM asd`, `GRT`, …).
- The whole checklist is **disabled while the master switch is off**, with an amber note: *"Turn on
  Show Tickets to edit this list."* — the list is meaningless while the layer above it says no.
- **Save Organizations** writes the serialized draft; disabled unless the draft differs from what is
  stored. A `Saved!` flag confirms the write.
- Panel is super-admin only (`user?.role !== 'super_admin' ? null : …`), matching `ticket-display.md`.

### The master switch is a toggle, not a checkbox

Restyle only — it is still a native `<input type="checkbox">`, so keyboard focus, the label click
target and `checked` semantics all stay free:

```
role="switch" aria-checked={…} aria-label="Show Tickets"
h-6 w-11 shrink-0 appearance-none rounded-full bg-[#CBD5E1]
before:absolute before:left-0.5 before:top-0.5 before:h-5 before:w-5 before:rounded-full before:bg-white
checked:bg-[#2563EB] checked:before:translate-x-5
disabled:opacity-50 focus-visible:ring-2 dark:bg-[#475569]
```

No switch component exists elsewhere in the repo (a grep for `role="switch" | peer-checked | Toggle |
translate-x` over `client/src` returned nothing), so inventing a shared primitive for one control was
not worth it. The six **organization** rows were deliberately left as checkboxes — they are a
multi-select list, not six independent switches.

Measured in the live app: track **43.99 × 23.99** (`appearance: none`, `border-radius: 9999px`),
checked track `rgb(37, 99, 235)`, knob 20 × 20 white translated 20px; unchecked track
`rgb(203, 213, 225)` with knob `transform: none`. The accessibility snapshot reports
`switch "Show Tickets" [checked]`; the organization rows still report `checkbox`.

---

## Behavior matrix

| env flag | master switch | active org enabled | Tickets surfaces |
|---|---|---|---|
| on | on | yes | ✅ |
| on | on | no | ❌ |
| on | off | yes / no | ❌ (and the org checklist is disabled) |
| off | either | either | ❌ |

`ADM` (id 2) is the logged-in super admin's active organization, so unchecking ADM is the fastest way to
see the gate work.

---

## Files touched

| File | Change |
|---|---|
| `client/src/utils/ticketActivity.ts` | **new** — grammar helpers |
| `client/src/hooks/useTicketActivityEnabled.ts` | **new** — the three-layer gate (replaces four copies of a two-fetch effect) |
| `client/src/pages/SettingsPage.tsx` | per-org checklist (state, load, toggle, save, Select All/Deselect All, scope summary, disabled-while-master-off); switch restyle |
| `client/src/pages/ExportCsvPage.tsx` | hook replaces its own `/api/info` + `getPublicSetting` effect |
| `client/src/pages/RecordsPage.tsx` | hook replaces the removed two-fetch effect |
| `client/src/pages/CollectionBuilderPage.tsx` | hook added; three gates now include the org layer |
| `client/src/components/layout/SideNav.tsx` | hook replaces its own setting read |
| `server/src/routes/settings.ts` | allowlist entry + `'*'` default |
| `docs/plans/ticket-activity-orgs.md` | this plan |

---

## Verification performed (live, against the real database)

1. `npx tsc --noEmit` clean in **both** `client/` and `server/` (`noUnusedLocals` is on, so dead imports fail).
2. Env kill switch flipped on temporarily, then **restored to `false`** and the API restarted — `/api/info`
   confirmed `ticketSystemEnabled = False` afterwards.
3. All six organizations listed; default scope *"All 6 organizations, including ones added later."*;
   **Save disabled** (draft equals stored).
4. Uncheck **TRN** → scope reads *"5 of 6 organizations"*; Save → server holds `"1,2,33,34,340"`; reload →
   still 5 checked.
5. Uncheck **ADM** (the active org) → server holds `"1,33,34,340"`; after reload the **sidebar has no
   Tickets link** and `/records/16/export-csv` has **no "Ticket Columns" panel**.
6. **Select All** → Save → server holds `"*"`; after reload the Tickets link and the "Ticket Columns"
   panel are both back.
7. Master switch toggled off → server holds `false`, the org checkboxes become `disabled`, the amber
   *"Turn on Show Tickets to edit this list."* note appears, and the knob/track colours flip as measured
   above. Toggled back on → `true`, checkboxes re-enabled.

---

## Notes / gotchas

- **`getPublicSetting` had to be removed from `ExportCsvPage.tsx`.** The ticket key was its only use
  there, so leaving the import would fail `noUnusedLocals` — the import removal is mandatory, not tidying.
- **The panel heading is an `<h2>`, not an `<h3>`.** A probe waiting on `section h3` times out and reads
  like a broken panel.
- **A React-controlled checkbox must be clicked with a dispatched `MouseEvent`** in `page.evaluate`, and
  any dependent text (the scope summary, the `Saved!` flag) read in a **separate** call after a wait —
  reading it in the same evaluate shows pre-render text.
- **The `cancelled` guard** in the hook's three `.catch` blocks must be consistent; the global-switch
  branch originally omitted it and could set state after unmount.
- `TICKET_SYSTEM_ENABLED` in `server/.env` is **`false`** — the feature is currently inert in this
  checkout by design. Flip it to `true` and restart the API to exercise the gate.
