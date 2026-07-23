# Plan: Remove Local SQLite Connection — Turso-Only at Startup

**Date:** 2026-07-21  
**Status:** Draft — awaiting review before implementation  
**Primary files:** `server/src/database/db.ts`, `server/src/routes/settings.ts`, `server/.env.example`

---

## Executive Summary

Today the server can connect to three database backends: **Turso** (preferred), **Azure SQL Server**, and a **local SQLite file** (`data.db`) used as a development fallback. When Turso credentials are missing or the Turso embedded-replica connection fails at startup/runtime, `getDb()` silently opens a local `data.db` file. That dual-path behavior makes it easy to run against stale local data without realizing Turso is offline.

This plan removes the **local SQLite file database connection path** so that at startup the app only uses the **Turso online database** (or SQL Server when explicitly configured). If Turso cannot be reached, the server should **fail fast** with a clear error instead of falling back to `data.db`.

---

## Scope

### In scope

1. Remove the local SQLite (`mode: 'sqlite'` / `data.db`) connection target from runtime DB resolution.
2. Remove Turso → local SQLite fallback in `getDb()` (dev and prod).
3. Remove the “retry Turso after falling back to SQLite” health-check branch (no longer needed).
4. Stop accepting `DB_MODE=sqlite` / `database_mode=sqlite` in config and Settings API.
5. Update env examples/docs so local SQLite is no longer presented as a valid app runtime mode.
6. Keep **Turso embedded replica** (`turso-replica.db`) — this is a local cache of the *online* Turso DB, not a standalone local database.
7. Keep **SQL Server** mode unchanged (out of scope to remove; still a valid explicit mode).

### Out of scope

- Deleting historical one-off scripts that open `data.db` for manual migration/debug (`server/scripts/migrate-local-db.mjs`, `check-db.mjs`, etc.). These are offline tools, not startup paths. Optionally mark them deprecated in comments later.
- Removing libsql package or SQLite SQL dialect support (Turso *is* SQLite-compatible; `getDialect()` returning `'sqlite'` for Turso is correct).
- Migrating data from local `data.db` into Turso (assume Turso is already the source of truth; if local has unique data, run `server/scripts/migrate-to-turso.mjs` *before* implementing this plan).
- Changing SQL Server connection or seed logic.
- Deleting `server/data.db` from disk automatically (operator may keep a backup; optional manual cleanup step).

---

## Current Behavior (what we are removing)

### Connection resolution (`resolveDbTarget` in `server/src/database/db.ts`)

Order today:

1. Explicit `DB_MODE=sqlserver` (+ Azure credentials) → SQL Server  
2. Auto-detect Azure credentials when mode is not turso/sqlite → SQL Server  
3. Valid `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` (or `DATABASE_URL` / `DATABASE_AUTH_TOKEN`) → Turso  
4. **Else (dev only):** fall back to local SQLite via `resolveDbPath()` → `data.db`  
5. Production without credentials → throw

### `getDb()` fallback

Even when target mode is Turso:

- Opens embedded replica at `turso-replica.db` with `syncUrl` + `authToken`
- On failure in **non-production**, logs a warning and **opens local `data.db`** instead
- Tracks `dbConnectedMode = 'sqlite'` and later retries Turso every 30s

### Mode surface area

| Location | SQLite exposure |
|---|---|
| `getConfiguredDatabaseMode()` | accepts `'sqlite'` |
| `setConfiguredDatabaseMode()` | writes `'sqlite'` to `.db-mode` |
| `server/src/routes/settings.ts` | PUT `database_mode` allows `sqlite` |
| `client/.../SettingsPage.tsx` | handler type includes `'sqlite'` (UI radios currently only Turso + SQL Server) |
| `server/.env.example` | documents `DATABASE_PATH` as local SQLite fallback |
| `setupDatabase()` | full `createSchema` / `runMigrations` / `seedData` path runs when mode is sqlite |

