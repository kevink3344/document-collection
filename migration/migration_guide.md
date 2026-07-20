# Turso → SQL Server Migration Guide

A drop-in database abstraction layer that lets any Express + TypeScript project
switch between **Turso / local SQLite** and **Azure SQL Server** via a single
environment variable.

---

## Folder structure

```
migration/
  src/
    database/
      adapter.ts              ← DbAdapter interface (the only type your routes import)
      db.ts                   ← getDbAsync(), runSqlServerSeedFile(), closeDb()
      sql.ts                  ← dialect helpers: nowExpr(), insertOrIgnore(), getDialect()
      adapters/
        libsql-adapter.ts     ← wraps libsql (Turso / local SQLite)
        mssql-adapter.ts      ← wraps mssql (Azure SQL Server)
  migration_guide.md          ← this file
```

---

## 1 — Install dependencies

```bash
# Runtime
npm install mssql @libsql/client libsql

# Types (dev)
npm install -D @types/mssql
```

---

## 2 — Environment variables

Copy the relevant block into your `.env` (local) and your Azure App Settings
(production).  Only the variables for the active `DB_MODE` need to be set.

### Local development — SQLite

```env
DB_MODE=sqlite
# Optional — defaults to ./data.db relative to the compiled output
SQLITE_DB_PATH=./data.db
```

### Local development — Turso

```env
DB_MODE=turso
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-turso-token

# Alternative variable names (either pair works):
# DATABASE_URL=libsql://...
# DATABASE_AUTH_TOKEN=...
```

### Production — Azure SQL Server

```env
DB_MODE=sqlserver
AZURE_SQL_SERVER=your-server.database.windows.net
AZURE_SQL_DATABASE=your-database-name
AZURE_SQL_USER=your-sql-username
AZURE_SQL_PASSWORD=your-sql-password
```

> **Tip:** Never commit real credentials.  Add `.env` to `.gitignore`.

### Startup seed (one-time)

Set this in Azure App Settings **before** the first deploy that should run your
data migration SQL file.  Remove it (or set to `false`) after the seed succeeds
so it does not re-run on every restart.

```env
SEED_SQL_ON_START=true
```

---

## 3 — Wire up in your server entry point

```ts
// server/src/index.ts
import path from 'path'
import { getDbAsync, runSqlServerSeedFile } from './database/db'

// Replace every getDb() / db.prepare().get() call with:
//   const db = await getDbAsync()
//   await db.queryOne('SELECT ...', [param])

// ── One-time seed on startup ──────────────────────────────────────────────
async function runStartupSeed() {
  if (process.env.SEED_SQL_ON_START !== 'true') return
  const seedPath = path.join(__dirname, '../../scripts/data-export-v1.sql')
  try {
    await runSqlServerSeedFile(seedPath)
  } catch (err) {
    console.error('[server] Startup seed failed:', (err as Error).message)
  }
}
void runStartupSeed()
```

---

## 4 — Convert routes from libsql to DbAdapter

| Old (libsql sync)                              | New (DbAdapter async)                         |
|------------------------------------------------|-----------------------------------------------|
| `const db = getDb()`                           | `const db = await getDbAsync()`               |
| `db.prepare('...').get(p)`                     | `await db.queryOne('...', [p])`               |
| `db.prepare('...').all(p)`                     | `await db.queryAll('...', [p])`               |
| `db.prepare('...').run(p)`                     | `await db.execute('...', [p])`                |
| `db.exec('...')`                               | `await db.execute('...')`                     |
| `db.transaction(() => { ... })`                | `await db.transaction(async (tx) => { ... })` |

Use `?` as the placeholder in all SQL strings.  Both adapters convert internally.

---

## 5 — SQL dialect differences handled automatically

`MssqlAdapter.translateSql()` rewrites these constructs before every query — you
do **not** need to write dialect-specific SQL in your routes:

| SQLite construct                                   | SQL Server equivalent (auto-applied)              |
|----------------------------------------------------|---------------------------------------------------|
| `COLLATE NOCASE`                                   | Removed (SQL Server collation is CI by default)   |
| `datetime('now')`                                  | `GETUTCDATE()`                                    |
| `datetime('now', '-N days')`                       | `DATEADD(day, -N, GETUTCDATE())`                  |
| `date(col)`                                        | `CAST(col AS DATE)`                               |
| `SELECT ... LIMIT n`                               | `SELECT TOP n ...`                                |
| `INSERT OR IGNORE INTO t (cols) VALUES (vals)`     | `INSERT INTO t ... WHERE NOT EXISTS (...)`        |
| `INSERT ... ON CONFLICT(col) DO UPDATE SET ...`    | `IF EXISTS UPDATE ... ELSE INSERT ...`            |
| `key` as a column name                             | `[key]` (reserved word in SQL Server)             |

