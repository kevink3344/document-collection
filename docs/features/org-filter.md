# Org Filter for "Select User" Login Mode

**Status:** Draft — awaiting review  
**Author:** 2026-08-12  
**Related:** `Login Mode` (`select` / `password` / `maintenance`), `GET /api/auth/organizations`, `client/src/pages/LoginPage.tsx`, `server/src/routes/auth.ts`, `server/src/routes/health.ts`

---

## 1. Overview

When **Login Mode** is `select` (Select User — test/demo mode), the login page shows an **Organization** dropdown followed by a **User** dropdown. Today that dropdown lists every active organization that has at least one user.

This plan adds an env-driven allowlist so deployments can restrict which organizations appear in that dropdown without code changes.

**New env var:** `ORG_LIST`

- Comma-separated list of organization identifiers.
- If unset/empty → show all organizations (current behavior, backward compatible).
- If set → only organizations whose identifier appears in the list are returned by `GET /api/auth/organizations` and thus shown in the dropdown.

Example from request:

> `ORG_LIST="HRS, TST"` → only the **Human Resources** and **Testing Only** organizations appear.

---

## 2. Current Behavior

| Layer | Behavior |
|-------|----------|
| **Server** `GET /api/auth/organizations` (`server/src/routes/auth.ts:62`) | `SELECT DISTINCT o.id, o.name, o.description FROM organizations o INNER JOIN user_organizations uo ... ORDER BY o.name` — returns every org with ≥1 user. No filtering. |
| **Client** `LoginPage.tsx:fetchOrgs` | Fetches `/api/auth/organizations`, populates `organizations` state, renders `<select>` with `formatOrgLabel(org)` (`description (name)` if description exists). Only rendered when `loginMode === 'select' \|\| loginMode === null`. |
| **Env** | `LOGIN_MODE`, `LOGIN_SCREEN_COLOR`, `IMAGE_LOGO_URL` etc. are read in `server/src/routes/health.ts` (`/api/info`) and `server/src/env.ts`. No `ORG_LIST` today. |

---

## 3. Desired Behavior

1. Operator sets `ORG_LIST` in the hosting environment (local `.env`, `.env.production`, or Azure App Service → Configuration → Application settings).
   - Format: `ORG_LIST="HRS, TST"` or `ORG_LIST="Human Resources, Testing Only"` or `ORG_LIST="hrs,tst"` — all equivalent after normalization.
2. When `ORG_LIST` is set, `GET /api/auth/organizations` returns only the matching organizations (still intersected with "has ≥1 user").
3. When `ORG_LIST` is unset, empty, or whitespace-only, the endpoint returns all organizations (no change).
4. Filtering is **UX only** — it does not block `POST /api/auth/login` or `GET /api/auth/users?organizationId=...` for other orgs. It just hides them from the picker. This matches the existing `LOGIN_MODE` pattern (env var is a UX gate, not a security boundary).
5. The filter applies regardless of `login_mode` value on the server, but is only visible to users when `loginMode === 'select'` on the client (the dropdown is not rendered in `password`/`maintenance` modes).

---

## 4. Env Var Spec — `ORG_LIST`

| Property | Value |
|----------|-------|
| **Name** | `ORG_LIST` |
| **Type** | `string` (comma-separated) |
| **Required** | No |
| **Default** | `""` (empty → no filtering) |
| **Example** | `ORG_LIST="HRS, TST"` |
| **Where set** | `server/.env`, `server/.env.production`, or hosting env (Azure App Settings). Loaded via `server/src/env.ts` (`dotenv`). |
| **Reload** | Requires process restart (Azure restart on App Settings save). Read at request time so no caching issues, but log at startup for visibility. |

**Parsing rules (server):**

```ts
function getAllowedOrgIdentifiers(): string[] {
  const raw = process.env.ORG_LIST?.trim() ?? ''
  if (!raw) return [] // empty → no filter
  return raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean) // drop empty entries from ",," or trailing comma
}
```

- Case-insensitive, whitespace-trimmed.
- Empty entries ignored.
- Duplicates are harmless (dedup optional).

---

## 5. Matching Rules

An organization matches if **any** of its identifiers (normalized to lower case, trimmed) appears in the allowlist.