---

## Target Behavior

1. **Startup with Turso credentials** → connect via embedded replica only; apply incremental schema; never open `data.db`.
2. **Startup with `DB_MODE=sqlserver` + Azure credentials** → SQL Server (unchanged).
3. **Missing/invalid Turso credentials when not on SQL Server** → **throw at startup** with an actionable message (dev and prod).
4. **Turso connection/sync failure** → **throw** (no local SQLite fallback). Existing stream-expired reset + replica wipe/retry may remain for *Turso-only* recovery.
5. **`DB_MODE=sqlite` or persisted `.db-mode` of `sqlite`** → treat as invalid; prefer fail with message to set `turso` or `sqlserver`, or coerce to default `turso` only if valid Turso env vars exist (recommended: **reject explicitly**).

---

## Step-by-Step Implementation Guide

### Phase 0 — Pre-flight (operator, before coding)

1. Confirm Turso is healthy:
   ```bash
   cd server
   node test-turso-connection.mjs
   ```
2. If any unique data still lives only in `server/data.db`, migrate it first:
   ```bash
   cd server
   node scripts/migrate-to-turso.mjs
   ```
3. Ensure `server/.env` has non-placeholder values:
   - `DB_MODE=turso` (or omit; default is already `turso`)
   - `TURSO_DATABASE_URL=libsql://...`
   - `TURSO_AUTH_TOKEN=...`
4. Note: `turso-replica.db` is fine to keep; it is the embedded cache.

### Phase 1 — Tighten types and mode parsing in `db.ts`

**File:** `server/src/database/db.ts`

1. Change mode unions from `'turso' | 'sqlserver' | 'sqlite'` → `'turso' | 'sqlserver'` wherever they describe *configured app modes*:
   - `normalizeDatabaseMode`
   - `readPersistedDatabaseMode`
   - `getConfiguredDatabaseMode`
   - `setConfiguredDatabaseMode`
2. Update `DbTarget` to remove:
   ```ts
   | { mode: 'sqlite'; dbPath: string }
   ```
   Keep only `turso` and `sqlserver`.
3. Change `dbConnectedMode` from `'turso' | 'sqlite' | null` → `'turso' | null` (SQL Server does not use this cache).
4. If persisted `.db-mode` contains `sqlite`, log a clear warning and treat as unset (fall through to env default `turso`), or throw instructing the operator to fix it. **Recommended:** warn + ignore, then require Turso credentials.

### Phase 2 — Remove local path helpers used only for standalone SQLite

**File:** `server/src/database/db.ts`

Remove or inline-delete (if unused after Phase 3):

- `normalizeSqlitePath`
- `resolveDbPath`
- `cleanupDatabaseFiles` / `resetDatabase` **only if** they are solely used for local `data.db` recovery  
  - Keep replica wipe logic that targets `turso-replica.db` (already separate in `resetDbIfStreamError` and Turso open path).
- `applyPragmas` if only used when opening standalone local files (embedded replica may not need the same WAL setup path — verify callers before deleting).

### Phase 3 — Rewrite `resolveDbTarget()` (fail closed)

**File:** `server/src/database/db.ts`

Target logic:

```ts
function resolveDbTarget(): DbTarget {
  const configuredMode = getConfiguredDatabaseMode() // 'turso' | 'sqlserver'

  if (configuredMode === 'sqlserver') {
    // require AZURE_SQL_* or throw (do not fall back to sqlite)
    ...
  }

  // Optional: still allow auto-detect SQL Server when mode is turso? Prefer NOT changing
  // current auto-detect behavior except removing sqlite. Keep existing SQL auto-detect
  // only when mode is not explicitly turso, if that logic remains useful.

  const tursoUrl = (process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL)?.trim()
  const tursoToken = (process.env.DATABASE_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN)?.trim()
  if (looksLikeValidTursoConnection(tursoUrl, tursoToken)) {
    return { mode: 'turso', url: tursoUrl!, authToken: tursoToken! }
  }

  throw new Error(
    '[db] No database configured. Set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN for Turso, ' +
    'or DB_MODE=sqlserver with AZURE_SQL_* credentials. Local SQLite is no longer supported.'
  )
}
```