For cases that cannot be translated automatically, use the dialect helpers:

```ts
import { nowExpr, insertOrIgnore, getDialect } from './database/sql'

// Dynamic timestamp expression
await db.execute(`UPDATE sessions SET updated_at = ${nowExpr()} WHERE id = ?`, [id])

// Insert-or-ignore across both dialects
const stmt = insertOrIgnore('user_settings', ['user_id', 'key', 'value'], ['user_id', 'key'])
await db.execute(stmt, [userId, key, value])

// Manual dialect branch (last resort)
if (getDialect() === 'sqlserver') {
  await db.execute(`SELECT TOP 1 id FROM users`)
} else {
  await db.execute(`SELECT id FROM users LIMIT 1`)
}
```

---

## 6 — SQL Server return-value normalisation

SQL Server returns some types differently from SQLite.  `MssqlAdapter` normalises
them automatically before returning rows:

| SQL Server type | Raw JS value  | Normalised to       |
|-----------------|---------------|---------------------|
| `BIT`           | `true/false`  | `1` / `0`           |
| `BIGINT`        | `"123"`       | `123` (number)      |
| `DATETIME2`     | `Date` object | `"2026-07-11 ..."`  |
| `NVARCHAR` with `DEFAULT GETDATE()` | locale date string | ISO string |

---

## 7 — Generating a SQL Server seed file from Turso

Use the `migrate-turso-to-sqlserver.mjs` script (already in this project's
`server/scripts/`) to export all data from Turso and produce a `data-export-vN.sql`
file ready for the startup seed.

```bash
TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/migrate-turso-to-sqlserver.mjs
```

The generated file:
- Drops and recreates all tables (idempotent on re-run)
- Wraps every INSERT in `BEGIN TRY / BEGIN CATCH` to skip duplicates silently
- Uses `SET IDENTITY_INSERT table ON` around identity-column inserts

---

## 8 — Common pitfalls

### "No organizations available" on login
The login page calls `/api/auth/organizations`, which joins `organizations` to
`user_organizations`.  If either table is empty the result is `[]`.  Verify the
seed ran (`SEED_SQL_ON_START=true`) and completed (look for
`[db] Seed file complete` in the log stream).

### SET IDENTITY_INSERT not persisting across batches
mssql's connection pool calls `sp_reset_connection` between requests, which
resets all session-level settings including `IDENTITY_INSERT`.  The
`runSqlServerSeedFile` function handles this by merging any batch that ends
with `SET IDENTITY_INSERT ... ON` into the following INSERT batch so they
share a single `pool.request()` call.

### BIGINT columns returned as strings
SQL Server's `BIGINT` comes back as a JS string from the `mssql` driver.
`MssqlAdapter` auto-converts columns whose names match `id`, `*_id`, `count`,
or `*_count`.  For other BIGINT columns, cast manually:
```ts
const n = Number(row.someOtherBigint)
```

### Reserved words
`key`, `value`, `name`, `user`, `order` are reserved in SQL Server.  Wrap
column names that clash: `[key]`, `[value]`.  `MssqlAdapter` auto-wraps `key`
and `value`; add others to `translateSql()` if needed.

### Transactions with errors
Inside an mssql transaction, any error that is not caught puts the transaction
into an uncommittable state (`XACT_STATE() = -1`).  Always catch errors inside
`db.transaction()` callbacks or use `BEGIN TRY/CATCH` in raw SQL.

---

## 9 — Checklist for a new project

- [ ] Copy `migration/src/database/` into your project's `server/src/database/`
- [ ] `npm install mssql @libsql/client libsql` + `npm install -D @types/mssql`
- [ ] Set `DB_MODE` + the matching credential env vars (see §2)
- [ ] Replace all `getDb()` calls with `await getDbAsync()` (see §4)
- [ ] Replace all `.prepare().get/all/run()` calls with `db.queryOne/queryAll/execute()`
- [ ] Add `runStartupSeed()` to your server entry point (see §3)
- [ ] Generate a seed SQL file from Turso (see §7)
- [ ] Set `SEED_SQL_ON_START=true` in Azure App Settings for the first deploy
- [ ] Verify `[db] Seed file complete` in the Azure log stream
- [ ] Remove `SEED_SQL_ON_START` from App Settings
