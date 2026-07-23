# Plan: Remove Local SQLite — Cloud-Only Database (Turso / Azure SQL)

**Date:** 2026-07-23  
**Status:** Draft — awaiting review before implementation  
**Author:** Generated from user request  
**Primary files affected:** `server/src/database/db.ts`, `server/src/routes/settings.ts`, `server/.env.example`, `client/src/pages/SettingsPage.tsx`

---

## Executive Summary

The application currently supports three database backends: **Turso** (cloud SQLite via embedded replica), **Azure SQL Server**, and a **local SQLite file** (`data.db`) used as a development fallback. When Turso credentials are missing or the Turso connection fails at startup, `getDb()` silently falls back to opening a local `data.db` file. This creates confusion — developers may run against stale local data without realizing Turso is offline.

This plan removes **all local SQLite (`data.db`) references** from the startup path, runtime DB resolution, settings API, client types, and documentation. The app will connect **only** to cloud Turso (via embedded replica) or Azure SQL Server. If the database is unavailable, instead of crashing or silently falling back, the app should display the user-friendly message:

> **"Database connectivity not available. Please try again later."**

This error message approach ensures the server can continue serving the frontend (static assets, etc.) while the DB is unavailable, and the frontend can show a proper error state rather than a white screen or 500.

---

## Scope

### In scope

1. Remove the local SQLite (`mode: 'sqlite'` / `data.db`) connection target from runtime DB resolution in `server/src/database/db.ts`.
2. Remove Turso → local SQLite fallback in `getDb()` (both dev and prod — never open `data.db`).
3. Remove the "retry Turso after falling back to SQLite" health-check branch (`TURSO_RETRY_AFTER_FALLBACK_MS` and associated block).
4. Stop accepting `DB_MODE=sqlite` / `database_mode=sqlite` in config, `.db-mode` persistence, and Settings API (`server/src/routes/settings.ts`).
5. Change the Settings API validation to only allow `turso` and `sqlserver`, returning HTTP 400 if `sqlite` is sent.
6. Narrow client-side types in `SettingsPage.tsx` to `'turso' | 'sqlserver'`.
7. Update `server/.env.example` to remove local SQLite fallback documentation.
8. **New:** When the database is unreachable (Turso credentials missing, Turso sync fails, SQL Server fails), return a graceful error rather than crashing the process or falling back. The error surface is:
   - **API routes that need a database:** return HTTP 503 with JSON body `{ "error": "Database connectivity not available. Please try again later." }`
   - **Startup:** warn but don't exit; the server stays alive to serve static files / frontend assets. Routes that hit the DB will return the 503.
   - **Frontend API calls:** handle 503 responses and display the message to the user in a toast/alert.
9. Keep **Turso embedded replica** (`turso-replica.db`) — this is a local cache of the *online* Turso DB, not a standalone local database.
10. Keep **SQL Server** mode unchanged (still a valid explicit mode).

### Out of scope

- Deleting historical one-off scripts that open `data.db` for manual migration/debug (`server/scripts/migrate-local-db.mjs`, `check-db.mjs`, etc.). These are offline tools, not startup paths. Optionally mark them deprecated in comments later.
- Removing `libsql` package or SQLite SQL dialect support (Turso *is* SQLite-compatible; `getDialect()` returning `'sqlite'` for Turso is correct).
- Migrating data from local `data.db` into Turso (assume Turso is already the source of truth; if local has unique data, run migration scripts *before* implementing this plan).
- Changing SQL Server connection or seed logic.
- Deleting `server/data.db` from disk automatically (operator may keep a backup; optional manual cleanup step).
- Editing `sqlite_master` references used in Turso queries — these are internal Turso/libsql table queries, not standalone SQLite file references.

---

## Current Behavior (what we are removing)

### Connection resolution (`resolveDbTarget` in `server/src/database/db.ts`)

Current resolution order:

1. Explicit `DB_MODE=sqlserver` (+ Azure credentials) → SQL Server
2. Auto-detect Azure credentials when mode is not turso/sqlite → SQL Server
3. Valid `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` (or `DATABASE_URL` / `DATABASE_AUTH_TOKEN`) → Turso
4. **Else (dev only):** fall back to local SQLite via `resolveDbPath()` → `data.db`
5. Production without credentials → throw

### `getDb()` fallback to local SQLite

Even when target mode is Turso:
- Opens embedded replica at `turso-replica.db` with `syncUrl` + `authToken`
- On failure in **non-production**, logs a warning and **opens local `data.db`** instead
- Tracks `dbConnectedMode = 'sqlite'` and later retries Turso every 30 seconds

### Runtime fallback paths

Multiple fallback paths exist:
1. **`resolveDbTarget()`** line ~602: Development-only SQLite fallback when no credentials
2. **`getDb()`** lines ~798-811: After Turso replica corruption wipe + retry fails, falls back to local SQLite
3. **`getDb()`** lines ~802-811: Non-corruption Turso failure falls back to local SQLite
4. **`getDb()`** lines ~814-841: Fallthrough path that opens `data.db` directly (the catch-all)
5. **`setupDatabase()`** lines ~1074-1116: Full `createSchema`/`runMigrations`/`seedData` path for `sqlite` mode and malformed DB recovery
6. **`TURSO_RETRY_AFTER_FALLBACK_MS`** block: Retry Turso every 30s when previously fell back to SQLite

### Mode surface area — SQLite references to remove

| Location | What to change |
|---|---|
| `db.ts` line 14: `dbConnectedMode: 'turso' \| 'sqlite' \| null` | Remove `'sqlite'` |
| `db.ts` line 25: `TURSO_RETRY_AFTER_FALLBACK_MS` | Remove entire constant |
| `db.ts` line 63: `DbTarget` — `{ mode: 'sqlite'; dbPath: string }` | Remove variant |
| `db.ts` line 69: `normalizeDatabaseMode` allows `sqlite` | Remove `'sqlite'` |
| `db.ts` line 75: `readPersistedDatabaseMode` return type | Tighten to `'turso' \| 'sqlserver' \| null` |
| `db.ts` line 112: `getConfiguredDatabaseMode` | Tighten return type |
| `db.ts` line 116: `setConfiguredDatabaseMode` param | Tighten |
| `db.ts` lines 543-558: `normalizeSqlitePath`, `resolveDbPath` | Remove entirely |
| `db.ts` lines 560-604: `resolveDbTarget()` final fallback | Remove SQLite branch |
| `db.ts` lines 614-642: `cleanupDatabaseFiles`, `resetDatabase` | Remove (or keep for replica-only use) |
| `db.ts` lines 644-664: `applyPragmas` | Remove (or verify caller list) |
| `db.ts` lines 702-736: Retry-Turso-after-SQLite-fallback block | Remove entire block |
| `db.ts` lines 814-841: Local SQLite open path | Remove entirely |
| `db.ts` lines 1053-1072: `setupDatabase()` sqlite branch | Remove initialize/createSchema/runMigrations/seedData path |
| `db.ts` lines 1074-1116: Malformed SQLite DB retry | Remove `if (target.mode !== 'sqlite')` check + reset branch |
| `settings.ts` line 443: `normalized !== 'sqlite'` | Remove `sqlite` from allowed values |
| `settings.ts` line 447: cast type | Tighten |
| `.env.example` lines 4-5: Local SQLite fallback | Remove or reword |
| `SettingsPage.tsx` line ~: `handleDatabaseModeChange` type | Narrow to `'turso' \| 'sqlserver'` |

### NOT changing (keep as-is)

These reference `sqlite` or `data.db` but are not part of the runtime startup path:

| Location | Reason to keep |
|---|---|
| `server/src/database/adapter.ts` line: `dialect: 'sqlite' \| 'sqlserver'` | Turso *is* SQLite-compatible; dialect name reflects SQL syntax |
| `server/src/database/sql.ts` line: `getDialect()` returning `'sqlite'` | Same — SQL dialect name, not a mode choice |
| `server/src/database/adapters/libsql-adapter.ts` line: `dialect = 'sqlite'` | Same |
| `server/src/database/adapters/mssql-adapter.ts` | Target for SQL Server SQL translation; no local file references |
| `server/scripts/migrate-local-db.mjs` | Offline migration tool |
| `sqlite_master` queries throughout `db.ts` | These are internal Turso/libsql system table queries, not standalone SQLite |

---

## Target Behavior

1. **Startup with valid Turso credentials** → connect via embedded replica; apply incremental schema; never open `data.db`.
2. **Startup with `DB_MODE=sqlserver` + valid Azure credentials** → SQL Server (unchanged).
3. **Missing/invalid credentials (no Turso, no SQL Server)** → server starts, logs warning, API routes return HTTP 503 with `"Database connectivity not available. Please try again later."`
4. **Turso connection/sync failure at runtime** → existing stream-expired reset logic remains, but if reset also fails → set `db = null`, next request returns 503.
5. **`DB_MODE=sqlite` or persisted `.db-mode` of `sqlite`** → reject / ignore with a warning; API returns 400 if explicitly set to `sqlite`.
6. **Settings API PUT `database_mode=sqlite`** → HTTP 400 with message.

### Graceful error propagation strategy

Instead of `process.exit(1)` on DB failure, we use a **controlled error return** pattern:

- **`getDb()`** returns `AppDatabase` or throws. When it throws, the caller (route/middleware) catches and returns 503.
- **`resolveDbTarget()`** no longer has a "dev fallback" branch. If no valid target is found, it returns a sentinel or throws with a clear message.
- **`setupDatabase()`** at startup: if Turso cannot connect, log a warning but do not crash. The server stays alive.
- **All route handlers** that call `getDb()` / `getDbAsync()` should wrap in try/catch and return 503 on failure.
- A **middleware** can be added to pre-check DB availability and return 503 early.
- **Frontend** should handle 503 responses from API calls and display the message toast/alert.

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
   node scripts/migrate-local-db.mjs
   ```
3. Ensure `server/.env` has valid Turso or SQL Server credentials.
4. Back up `server/data.db` if data exists there.
5. Note: `turso-replica.db` is fine to keep; it is the embedded cache.

### Phase 1 — Tighten types and mode parsing in `db.ts`

**File:** `server/src/database/db.ts`

1. Change `dbConnectedMode` from `'turso' | 'sqlite' | null` → `'turso' | null`
2. Remove `TURSO_RETRY_AFTER_FALLBACK_MS` constant (line 25).
3. Remove `{ mode: 'sqlite'; dbPath: string }` from `DbTarget` type.
4. Change mode unions from `'turso' | 'sqlserver' | 'sqlite'` → `'turso' | 'sqlserver'` in:
   - `normalizeDatabaseMode` (line 67)
   - `readPersistedDatabaseMode` return type (line 75)
   - `getConfiguredDatabaseMode` return type (line 112)
   - `setConfiguredDatabaseMode` parameter type (line 116)
5. If persisted `.db-mode` contains `sqlite`, log a warning and treat as unset (fall through to env default or throw).
6. Update `getConfiguredDatabaseMode()` to no longer default to `'turso'` — default to `null` and let callers handle no-mode gracefully.

### Phase 2 — Remove local path helpers used only for standalone SQLite

**File:** `server/src/database/db.ts`

Remove:
- `normalizeSqlitePath` (lines 543-545)
- `resolveDbPath` (lines 547-558)
- `cleanupDatabaseFiles` (lines 614-632) — **unless** it's also used for replica wipe (check callers)
- `resetDatabase` (lines 634-642) — **unless** used for replica
- `applyPragmas` (lines 644-664) — only used when opening standalone local files

### Phase 3 — Rewrite `resolveDbTarget()` (fail gracefully)

**File:** `server/src/database/db.ts`

New logic:
```ts
function resolveDbTarget(): DbTarget | null {
  const configuredMode = getConfiguredDatabaseMode()

  // ── Explicit DB_MODE=sqlserver ──
  if (configuredMode === 'sqlserver') {
    const sqlServer   = process.env.AZURE_SQL_SERVER?.trim()
    const sqlDatabase = process.env.AZURE_SQL_DATABASE?.trim()
    const sqlUser     = process.env.AZURE_SQL_USER?.trim()
    const sqlPassword = process.env.AZURE_SQL_PASSWORD?.trim()
    if (sqlServer && sqlDatabase && sqlUser && sqlPassword) {
      return { mode: 'sqlserver', server: sqlServer, database: sqlDatabase, user: sqlUser, password: sqlPassword }
    }
    console.warn('[db] DB_MODE=sqlserver set but AZURE_SQL_* credentials are missing.')
    return null
  }

  // ── Auto-detect SQL Server (when mode is unset) ──
  if (!configuredMode) {
    const sqlServer   = process.env.AZURE_SQL_SERVER?.trim()
    const sqlDatabase = process.env.AZURE_SQL_DATABASE?.trim()
    const sqlUser     = process.env.AZURE_SQL_USER?.trim()
    const sqlPassword = process.env.AZURE_SQL_PASSWORD?.trim()
    if (sqlServer && sqlDatabase && sqlUser && sqlPassword) {
      return { mode: 'sqlserver', server: sqlServer, database: sqlDatabase, user: sqlUser, password: sqlPassword }
    }
  }

  // ── Turso ──
  const tursoUrl   = (process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL)?.trim()
  const tursoToken = (process.env.DATABASE_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN)?.trim()
  if (looksLikeValidTursoConnection(tursoUrl, tursoToken)) {
    return { mode: 'turso', url: tursoUrl!, authToken: tursoToken! }
  }

  // ── No valid database configured ──
  return null
}
```

**Key changes:**
- Remove `'sqlite'` from `configuredMode` checks.
- Remove final `return { mode: 'sqlite', dbPath: resolveDbPath() }` branch.
- Remove the dev-vs-prod distinction (both environments require cloud DB).
- Return `null` when no target is found (callers handle gracefully instead of throwing).

### Phase 4 — Rewrite `getDb()` — no fallback, throw with user-friendly message

**File:** `server/src/database/db.ts`

1. **Remove:**
   - The retry-Turso-after-SQLite-fallback block (lines 702-736).
   - The local SQLite open path (lines 814-841).
   - The `Using local SQLite path` log line.
   - `applyPragmas` call (already removed in Phase 2).
   - `dbConnectedMode = 'sqlite'` assignments.
   - The catch-all `const dbPath = resolveDbPath()` block.
2. **Modify Turso failure handling:**
   - On corruption: wipe replica, retry once. If still fails → throw with message about DB unavailable.
   - On non-corruption failure: throw (no SQLite fallback even in dev).
   - Remove the `if (process.env.NODE_ENV === 'production')` check — both environments throw.
3. **Add helper:**
   ```ts
   export function isDatabaseAvailable(): boolean {
     try {
       if (db) return true
       const target = resolveDbTarget()
       return target !== null
     } catch {
       return false
     }
   }
   ```

### Phase 5 — Add DB availability middleware and 503 handling

**File:** `server/src/database/db.ts` (expose function)  
**File:** `server/src/index.ts` or new `server/src/middleware/dbCheck.ts`

Create a middleware that checks DB availability before every API route:
```ts
// middleware/dbCheck.ts
import { isDatabaseAvailable } from '../database/db'
import type { Request, Response, NextFunction } from 'express'