**Key change:** delete the final `return { mode: 'sqlite', dbPath: resolveDbPath() }` branch entirely (including the “development only” fallback).

### Phase 4 — Rewrite `getDb()` Turso-only path

**File:** `server/src/database/db.ts`

1. Keep:
   - Turso stream health check + `sync()`
   - Embedded replica open at `turso-replica.db`
   - Corrupted-replica wipe + single retry
   - `resetDbIfStreamError` malformed-replica wipe
2. Remove:
   - Block: “If we previously fell back to SQLite, retry Turso periodically”
   - On Turso open failure: fallback that sets `dbPath = resolveDbPath()` and opens local DB
   - Any assignment `dbConnectedMode = 'sqlite'`
3. On Turso failure after wipe/retry:
   ```ts
   throw new Error(`[db] Turso connection failed: ${msg}. Check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.`)
   ```
   Apply this in **both** development and production (user request: only Turso online DB at startup).
4. If `getDb()` is somehow invoked when target is `sqlserver`, keep the existing warning to use `getDbAsync()` — do not open sqlite.

### Phase 5 — Simplify `setupDatabase()`

**File:** `server/src/database/db.ts`

Current structure:

- `sqlserver` → skip local schema  
- `turso` → `applyIncrementalSchema` only  
- else (sqlite) → full `createSchema` + `runMigrations` + `seedData`

After change:

- `sqlserver` → skip (unchanged)
- `turso` (only remaining libsql mode) → `applyIncrementalSchema` + optional `sync()`
- Remove the large “initialize full local schema” branch from the **startup path**, **or** leave `runMigrations` code in the file but unreachable from startup (prefer deleting the call path; bulk migration helpers can stay until a later cleanup if they are only referenced from that branch).

**Important:** Do **not** delete the entire `runMigrations` function body in the first PR unless you confirm no scripts import it. Safest first step: stop calling it from `setupDatabase()`. A follow-up can move migrations to Turso-specific scripts (many already live under `server/scripts/migrate-turso-*.mjs`).

### Phase 6 — Settings API

**File:** `server/src/routes/settings.ts`

1. In PUT `database_mode` validation, allow only `turso` and `sqlserver`:
   ```ts
   if (normalized !== 'turso' && normalized !== 'sqlserver') {
     res.status(400).json({ error: 'database_mode must be one of: turso, sqlserver' })
     return
   }
   setConfiguredDatabaseMode(normalized as 'turso' | 'sqlserver')
   ```
2. Optionally: if stored `app_settings.database_mode` is already `sqlite`, next GET still returns the raw value — consider normalizing on read via `getConfiguredDatabaseMode()` instead of the raw row for consistency (optional polish).

### Phase 7 — Client types (small cleanup)

**File:** `client/src/pages/SettingsPage.tsx`

1. Narrow `handleDatabaseModeChange` parameter type to `'turso' | 'sqlserver'`.
2. Confirm no UI radio still offers sqlite (current UI already only has Turso + SQL Server).
3. Error rollback ternary that flips turso↔sqlserver can stay as-is.

### Phase 8 — Env / docs cleanup

1. **`server/.env.example`**
   - Remove or reword `DATABASE_PATH` “Local SQLite fallback” comment.
   - Document required Turso vars and optional SQL Server vars.
   - Explicitly note: local standalone SQLite is not supported for the running server.
2. **`migration/migration_guide.md`** (optional, if you want docs in sync)
   - Remove `DB_MODE=sqlite` section or mark deprecated.
3. **Do not commit secrets** from `server/.env`.

