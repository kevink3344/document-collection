# Location Sharing Across Organizations — Plan

**Status:** Draft for review — no code changes yet  
**Context:** 238 Locations have been imported into one organization. Goal is to make those Locations available to users in other organizations without re-importing or duplicating manually.  
**Primary files:** `server/src/database/schema.ts`, `server/src/database/db.ts`, `server/src/routes/locations.ts`, `server/src/routes/users.ts`, `server/src/routes/collections.ts`, `client/src/api/locations.ts`, `client/src/pages/SettingsPage.tsx`

---

## 1. Current State

### Schema

```sql
CREATE TABLE locations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(name, organization_id)
);

CREATE TABLE user_locations (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, location_id)
);
```

- `organization_id` is `NOT NULL` — every Location is owned by exactly one org.
- `UNIQUE(name, organization_id)` allows the same name in different orgs, but prevents duplicates within an org.
- `user_locations` links users to Locations; `POST /api/users` and `PUT /api/users/:id/locations` validate that every `locationId` belongs to one of the user's `membershipOrgIds`.

### API — `server/src/routes/locations.ts`

| Endpoint | Scoping today |
|---|---|
| `GET /api/locations` (authenticated) | `context.organizationId ?? 'all'` — super_admin sees all, everyone else sees only their active org. `?q=` filters within that scope. |
| `GET /api/locations?slug=` (unauthenticated) | Scoped to the collection's `organization_id`. |
| `POST /api/locations` | Inserts into `context.organizationId`. |
| `POST /api/locations/import` | Inserts into `context.organizationId`, dedupes against that org only. |
| `PATCH /api/locations/:id` / `DELETE /api/locations/:id` | Owner-org check: `administrator` can only mutate rows where `organization_id === context.organizationId`. |

### Filtering — `server/src/routes/collections.ts`

- `getVisibleResponseCountMap` / response listing finds the `location` field with `location_filter_enabled = 1`, loads `user_locations → locations.name` for the current user, and filters `collection_response_values.value IN (locationNames)`.
- Response values store the **name string**, not the `location_id`. Filtering is by name match.

### Client

- `client/src/api/locations.ts` — `listLocations()`, `searchLocations(q)`, `getPublicLocations(slug)` all hit `GET /api/locations`.
- `client/src/pages/SettingsPage.tsx` — Locations panel lists `listLocations()` (org-scoped), with create/rename/delete/import. No sharing UI.

### Consequence for 238 Locations

They are invisible to every other org. To use them elsewhere today you must re-import or re-create them per org (duplicating 238 rows N times).

---

## 2. Goal

Make the existing 238 Locations (and future Locations) optionally visible to other organizations, so:

1. Users in other orgs can be assigned those Locations via `user_locations`.
2. Location-filtered collections correctly filter by those shared Locations.
3. No manual duplication; rename/delete propagates (or is explicitly controlled).
4. Org isolation is preserved by default — sharing is opt-in.

---

## 3. Options

### Option A — Make Locations Global (remove scoping)

- Change `GET /api/locations` to return all Locations regardless of org.
- Make `organization_id` nullable; `NULL` means global.

**Pros:** Trivial — one query change.  
**Cons:** Breaks org isolation; every org sees every Location (noisy with 238+). No per-org control. Existing `UNIQUE(name, organization_id)` and `NOT NULL` need migration. Not recommended.

### Option B — `is_shared` / `is_global` Flag on `locations` (Recommended MVP)

- Add `is_shared INTEGER NOT NULL DEFAULT 0` (or `visibility TEXT CHECK('private','shared')`).
- When `is_shared = 1`, the Location is visible to all orgs.
- Queries become `WHERE organization_id = ? OR is_shared = 1`.

**Pros:** Minimal schema change (one column), easy to understand, covers the 238-row use case ("share all with everyone") in one update. Rename/delete still single-row.  
**Cons:** All-or-nothing — cannot share with only a subset of orgs. Can be extended later to Option C without breaking.

### Option C — Explicit Share Table `location_shares` (Most Flexible)

```sql
CREATE TABLE location_shares (
  location_id     INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (location_id, organization_id)
);
```

- Owner org always sees its Locations; shared orgs see them via the join.
- Supports "share with HRS and TST but not ASD".

**Pros:** Fine-grained control, matches how `user_organizations` works.  
**Cons:** More UI and API surface (share/unshare endpoints, picker). Slightly more complex queries.

### Recommendation

**Start with Option B, design queries so Option C can be added later without rework.**

- Ship `is_shared` now to unblock the 238 Locations.
- Keep the query helper isolated (e.g. `getVisibleLocationWhereClause(orgId)`) so adding `location_shares` later is a one-place change: `WHERE organization_id = ? OR is_shared = 1 OR id IN (SELECT location_id FROM location_shares WHERE organization_id = ?)`.
- If you know you need subset sharing on day one, skip B and implement C directly — the rest of the plan is identical.

---

## 4. Detailed Changes Required

### 4.1 Database

**File:** `server/src/database/schema.ts` + `server/src/database/db.ts` (SQL Server migrations)

**Option B migration:**