**Identifiers to match (in priority order):**

1. `organizations.name` — primary (e.g. `"HRS"` or `"Human Resources"`)
2. `organizations.slug` — fallback (e.g. `"hrs"`, `"tst"`) — if column exists and is non-null
3. `organizations.description` — optional fallback (e.g. `"Human Resources"`) — include if `name` is the short code and `description` is the long name (as in `formatOrgLabel`)

**Recommended implementation:** match against `name` **and** `slug` (and `description` if present) to cover both data shapes:

```ts
const allowed = getAllowedOrgIdentifiers() // e.g. ["hrs", "tst"]
if (allowed.length > 0) {
  const allowedSet = new Set(allowed)
  orgs = orgs.filter(o =>
    allowedSet.has(o.name.trim().toLowerCase()) ||
    (o.slug && allowedSet.has(o.slug.trim().toLowerCase())) ||
    (o.description && allowedSet.has(o.description.trim().toLowerCase()))
  )
}
```

**Why this covers the example:**

- DB row: `{ name: "HRS", description: "Human Resources", slug: "hrs" }` → `ORG_LIST="HRS, TST"` matches `name` (`hrs`) → shown.
- DB row: `{ name: "Human Resources", slug: "hrs" }` → `ORG_LIST="HRS"` matches `slug` (`hrs`) → shown.
- DB row: `{ name: "FIN", description: "Finance" }` → not in allowlist → hidden.

**Edge:** If `ORG_LIST` contains a value that matches no org, it is silently ignored (no error). If no orgs match at all, the endpoint returns `[]` and the client shows "No organizations available" (existing empty state).

---

## 6. Server Changes

### 6.1 `server/src/routes/auth.ts` — `GET /api/auth/organizations`

- Add helper `getAllowedOrgIdentifiers()` (or shared util in `server/src/lib/orgFilter.ts`).
- After the existing `SELECT DISTINCT ...` query, apply in-memory filter if allowlist is non-empty.
- Alternative: push filter into SQL (`WHERE LOWER(o.name) IN (...) OR LOWER(o.slug) IN (...)`) — but in-memory is simpler, avoids SQL injection concerns, and the org table is small (<100 rows). Prefer in-memory.
- Log at startup (in `server/src/index.ts` or `server/src/database/db.ts` setup) when `ORG_LIST` is set: `[server] ORG_LIST filter active: ["hrs", "tst"]`.

**Pseudo-diff:**

```ts
// server/src/routes/auth.ts
function getAllowedOrgIdentifiers(): string[] {
  const raw = process.env.ORG_LIST?.trim() ?? ''
  if (!raw) return []
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

router.get('/organizations', async (_req, res) => {
  const db = await getDbAsync()
  let orgs = await db.queryAll<{ id: number; name: string; description: string | null; slug?: string | null }>(
    `SELECT DISTINCT o.id, o.name, o.description, o.slug
     FROM organizations o
     INNER JOIN user_organizations uo ON uo.organization_id = o.id
     ORDER BY o.name COLLATE NOCASE ASC`
  )
  const allowed = getAllowedOrgIdentifiers()
  if (allowed.length > 0) {
    const set = new Set(allowed)
    orgs = orgs.filter(o =>
      set.has(o.name.trim().toLowerCase()) ||
      (o.slug && set.has(o.slug.trim().toLowerCase())) ||
      (o.description && set.has(o.description.trim().toLowerCase()))
    )
  }
  res.json(orgs)
})
```

- If `slug` column does not exist in the current schema, omit that check or add it to the SELECT only if present (check `INFORMATION_SCHEMA` or just select `o.name, o.description` and match those two).

### 6.2 `server/src/routes/health.ts` — `/api/info`

- Expose `orgList` so the client/operator can verify the filter is active without inspecting env:
  ```ts
  orgList: process.env.ORG_LIST?.trim() || null
  ```
- Non-sensitive (org names are not secrets). Used by client to show a specific empty-state message when the filter yields no results.

### 6.3 `server/src/env.ts` / `.env.example`