### Phase 9 — Startup fail-fast (optional hardening)

**File:** `server/src/index.ts`

Today:

```ts
setupDatabase()
```

Consider wrapping so process exits non-zero on connection failure (if `setupDatabase` only warns today for Turso incremental schema failures):

```ts
try {
  setupDatabase()
} catch (err) {
  console.error('[server] Database startup failed:', (err as Error).message)
  process.exit(1)
}
```

Also ensure Turso open errors inside `setupDatabase()` are **fatal** (not swallowed as “non-fatal” if the user wants strict Turso-only). Current turso branch catches incremental schema errors as non-fatal — decide:

- **Option A (recommended for “Turso only”):** if `getDb()` throws, startup dies; incremental schema apply failures can remain warnings.
- **Option B (stricter):** any Turso error during setup exits the process.

### Phase 10 — Verification

Run from `server/`:

1. **Happy path**
   ```bash
   npm run dev
   # Expect logs similar to:
   # [db] Connecting to Turso via embedded replica: libsql://...
   # [db] Turso embedded replica ready
   # [db] turso mode — applying incremental schema to Turso
   ```
   Hit a simple authenticated or health endpoint that queries the DB.

2. **Missing credentials**
   - Temporarily rename `TURSO_AUTH_TOKEN` in env
   - Start server
   - Expect immediate error, **no** `[db] Using local SQLite path: ...`

3. **Invalid Turso URL / network failure**
   - Point URL at a bad host
   - Expect throw after retry, no `data.db` creation/open

4. **Settings API**
   ```bash
   # should 400
   PUT /api/settings/database_mode { "value": "sqlite" }
   # should 200
   PUT /api/settings/database_mode { "value": "turso" }
   ```

5. **SQL Server mode regression** (if Azure credentials available)
   - `DB_MODE=sqlserver` still connects via `getDbAsync()` as before

6. **Grep guard** after implementation:
   ```bash
   # From repo root — runtime code should not open data.db
   rg "data\\.db|mode: 'sqlite'|DB_MODE=sqlite|resolveDbPath" server/src
   ```
   Expect no remaining startup-path matches (scripts under `server/scripts/` may still mention `data.db`).

### Phase 11 — Optional cleanup (same PR or follow-up)

- Delete unused local DB utility scripts or add a header: `// OFFLINE ONLY — not used by server startup`.
- Add `data.db` / `data.db-*` to `.gitignore` if not already ignored.
- Remove stale `.db-mode` file if it contains `sqlite`.
- Document for the team: always set Turso env vars in local dev.

---

## Impacted Files

### Must edit

| File | Change |
|---|---|
| `server/src/database/db.ts` | Remove sqlite target, fallbacks, mode unions; Turso-only `getDb()`; tighten `resolveDbTarget` / `setupDatabase` |
| `server/src/routes/settings.ts` | Reject `database_mode=sqlite` |
| `server/.env.example` | Remove local SQLite fallback documentation; require Turso |

### Should edit

| File | Change |
|---|---|
| `client/src/pages/SettingsPage.tsx` | Narrow TS types for database mode |
| `server/src/index.ts` | Optional: fatal exit if `setupDatabase()` / initial Turso connect fails |
| `migration/migration_guide.md` | Deprecate `DB_MODE=sqlite` docs (if maintained) |

### Do not edit (unless doing follow-up cleanup)

| File | Reason |
|---|---|
| `server/src/database/schema.ts` | Still useful for reference / offline tooling |
| `server/src/database/adapters/libsql-adapter.ts` | Still used for Turso |
| `server/scripts/migrate-local-db.mjs` and other `data.db` scripts | Offline tools |
| `server/src/database/sql.ts` | `'sqlite'` dialect name remains correct for Turso |

### Runtime artifacts (not source, but behavior change)