```sql
ALTER TABLE locations ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_locations_is_shared ON locations(is_shared);
-- Optional: index for shared queries
CREATE INDEX IF NOT EXISTS idx_locations_org_shared ON locations(organization_id, is_shared);
```

For SQL Server (`server/src/database/db.ts` — `applySqlServerMigrations`):

```ts
if (!colNames.has('is_shared')) {
  db.exec(`ALTER TABLE locations ADD is_shared BIT NOT NULL CONSTRAINT DF_locations_is_shared DEFAULT 0`);
}
```

Backfill the 238 rows (one-time):

```sql
UPDATE locations SET is_shared = 1 WHERE organization_id = ?; -- the org that owns the 238
```

**Option C migration (if chosen instead/in addition):**

```sql
CREATE TABLE location_shares (
  location_id     INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (location_id, organization_id)
);
CREATE INDEX idx_location_shares_org ON location_shares(organization_id);
```

No change to `user_locations` — it continues to reference `locations.id`.

### 4.2 API — `server/src/routes/locations.ts`

**Helper (new):**

```ts
function locationVisibilityWhere(orgId: number | 'all' | null): { sql: string; params: unknown[] } {
  if (orgId === 'all') return { sql: '1=1', params: [] };
  if (orgId === null) return { sql: '1=1', params: [] }; // super_admin
  // Option B:
  return { sql: '(organization_id = ? OR is_shared = 1)', params: [orgId] };
  // Option C (later):
  // return { sql: '(organization_id = ? OR is_shared = 1 OR id IN (SELECT location_id FROM location_shares WHERE organization_id = ?))', params: [orgId, orgId] };
}
```

**Changes per endpoint:**

- `GET /api/locations` — replace `WHERE organization_id = ?` with the helper. For `q` searches, combine: `WHERE (visibility) AND lower(name) LIKE lower(?)`. For `resolvedOrgId === 'all'`, keep `1=1` (super_admin already sees all).
- `GET /api/locations?slug=` (unauthenticated) — also include shared: `WHERE (organization_id = ? OR is_shared = 1)`.
- `POST /api/locations` — add optional `is_shared` body field (super_admin or owner admin). Validate: only `super_admin` or `administrator` of the owner org can set `is_shared = 1`. Default `0`.
- `POST /api/locations/import` — add optional `is_shared` flag; when true, inserted rows are shared. Also dedupe against shared names to avoid `UNIQUE` collisions.
- `PATCH /api/locations/:id` — allow toggling `is_shared` (same permission as create). Keep name-uniqueness check scoped to owner org + shared visibility.
- `DELETE /api/locations/:id` — no change, but document that deleting a shared Location removes it for all orgs (and cascades `user_locations`).
- **New endpoints (Option B):** `PATCH /api/locations/:id/share` `{ is_shared: boolean }` — or just reuse `PATCH` with `is_shared`.
- **New endpoints (Option C):** `POST /api/locations/:id/shares { organizationIds: number[] }`, `DELETE /api/locations/:id/shares/:orgId`, `GET /api/locations/:id/shares`.

**Permissions:**

- `super_admin` can share/unshare any Location.
- `administrator` can share/unshare only Locations where `organization_id === context.organizationId`.
- `team_manager`/`reviewer`/`user` cannot share.

### 4.3 User–Location Assignment — `server/src/routes/users.ts`

Current validation:

```ts
if (!membershipOrgIds.has(loc.organization_id)) throw 400;
```

With sharing, a user in org B can be assigned a Location owned by org A if that Location is shared with B.

**Change to:**

```ts
const visibleLocationIds = await getVisibleLocationIdsForOrg(membershipOrgIds, locationIds);
// helper checks: location.organization_id IN membershipOrgIds OR is_shared=1 OR shared via location_shares
if (visibleLocationIds.size !== locationIds.length) throw 400;
```

Applies to:

- `POST /api/users` (create with `locationIds`)
- `PUT /api/users/:id/locations` (update)
- `GET /api/users/:id/locations` — already joins `locations`, but ensure it returns shared Locations.

### 4.4 Collection Filtering — `server/src/routes/collections.ts`

No change to the name-based filtering logic, but ensure `assignedLocations` query includes shared Locations:

```ts
SELECT l.name FROM user_locations ul
JOIN locations l ON l.id = ul.location_id
WHERE ul.user_id = ?
-- l is already filtered by user_locations, which now may point to shared rows — no extra filter needed
```

The `locationNames` array will naturally include shared Location names. No query change required unless you want to validate that the Location field's org matches.

Optional hardening: when `location_filter_enabled = 1`, validate that the submitted `value` is a visible Location for the respondent's org (prevents spoofing).

### 4.5 Client — `client/src/api/locations.ts`

- `listLocations()` / `searchLocations(q)` — no change (server now returns shared rows).
- Add `updateLocationShare(id, isShared)` or `shareLocation(id, orgIds)` helpers for the new endpoints.

### 4.6 Client — `client/src/pages/SettingsPage.tsx` (Locations Panel)

**Option B UI (minimal):**