- Add `ORG_LIST` to `.env.example` (if present) with comment:
  ```
  # Comma-separated allowlist for "Select User" login org dropdown.
  # Empty = show all orgs. Example: ORG_LIST="HRS, TST"
  ORG_LIST=
  ```

### 6.4 No DB migration

- No schema change. Pure env + query filtering.

---

## 7. Client Changes

**None required for MVP.** The client already handles `organizations.length === 0` ("No organizations available") and `loadingOrgs`.

**Optional polish (follow-up):**

- If `GET /api/auth/organizations` returns `[]` due to filter, show a more specific message: "No organizations match the configured filter. Contact your administrator." — only if `/api/info` exposes `orgList`.
- No change to `loadUsers` or `handleSelectSignIn` — they already work with any `organizationId`.

---

## 8. Data Flow

```
[Azure App Settings / .env]  ORG_LIST="HRS, TST"
        │
        ▼
[Server] process.env.ORG_LIST ──► getAllowedOrgIdentifiers() ──► Set(["hrs","tst"])
        │
        ▼
GET /api/auth/organizations ──► SELECT all orgs with users ──► in-memory filter ──► JSON [HRS, TST]
        │
        ▼
[Client] LoginPage.tsx fetchOrgs() ──► setOrganizations(filtered) ──► <select> shows 2 options
        │
        ▼
User picks org → GET /api/auth/users?organizationId=... → picks user → POST /api/auth/login
```

---

## 9. Edge Cases & Decisions

| Case | Handling |
|------|----------|
| `ORG_LIST` unset / empty / whitespace | No filtering — return all orgs (backward compatible). |
| `ORG_LIST="HRS, TST, "` (trailing comma) | Trim + filter empty → `["hrs","tst"]`. |
| `ORG_LIST="hrs"` vs DB `name="HRS"` | Case-insensitive match → shown. |
| `ORG_LIST` contains non-existent org | Silently ignored. If no orgs match, return `[]`. |
| Org has no users | Already excluded by `INNER JOIN user_organizations` — filter applies after that. |
| `ORG_LIST` set but `loginMode !== 'select'` | No visible effect (dropdown not rendered). No server error. |
| `slug` column missing | Match only `name` + `description`. |
| Production vs test DB | Each deployment reads its own `ORG_LIST` env — test can be `ORG_LIST=""` (all), prod can be `ORG_LIST="HRS, TST"`. No code branch. |

---

## 10. Testing Plan

**Manual:**

1. Seed 3 orgs: `HRS` (Human Resources), `TST` (Testing Only), `FIN` (Finance), each with ≥1 user.
2. `ORG_LIST=""` → login page (select mode) shows 3 orgs.
3. `ORG_LIST="HRS, TST"` → shows 2 orgs (HRS, TST) in order.
4. `ORG_LIST="hrs"` (lowercase) → shows HRS (case-insensitive).
5. `ORG_LIST="HRS, TST, FIN"` → shows 3.
6. `ORG_LIST="NONEXISTENT"` → shows "No organizations available".
7. Switch `loginMode` to `password` → org dropdown not rendered (no regression).
8. Verify `GET /api/auth/users?organizationId=<filtered-out-id>` still works (filter is UX only).

**Automated (optional):**

- Unit test for `getAllowedOrgIdentifiers()` parsing.
- Integration test for `GET /api/auth/organizations` with mocked `process.env.ORG_LIST`.

---

## 11. Deployment

- Add `ORG_LIST` to Azure App Service → Configuration → Application settings for each slot (test vs production).
- Restart is automatic on save.
- No DB migration, no client rebuild required beyond server deploy.
- Log line at startup confirms active filter.

---

## 12. Decisions (confirmed 2026-08-12)

1. **Match against `name` + `slug` + `description`** — confirmed. Covers both short-code and long-name data shapes.
2. **`GET /api/auth/users` — leave as-is.** No filtering; org filter is login-dropdown UX only.
3. **Expose `orgList` in `/api/info`** — confirmed. Enables client empty-state messaging and operator visibility.

---

## 13. Future Improvements

- Support `ORG_LIST` as IDs (`"1,2"`) in addition to names — useful if org names change.
- Per-environment config via `app_settings` table instead of env var (admin-editable in Settings UI).
- Wildcard/prefix support (`"HRS*"`).