| Artifact | Notes |
|---|---|
| `server/data.db` | No longer opened by app; safe to archive/delete manually after backup |
| `server/turso-replica.db` | **Still used** as Turso embedded replica cache |
| `server/.db-mode` | Should not contain `sqlite`; values `turso` \| `sqlserver` only |

---

## Detailed Code Touchpoints in `db.ts` (checklist for implementer)

Use this as a search checklist inside `server/src/database/db.ts`:

- [ ] `dbConnectedMode: 'turso' | 'sqlite'`
- [ ] `TURSO_RETRY_AFTER_FALLBACK_MS` and fallback retry block in `getDb`
- [ ] `DbTarget` sqlite variant
- [ ] `normalizeDatabaseMode` allows `sqlite`
- [ ] `resolveDbPath` / `normalizeSqlitePath`
- [ ] Final dev fallback in `resolveDbTarget`
- [ ] Local open path after Turso failure (`Using local SQLite path`)
- [ ] `setupDatabase` non-turso/non-sqlserver full migration branch
- [ ] Production-only Turso throw vs dev fallback (make both throw)
- [ ] Comments that promise “falling back to local SQLite”

---

## Rollback / Verification Plan

### Rollback

1. Revert the PR / restore previous `server/src/database/db.ts`, `settings.ts`, and `.env.example`.
2. If `.db-mode` was rewritten, restore prior content or delete the file (env `DB_MODE` takes precedence when set).
3. Local `data.db` is unchanged by the code change unless an operator deleted it manually — restore from backup if needed.
4. Restart server; confirm previous fallback log lines return if Turso is forced offline.

### Verification of success

| Check | Pass criteria |
|---|---|
| Dev startup with valid Turso env | Logs Turso embedded replica ready; app serves API data from Turso |
| Dev startup without Turso env | Process fails with clear error; **no** new/updated `data.db` access logs |
| Turso outage simulation | Error surfaced; no silent switch to empty local DB |
| Settings PUT `sqlite` | HTTP 400 |
| Settings PUT `turso` / `sqlserver` | HTTP 200 (sqlserver still requires restart + creds as today) |
| SQL Server mode | Unaffected when `DB_MODE=sqlserver` |
| Grep `server/src` for runtime sqlite file path | No `resolveDbPath` / `data.db` open path |

### Risk notes

- **Developers without Turso credentials** can no longer “just run” against an empty local file. Mitigation: keep shared Turso dev DB credentials in a secure team store; document in README/env example.
- **Embedded replica is still a local file** (`turso-replica.db`). This is intentional and required by the current libsql embedded-replica approach; it is not a separate app database mode.
- Making Turso failures fatal may increase downtime visibility during Turso free-tier wake delays. Mitigation: keep `wakeUpTurso` / sync retry; optionally add a short bounded retry loop **without** sqlite fallback before throwing.

---

## Suggested Implementation Order (when approved)

1. Phase 0 pre-flight (credentials + optional data migrate)  
2. Phases 1–5 (`db.ts` core)  
3. Phase 6 (settings API)  
4. Phase 7 (client types)  
5. Phase 8 (env example)  
6. Phase 9 (startup fatal — optional but recommended)  
7. Phase 10 verification  
8. Commit with message like: `fix: remove local SQLite fallback; require Turso at startup`

---

## Open Questions (resolve before / during implementation)

1. Should SQL Server auto-detect (when Azure env vars exist but `DB_MODE` is unset) remain, or should unset mode always mean Turso-only?  
   - **Default recommendation:** keep existing SQL auto-detect behavior except remove sqlite; default mode stays `turso`.
2. Should Turso incremental schema failure abort startup or stay non-fatal?  
   - **Default recommendation:** connection failure = fatal; incremental DDL failure = warn (matches current Turso branch).
3. Delete unreachable `runMigrations` bulk code in the same PR or leave for a cleanup PR?  
   - **Default recommendation:** leave function body, remove call path; cleanup later to keep the PR reviewable.
