# SQL Server Migration Log

## Goal
Replace the runtime database layer from Turso/libsql (SQLite) to support both:
- **SQL Server (Azure)** — production (`DB_MODE=sqlserver`)
- **Turso/SQLite** — development/testing (`DB_MODE=turso` or `DB_MODE=sqlite`)

A unified async `DbAdapter` interface is introduced so routes/services are database-agnostic.

---

## Phases

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Define `DbAdapter` interface | ✅ Complete |
| 2 | Implement `LibsqlAdapter` and `MssqlAdapter` | ✅ Complete |
| 3 | Update `db.ts` — `getDbAsync(): Promise<DbAdapter>` | ✅ Complete |
| 4 | Convert all routes & services to async/await | ✅ Complete |
| 5 | SQL dialect abstraction (`sql.ts` helpers) | ✅ Complete |
| 6 | Guard `schema.ts` / migrations for SQL Server mode | ✅ Complete |
| 7 | Environment config & verification | ✅ Complete |

---

## Phase 1 — DbAdapter Interface ✅

**File created:** `server/src/database/adapter.ts`

Defines the `DbAdapter` interface with four async methods:
- `queryAll<T>(sql, params?)` — returns all rows
- `queryOne<T>(sql, params?)` — returns first row or undefined
- `execute(sql, params?)` — INSERT/UPDATE/DELETE, returns `lastInsertRowid`
- `transaction<T>(fn)` — atomic block
- `dialect` property — `'sqlite'` or `'sqlserver'`

All methods use `?` as the parameter placeholder; adapters convert to the correct dialect internally.

---

## Phase 2 — Adapters ✅

### LibsqlAdapter ✅
**File created:** `server/src/database/adapters/libsql-adapter.ts`

Wraps the synchronous `libsql` Database instance behind the `DbAdapter` interface. All sync calls are wrapped in resolved `Promise`s. Exposes `getRawDb()` for migration/schema code. Returns `{ lastInsertRowid, changes }`.

### MssqlAdapter ✅
**File created:** `server/src/database/adapters/mssql-adapter.ts`

Wraps `mssql.ConnectionPool` behind `DbAdapter`. Converts `?` → `@p0, @p1, ...` automatically. For INSERT statements, appends `; SELECT SCOPE_IDENTITY() AS _last_id` to retrieve the new row ID. Nested transactions run in the same SQL Server transaction context. Type-safe parameter binding (NVarChar, BigInt, Float, Bit).

---

## Phase 3 — `db.ts` Update ✅

**File modified:** `server/src/database/db.ts`

Changes made:
- Added `import sql from 'mssql'`, `LibsqlAdapter`, `MssqlAdapter`, `DbAdapter` imports
- Added `mssqlPool` and `mssqlPoolConnecting` module-level cache variables
- Added `getDbAsync(): Promise<DbAdapter>` — creates/reuses mssql pool for SQL Server, wraps libsql in LibsqlAdapter for Turso/SQLite
- Added `closeMssqlPool()` for graceful shutdown
- Updated `setupDatabase()` to be a no-op for `DB_MODE=sqlserver` (schema already exists in Azure SQL)
- Kept existing `getDb(): AppDatabase` for migration/schema code (libsql modes only)

---

## Phase 4 — Routes & Services ✅

All 23 files converted to use `await getDbAsync()` and the `DbAdapter` interface:

**Routes (18 files):** `approvals`, `auth`, `categories`, `collections`, `gallery-assets`, `groups`, `health`, `invitations`, `locations`, `my-submissions`, `notifications`, `organizations`, `preferences`, `settings`, `signup-slots`, `stats`, `ticket-templates`, `users`

**Services (2 files):** `approvalWorkflows`, `notifications`

**Lib/Middleware (3 files):** `userAccess`, `organizationAccess`, `index`

Key changes per file:
- `const db = getDb()` → `const db = await getDbAsync()`
- `.prepare('...').get(p)` → `await db.queryOne('...', [p])`
- `.prepare('...').all(p)` → `await db.queryAll('...', [p])`
- `.prepare('...').run(p)` → `await db.execute('...', [p])`
- `db.exec('...')` → `await db.execute('...')`
- `db.transaction(() => {...})` → `await db.transaction(async (tx) => {...})`
- `loadUserAccessProfile(...)` → `await loadUserAccessProfile(...)`
- `loadRequestUserContext(req)` → `await loadRequestUserContext(req)`
- `.map()` callbacks with async calls converted to `Promise.all(arr.map(async ...))`
- `forEach` loops with DB calls converted to `for...of` with `await`

---