export function requireDatabase(req: Request, res: Response, next: NextFunction): void {
  if (!isDatabaseAvailable()) {
    res.status(503).json({
      error: 'Database connectivity not available. Please try again later.',
    })
    return
  }
  next()
}
```

Apply to all API routes that need DB access.

Alternatively (simpler): modify `getDb()` and `getDbAsync()` to never throw for "no DB" — instead return null, and have routes check or wrap in try/catch returning 503.

### Phase 6 — Simplify `setupDatabase()`

**File:** `server/src/database/db.ts`

Remove the `initialize` / `createSchema` / `runMigrations` / `seedData` branch that runs for standalone SQLite:
```ts
export function setupDatabase(): void {
  const mode = getConfiguredDatabaseMode()

  if (mode === 'sqlserver') {
    console.log('[db] sqlserver mode — skipping local schema/migration setup')
    return
  }

  if (mode === 'turso') {
    console.log('[db] turso mode — applying incremental schema to Turso')
    try {
      const database = getDb()
      applyIncrementalSchema(database)
      try { database.sync() } catch { /* sync failure is non-fatal */ }
      console.log('[db] Turso incremental schema applied')
    } catch (err) {
      console.warn('[db] Turso incremental schema failed (non-fatal):', (err as Error).message)
    }
    return
  }

  // Mode is null — no database configured. Log warning and continue.
  // Routes will return 503 when accessed.
  console.warn('[db] No database mode configured. API routes requiring DB will return 503.')
}
```

**Also remove:**
- The `initialize` function (lines 1074-1078)
- The `isTursoError` function (lines 1080-1083) — only used in retry loop
- The 3-attempt retry loop (lines 1086-1114) — simplify to single attempt
- The malformed-SQLite-db recovery block (lines 1098-1105)

**Note:** `runMigrations` function body (lines 1118-2365) can remain in the file for now — it may be called by offline scripts. Just remove the call path from `setupDatabase()`.

### Phase 7 — Settings API

**File:** `server/src/routes/settings.ts`

1. In PUT `database_mode` validation, allow only `turso` and `sqlserver`:
   ```ts
   if (normalized !== 'turso' && normalized !== 'sqlserver') {
     res.status(400).json({ error: 'database_mode must be one of: turso, sqlserver' })
     return
   }
   setConfiguredDatabaseMode(normalized as 'turso' | 'sqlserver')
   ```

### Phase 8 — Client types

**File:** `client/src/pages/SettingsPage.tsx`

1. Narrow `handleDatabaseModeChange` parameter type to `'turso' | 'sqlserver'`:
   ```ts
   async function handleDatabaseModeChange(nextValue: 'turso' | 'sqlserver') {
   ```
2. Verify no UI radio still offers `sqlite` (current UI already only has Turso + SQL Server).
3. Consider adding a connectivity status indicator that calls `/api/health` or similar to show if DB is available.

### Phase 9 — Env / docs cleanup

1. **`server/.env.example`:**
   - Remove lines 4-5 (local SQLite fallback path comment).
   - Require Turso vars or SQL Server vars.
   - Explicitly note: local standalone SQLite is not supported.
2. **`migration/migration_guide.md`** (optional): Remove `DB_MODE=sqlite` section.
3. **Do not commit secrets** from `server/.env`.

### Phase 10 — Startup health check (optional hardening)

**File:** `server/src/index.ts`

Today `setupDatabase()` is called at startup. With graceful error handling, the server should start regardless of DB availability:
```ts
try {
  setupDatabase()
} catch (err) {
  console.warn('[server] Database setup failed (server will continue):', (err as Error).message)
}
```

If desired, add a `/api/health` endpoint that checks DB connectivity and returns 503 if unavailable:
```ts
router.get('/health', async (req: Request, res: Response) => {
  if (isDatabaseAvailable()) {
    res.json({ status: 'ok', database: 'connected' })
  } else {
    res.status(503).json({
      status: 'error',
      database: 'disconnected',
      message: 'Database connectivity not available. Please try again later.',
    })
  }
})
```

### Phase 11 — Verification

Run from `server/`:

1. **Happy path (Turso)**
   ```bash
   npm run dev
   # Expect logs:
   # [db] turso mode — applying incremental schema to Turso
   # [db] Turso embedded replica ready
   ```
   Hit a simple API endpoint — expect 200 with data.

2. **Missing credentials**
   - Rename `TURSO_AUTH_TOKEN` in env
   - Start server — expect log warning but **no crash**
   - Hit any API endpoint — expect HTTP 503 with `"Database connectivity not available. Please try again later."`

3. **Invalid Turso URL / network failure**
   - Point URL at a bad host
   - Expect warning log, server stays alive, API returns 503

4. **Settings API**
   ```bash
   # should 400
   PUT /api/settings/database_mode { "value": "sqlite" }
   # should 200
   PUT /api/settings/database_mode { "value": "turso" }
   PUT /api/settings/database_mode { "value": "sqlserver" }
   ```

5. **SQL Server mode regression** (if Azure credentials available)
   - `DB_MODE=sqlserver` still connects via `getDbAsync()` as before

6. **Grep guard** after implementation:
   ```bash
   # From repo root — runtime code should not open data.db
   rg "data\\.db|mode: 'sqlite'|DB_MODE=sqlite|resolveDbPath|normalizeSqlitePath" server/src
   ```
   Expect no remaining startup-path matches (scripts under `server/scripts/` may still mention `data.db`).

7. **Frontend 503 handling**
   - Simulate DB unavailable
   - Open the app in the browser
   - Attempt an API-driven action
   - Verify the message "Database connectivity not available. Please try again later." appears

---

## Impacted Files

### Must edit

| File | Change |
|---|---|
| `server/src/database/db.ts` | Remove sqlite target, fallbacks, mode unions; Turso-only `getDb()`; tighten `resolveDbTarget` / `setupDatabase`; add `isDatabaseAvailable()` |
| `server/src/routes/settings.ts` | Reject `database_mode=sqlite` |
| `server/.env.example` | Remove local SQLite fallback documentation |
| `client/src/pages/SettingsPage.tsx` | Narrow TS types for database mode |

### Should edit

| File | Change |
|---|---|
| `server/src/index.ts` | Graceful startup — don't crash if DB unavailable |
| `server/src/middleware/dbCheck.ts` | **New file:** middleware that checks DB and returns 503 |
| Route files (all that use `getDb()`/`getDbAsync()`) | Wrap in try/catch or apply DB middleware |
| `migration/migration_guide.md` | Deprecate `DB_MODE=sqlite` docs (if maintained) |

### Do not edit

| File | Reason |
|---|---|
| `server/src/database/schema.ts` | Still useful for reference / offline tooling |
| `server/src/database/sql.ts` | `'sqlite'` dialect name remains correct for Turso |
| `server/src/database/adapters/libsql-adapter.ts` | Still used for Turso |
| `server/src/database/adapters/mssql-adapter.ts` | SQL Server adapter |
| `server/src/database/adapter.ts` | Interface definition — `'sqlite'` dialect is correct for Turso |
| `server/scripts/migrate-local-db.mjs` and other `data.db` scripts | Offline tools |

### Runtime artifacts

| Artifact | Notes |
|---|---|
| `server/data.db` | No longer opened by app; safe to archive/delete manually after backup |
| `server/turso-replica.db` | **Still used** as Turso embedded replica cache |
| `server/.db-mode` | Should not contain `sqlite`; values `turso` \| `sqlserver` only |

---

## Rollback / Verification Plan

### Rollback

1. Revert the PR / restore previous `server/src/database/db.ts`, `settings.ts`, and `.env.example`.
2. If `.db-mode` was rewritten, restore prior content or delete the file (env `DB_MODE` takes precedence when set).
3. Local `data.db` is unchanged — restore from backup if needed.
4. Restart server; confirm previous fallback log lines return if Turso is forced offline.

### Verification of success

| Check | Pass criteria |
|---|---|
| Dev startup with valid Turso env | Logs Turso embedded replica ready; app serves API data from Turso |
| Dev startup without Turso env | Server starts (no crash); logs warning; API returns 503 with message |
| Turso outage simulation | 503 returned; no silent switch to empty local DB |
| Settings PUT `sqlite` | HTTP 400 |
| Settings PUT `turso` / `sqlserver` | HTTP 200 |
| SQL Server mode | Unaffected when `DB_MODE=sqlserver` |
| Frontend shows error message | User sees "Database connectivity not available. Please try again later." |
| Grep `server/src` for runtime sqlite file path | No `resolveDbPath` / `data.db` / `normalizeSqlitePath` open path |

### Risk notes

- **Developers without Turso credentials** can no longer "just run" against an empty local file. Mitigation: keep shared Turso dev DB credentials in a secure team store; document in README/env example.
- **Embedded replica is still a local file** (`turso-replica.db`). This is intentional and required by the current libsql embedded-replica approach; it is not a separate app database mode.
- **Server stays alive without DB** — this is by design so the frontend (static assets) can still be served. All API routes that need DB return 503.

---

## Detailed Code Touchpoints in `db.ts` (checklist for implementer)

Use this as a search checklist inside `server/src/database/db.ts`:

- [ ] Line 14: `dbConnectedMode: 'turso' | 'sqlite' | null`
- [ ] Line 25: `TURSO_RETRY_AFTER_FALLBACK_MS` and fallback retry block
- [ ] Line 63: `DbTarget` sqlite variant
- [ ] Line 69: `normalizeDatabaseMode` allows `sqlite`
- [ ] Line 75: `readPersistedDatabaseMode` return type
- [ ] Line 112: `getConfiguredDatabaseMode` return type
- [ ] Line 116: `setConfiguredDatabaseMode` param type
- [ ] Lines 543-558: `resolveDbPath` / `normalizeSqlitePath`
- [ ] Line 601-603: Final dev fallback in `resolveDbTarget`
- [ ] Lines 614-642: `cleanupDatabaseFiles`, `resetDatabase` (verify if used only for standalone SQLite)
- [ ] Lines 644-664: `applyPragmas` (verify callers)
- [ ] Lines 702-736: Turso retry after SQLite fallback block
- [ ] Lines 798-811: "Turso retry also failed, falling back to local SQLite"
- [ ] Lines 814-841: Local SQLite open path (`const dbPath = resolveDbPath()`)
- [ ] Lines 1053-1116: `setupDatabase` full migration branch + retry loop
- [ ] Lines 1074-1078: `initialize()` function that calls createSchema/runMigrations/seedData
- [ ] Lines 1080-1083: `isTursoError` function
- [ ] Comments promising "falling back to local SQLite"

---

## Suggested Implementation Order (when approved)

1. **Phase 0** — Pre-flight (credentials + optional data migration)
2. **Phases 1–5** — `db.ts` core changes (types, resolveDbTarget, getDb, setupDatabase)
3. **Phase 6** — New DB-check middleware / 503 handling
4. **Phase 7** — Settings API (`server/src/routes/settings.ts`)
5. **Phase 8** — Client types (`client/src/pages/SettingsPage.tsx`)
6. **Phase 9** — Env example cleanup (`server/.env.example`)
7. **Phase 10** — Startup hardening (`server/src/index.ts`)
8. **Phase 11** — Verification
9. **Commit** with message: `feat: remove local SQLite fallback; cloud-only DB with graceful 503 on unavailability`

---

~~~

## Open Questions (resolved)

The following decisions have been confirmed by the requester:

1. **Default mode when unset** → `"turso"` (keep `getConfiguredDatabaseMode()` defaulting to `'turso'`; SQL Server auto-detect only applies when explicit `DB_MODE=sqlserver` is set).
2. **Turso connection failure at startup** → **non-fatal** (log warning, server stays alive, routes return 503).
3. **`runMigrations` bulk code** → **leave** the function body in `db.ts`; only remove the call path from `setupDatabase()`. Cleanup can happen in a follow-up PR.
4. **503 middleware scope** → **applied globally** to all `/api/` routes (single middleware registered at the router level).
5. **Health endpoint** → **yes**, add `GET /api/health` that returns DB connectivity status and 503 with the user-facing message when unavailable.
~~~