- Add a "Shared" toggle (checkbox or switch) next to each Location row, visible only to `super_admin` or owner `administrator`.
- Add a "Share all" / "Unshare all" bulk action for the 238 rows.
- Show a badge `Shared` on shared rows.
- Filter toggle: "Show shared only" / "Show all".

**Option C UI (richer):**

- Per-Location "Share" button opens a modal with organization multi-select (checkboxes for HRS, TST, ASD, etc.).
- Display `Shared with: HRS, TST` chips.
- Bulk share modal: select Locations (or "All 238") + select target orgs.

**Import UI:**

- Add checkbox "Make imported Locations shared" to the import dialog.

### 4.7 Other Consumers

- `client/src/components/common/LocationTypeahead.tsx` — uses `searchLocations(q)` — automatically benefits.
- `client/src/pages/CollectionFillPage.tsx` — `getPublicLocations(slug)` — ensure it includes shared Locations for the collection's org.
- Reports / Export CSV — location filtering already via `user_locations` names, no change.

---

## 5. Migration for the Existing 238 Locations

1. Identify owner org: `SELECT organization_id, COUNT(*) FROM locations GROUP BY organization_id;`
2. Run backfill:

```sql
-- Option B: share all 238
UPDATE locations SET is_shared = 1 WHERE organization_id = <ownerId>;

-- Option C: share with specific orgs
INSERT INTO location_shares (location_id, organization_id)
SELECT id, <targetOrgId> FROM locations WHERE organization_id = <ownerId>
ON CONFLICT DO NOTHING;
```

3. Verify:

```sql
SELECT COUNT(*) FROM locations WHERE is_shared = 1; -- should be 238
-- or
SELECT COUNT(*) FROM location_shares WHERE organization_id = <targetOrgId>;
```

4. Test as a user in the target org: `GET /api/locations` should now return 238 rows; assign one via `PUT /api/users/:id/locations`.

No downtime; migration is additive and backward-compatible (default `is_shared = 0` preserves current behavior).

---

## 6. Testing Checklist

- [ ] Super admin sees all Locations (unchanged).
- [ ] Admin in owner org can toggle `is_shared` (or share with orgs).
- [ ] Admin in non-owner org cannot toggle sharing (403).
- [ ] `GET /api/locations` as non-owner returns shared Locations + own org's Locations, not other private Locations.
- [ ] `GET /api/locations?slug=` (unauthenticated fill page) returns shared Locations for that collection's org.
- [ ] `POST /api/users` with a shared `locationId` succeeds when user's memberships include the target org.
- [ ] `POST /api/users` with a private Location from another org still fails (400).
- [ ] Location-filtered collection: user assigned a shared Location sees only matching responses.
- [ ] Rename shared Location propagates to all orgs (single row).
- [ ] Delete shared Location cascades `user_locations` and is reflected in all orgs.
- [ ] Import with `is_shared` flag creates shared rows.
- [ ] SQL Server and Turso paths both pass (test `server/src/database/db.ts` migrations).

---

## 7. Risks & Considerations

- **Name collisions:** `UNIQUE(name, organization_id)` allows same name in different orgs. If a shared Location named "Main Campus" exists and org B already has a private "Main Campus", `GET` will return two rows with the same name but different `id`s. Filtering by name will match both. Mitigation: on share, warn if target org already has a Location with the same name; offer to merge or keep both.
- **Delete is global:** Deleting a shared Location removes it for everyone. Consider soft-delete or "unshare" vs "delete" distinction.
- **Audit:** Sharing is a privileged action — log `location_id`, `actor`, `target orgs`, `timestamp`.
- **Performance:** `OR is_shared = 1` is indexed; with 238 rows negligible. With `location_shares`, ensure index on `organization_id`.

---

## 8. Rollout Steps

1. **DB migration** — add `is_shared` (or `location_shares`) in `schema.ts` + `db.ts` for both adapters.
2. **API** — update `locations.ts` helper and endpoints; update `users.ts` validation.
3. **Client** — add share toggle/modal in Settings → Locations.
4. **Backfill** — run `UPDATE locations SET is_shared = 1 WHERE organization_id = ?` for the 238.
5. **Verify** — test checklist above on `localhost:5173` with two orgs (e.g. HRS and TST).
6. **Deploy** — push; production migration runs automatically on startup (existing `applySqlServerMigrations` pattern).

---

## 9. Future Extensions

- Per-organization sharing (Option C) can be added later without breaking Option B — keep the visibility helper isolated.
- Add `GET /api/locations/shares` for super_admin to audit all shares.
- Add organization-level setting "Allow shared Locations" to let an org opt out of seeing shared Locations.
- Consider changing response storage from name string to `location_id` for exact matching (larger migration, not required for this feature).

---

## 10. Decision Needed

- [ ] **Option B (flag) vs Option C (share table)** — B is faster for the 238-row case; C is needed if you want subset sharing.
- [ ] Who can share? `super_admin` only, or also `administrator` of the owner org? (Recommended: both.)
- [ ] Should sharing be bulk ("share all 238") or per-Location? (Recommended: both — bulk for initial, per-Location for ongoing.)
- [ ] Delete behavior: should non-owner admins be blocked from deleting shared Locations they didn't create?