## Phase 5 — SQL Dialect Helpers ✅

**File created:** `server/src/database/sql.ts`

- `getDialect()` — returns `'sqlite'` or `'sqlserver'` based on `DB_MODE`
- `nowExpr()` — `datetime('now')` for SQLite, `GETUTCDATE()` for SQL Server
- `insertOrIgnore(table, cols, conflictCols)` — generates `INSERT OR IGNORE` (SQLite) or `IF NOT EXISTS INSERT` (SQL Server)

---

## Phase 6 — Schema / Migration Guard ✅

`setupDatabase()` in `db.ts` returns immediately when `DB_MODE=sqlserver`, skipping all `createSchema()`, `runMigrations()`, and `seedData()` calls. The entire migration codebase continues to use the raw `libsql` API and is never invoked for SQL Server.

---

## Phase 7 — Environment Config ✅

- Local `.env`: `DB_MODE=turso` — uses Turso/SQLite for dev/test
- Azure App Settings: `DB_MODE=sqlserver` — uses Azure SQL Server for production
- `.env` is gitignored — credentials never committed
- `@types/mssql` installed as a dev dependency

**TypeScript compile result: 0 errors**

---

## New Files Created

| File | Purpose |
|------|---------|
| `server/src/database/adapter.ts` | `DbAdapter` interface definition |
| `server/src/database/adapters/libsql-adapter.ts` | libsql wrapper |
| `server/src/database/adapters/mssql-adapter.ts` | mssql wrapper |
| `server/src/database/sql.ts` | SQL dialect helpers |

## Modified Files

| File | Change |
|------|--------|
| `server/src/database/db.ts` | Added `getDbAsync()`, `closeMssqlPool()`, SQL Server pool management, skipped migrations for sqlserver mode |
| `server/src/database/types.ts` | Re-exported `DbAdapter` |
| `server/src/lib/userAccess.ts` | All functions async, take `DbAdapter` |
| `server/src/middleware/organizationAccess.ts` | `loadRequestUserContext` made async |
| `server/src/routes/*.ts` (18 files) | Full async conversion |
| `server/src/services/approvalWorkflows.ts` | Full async conversion |
| `server/src/services/notifications.ts` | Full async conversion |
| `server/src/index.ts` | Async super-admin bootstrap |
| `server/package.json` | Added `@types/mssql` dev dependency |

---

## Hotfix — SQL Dialect Translation (post-deploy) ✅

**Issue:** `DB_MODE=sqlserver` returned "No organizations available" on login.

**Root cause:** Route queries contained SQLite-specific SQL that SQL Server rejects:
- `ORDER BY name COLLATE NOCASE` — not valid SQL Server syntax
- `datetime('now')` — SQLite function, SQL Server uses `GETUTCDATE()`
- `INSERT OR IGNORE INTO ...` — SQLite-only, SQL Server has no equivalent keyword

**Fix:** Added `translateSql()` function inside `MssqlAdapter` (applied automatically before every query):
- `COLLATE NOCASE` → removed (SQL Server default collation `SQL_Latin1_General_CP1_CI_AS` is already case-insensitive)
- `datetime('now')` → `GETUTCDATE()`
- `INSERT OR IGNORE INTO t (cols) VALUES (vals)` → `INSERT INTO t (cols) SELECT vals WHERE NOT EXISTS (SELECT 1 FROM t WHERE cols = vals)`

No route files were changed — translation is transparent to all callers.

**Commit:** `fix: translate SQLite SQL to SQL Server in MssqlAdapter`

---

## All Post-Deploy Fixes ✅

All applied transparently in `MssqlAdapter.translateSql()` — no route files changed:

| Issue | SQLite | SQL Server |
|-------|--------|------------|
| Case-insensitive sort | `COLLATE NOCASE` | Removed (SQL Server collation is CI) |
| Current timestamp | `datetime('now')` | `GETUTCDATE()` |
| Timestamp offset | `datetime('now', '-N days')` | `DATEADD(day, -N, GETUTCDATE())` |
| Date extraction | `date(col)` | `CAST(col AS DATE)` |
| Row limit | `LIMIT n` | `SELECT TOP n ...` |
| Upsert | `ON CONFLICT(...) DO UPDATE SET` | `IF EXISTS UPDATE / ELSE INSERT` |
| Ignore duplicates | `INSERT OR IGNORE` | `INSERT ... WHERE NOT EXISTS` |
| Reserved word | `key` | `[key]` |
| BIT columns | returned as `1`/`0` | normalized from `true`/`false` |
| BIGINT columns | returned as `number` | normalized from JS string `"123"` |

Other fixes:
- `express-async-errors` added — prevents unhandled async rejections from crashing Express 4
- `runNotificationSweep()` made async — startup sweep errors no longer crash the server
- `mssqlPoolConnecting` reset on failure — pool reconnects cleanly after errors

## Missing Tables ✅

Script: `server/scripts/create-missing-sqlserver-tables.sql`

All tables created: `collection_fields`, `collection_responses`, `collection_response_values`, `response_attachments`, `submission_comments`, `ticket_responses`, `ticket_response_values`, `ticket_history`, `approval_workflow_*`, `signup_slots`, `signup_registrations`, `notification_*`, `user_preferences`

## collection_fields Data ✅

Script: `server/scripts/seed-collection-fields-sqlserver.sql`

Uses `SET IDENTITY_INSERT ON` + `DBCC CHECKIDENT RESEED` pattern. Identity reseeded to 8515.

## Current Status

| Feature | Status |
|---------|--------|
| Login | ✅ Working |
| Organizations / Users | ✅ Working |
| Collections | ✅ Working |
| Tickets | ✅ Working |
| Reports | ✅ Working |
| Login page stats | ✅ Working |
| Server stability | ✅ Stable |
| DB_MODE=sqlserver (Azure) | ✅ Active |
| DB_MODE=turso (local dev) | ✅ Active |

---

## Manual DDL: Webhooks feature (2026-10-21)

The production app login is read/write but **cannot CREATE TABLE**, so the webhooks tables
must be created manually once by an account with DDL rights.

**Script:** `server/scripts/webhooks-sqlserver.sql`

### Steps for production

1. Open the script: `server/scripts/webhooks-sqlserver.sql`
2. Connect to the production database with a DDL-capable account:
   - Azure Portal → your SQL database → **Query editor (preview)**
   - or SSMS / Azure Data Studio / `sqlcmd -i scripts/webhooks-sqlserver.sql`
3. Run the whole script. It is idempotent — every statement is guarded with
   `IF OBJECT_ID(...) IS NULL`, so re-running is harmless.
4. Verify all three tables exist (the script's final batch does not check, so confirm manually):

   ```sql
   SELECT name FROM sys.tables
    WHERE name IN ('webhooks', 'webhook_deliveries', 'webhook_field_bindings');
   -- expect 3 rows
   ```

5. Deploy the application code and restart the app.

No code change is required — the app detects the tables on startup.

### What the app does on startup

`applySqlServerBootstrapScripts()` (called from `applySqlServerMigrations()`) checks whether
all three tables already exist:

- **Tables present** → logs `[db] Bootstrap DDL: webhooks-sqlserver.sql already applied, skipping`
  and does nothing. This is the normal state after the manual step, and it means no
  permission warning appears on every boot.
- **Tables missing** → attempts to run the script. With a read/write-only login this fails
  and logs a single line:
  `[db] Bootstrap DDL skipped for webhooks-sqlserver.sql: the database login lacks CREATE TABLE permission. …`
  Startup continues normally.

Until the tables exist, `/api/webhooks` returns **503** with `code: "WEBHOOKS_TABLES_MISSING"`
and the Settings panel shows that message instead of a generic 500.

**To skip the startup attempt entirely:** set `SQLSERVER_BOOTSTRAP_DDL=false` in App Service
application settings.

**To apply from a workstation instead of the portal:**
`cd server && node scripts/apply-webhooks-sqlserver.mjs` — reads `server/.env`.

### Schema notes

- All ID/FK columns are **`BIGINT`** to match the existing `organizations.id`, `users.id`,
  `collection_fields.id`, and `collection_responses.id` (which are `bigint`, not `int`).
  Using `INT` fails with *"Could not create constraint or index"*.
- **No change to `collection_fields`.** The Student ID field type is stored as
  `type = 'short_text'` + `display_style = 'student_id'`, so the `type` CHECK constraint is
  untouched and no table rebuild is required.
- Timestamps are `NVARCHAR(32)` populated by `GETDATE()`; the adapter rewrites
  `datetime('now')` → `GETUTCDATE()` and `INSERT OR IGNORE` → `IF NOT EXISTS`.

| Table | Purpose |
|-------|---------|
| `webhooks` | One row per organization per key (`webhook-1`, `webhook-2`); URL, optional secret, timeout, response shape/key |
| `webhook_deliveries` | Delivery log (status, HTTP code, duration, error, raw response body); cascades from `webhooks` |
| `webhook_field_bindings` | Field → webhook-1 binding; cascades from both `webhooks` and `collection_fields` |
