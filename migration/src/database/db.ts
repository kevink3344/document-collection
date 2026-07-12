import type { DbAdapter } from './adapter'
import { MssqlAdapter } from './adapters/mssql-adapter'
import { LibsqlAdapter } from './adapters/libsql-adapter'
import sql from 'mssql'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────
type DbMode = 'sqlserver' | 'turso' | 'sqlite'

type DbTarget =
  | { mode: 'sqlserver'; server: string; database: string; user: string; password: string }
  | { mode: 'turso'; url: string; authToken: string }
  | { mode: 'sqlite'; dbPath: string }

// ─────────────────────────────────────────────────────────────────────────────
// POOL CACHE
// ─────────────────────────────────────────────────────────────────────────────
let mssqlPool: sql.ConnectionPool | null = null
let mssqlPoolConnecting: Promise<sql.ConnectionPool> | null = null

// ─────────────────────────────────────────────────────────────────────────────
// RESOLVE TARGET
// Reads env vars to decide which database backend to use.
// ─────────────────────────────────────────────────────────────────────────────
function getConfiguredDatabaseMode(): DbMode {
  const mode = process.env.DB_MODE?.trim().toLowerCase()
  if (mode === 'sqlserver') return 'sqlserver'
  if (mode === 'turso') return 'turso'
  return 'sqlite'
}

function resolveDbTarget(): DbTarget {
  const mode = getConfiguredDatabaseMode()

  // ── Explicit DB_MODE=sqlserver override ──────────────────────────────────
  if (mode === 'sqlserver') {
    const server   = process.env.AZURE_SQL_SERVER?.trim()
    const database = process.env.AZURE_SQL_DATABASE?.trim()
    const user     = process.env.AZURE_SQL_USER?.trim()
    const password = process.env.AZURE_SQL_PASSWORD?.trim()
    if (server && database && user && password) {
      return { mode: 'sqlserver', server, database, user, password }
    }
    console.warn('[db] DB_MODE=sqlserver set but AZURE_SQL_* credentials missing — checking Turso/SQLite.')
  }

  // ── Auto-detect: SQL Server credentials present ───────────────────────────
  if (mode !== 'turso' && mode !== 'sqlite') {
    const server   = process.env.AZURE_SQL_SERVER?.trim()
    const database = process.env.AZURE_SQL_DATABASE?.trim()
    const user     = process.env.AZURE_SQL_USER?.trim()
    const password = process.env.AZURE_SQL_PASSWORD?.trim()
    if (server && database && user && password) {
      return { mode: 'sqlserver', server, database, user, password }
    }
  }

  // ── Turso: check all known credential variable names ─────────────────────
  const tursoUrl   = (process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL)?.trim()
  const tursoToken = (process.env.DATABASE_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN)?.trim()
  if (tursoUrl && tursoToken) return { mode: 'turso', url: tursoUrl, authToken: tursoToken }

  // ── SQLite local fallback ─────────────────────────────────────────────────
  console.warn('[db] No SQL Server or Turso credentials found — falling back to local SQLite.')
  const dbPath = process.env.SQLITE_DB_PATH?.trim() ?? './data.db'
  return { mode: 'sqlite', dbPath }
}

// ─────────────────────────────────────────────────────────────────────────────
// getDbAsync  — call this in every route / service
// ─────────────────────────────────────────────────────────────────────────────
export async function getDbAsync(): Promise<DbAdapter> {
  const target = resolveDbTarget()

  // ── SQL SERVER ──────────────────────────────────────────────────────────────
  if (target.mode === 'sqlserver') {
    if (mssqlPool?.connected) return new MssqlAdapter(mssqlPool)

    if (!mssqlPoolConnecting) {
      mssqlPoolConnecting = (async () => {
        const config: sql.config = {
          server:   target.server,
          database: target.database,
          user:     target.user,
          password: target.password,
          options:  { encrypt: true, trustServerCertificate: false },
          pool:     { max: 10, min: 0, idleTimeoutMillis: 30000 },
        }
        const pool = new sql.ConnectionPool(config)
        try {
          await pool.connect()
        } catch (err) {
          mssqlPoolConnecting = null
          throw err
        }
        mssqlPool = pool
        mssqlPoolConnecting = null
        console.log('[db] SQL Server connection pool ready')
        return pool
      })()
    }

    const pool = await mssqlPoolConnecting!
    return new MssqlAdapter(pool)
  }

  // ── TURSO ───────────────────────────────────────────────────────────────────
  if (target.mode === 'turso') {
    const { createClient } = await import('@libsql/client')
    const client = createClient({ url: target.url, authToken: target.authToken })
    // LibsqlAdapter wraps the sync libsql API; for Turso use the async client directly
    // or swap in a TursoAdapter — see migration_guide.md for details.
    // For simplicity this example uses libsql in local file mode:
    throw new Error('[db] Turso remote mode: implement a TursoAdapter or use DB_MODE=sqlite locally.')
  }

  // ── LOCAL SQLITE ────────────────────────────────────────────────────────────
  const { default: Database } = await import('libsql')
  const rawDb = new Database(target.dbPath)
  return new LibsqlAdapter(rawDb)
}

// ─────────────────────────────────────────────────────────────────────────────
// SEED  — runs a .sql file (GO-separated batches) against SQL Server on startup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads a SQL file containing GO-separated batches and executes each one
 * against SQL Server. No-op in non-sqlserver modes.
 *
 * Gate with an env var so it only runs once:
 *   SEED_SQL_ON_START=true  (remove after first successful deploy)
 *
 * Key detail: batches ending with SET IDENTITY_INSERT ... ON are merged with
 * the immediately following batch so they share one pool.request() call.
 * mssql's connection pool calls sp_reset_connection between requests, which
 * would otherwise clear the IDENTITY_INSERT session setting.
 */
export async function runSqlServerSeedFile(filePath: string): Promise<void> {
  if (getConfiguredDatabaseMode() !== 'sqlserver') {
    console.log('[db] runSqlServerSeedFile: skipped (not in sqlserver mode)')
    return
  }

  const { readFileSync } = await import('fs')
  const rawSql = readFileSync(filePath, 'utf-8')

  const raw = rawSql
    .split(/^\s*GO\s*$/im)
    .map((b) => b.trim())
    .filter((b) => b.length > 0)

  // Merge SET IDENTITY_INSERT ... ON batch with the next INSERT batch
  const batches: string[] = []
  for (let i = 0; i < raw.length; i++) {
    if (/\bSET\s+IDENTITY_INSERT\b[^;]*\bON\b\s*;?\s*$/i.test(raw[i]) && i + 1 < raw.length) {
      batches.push(raw[i] + '\n' + raw[++i])
    } else {
      batches.push(raw[i])
    }
  }

  const target = resolveDbTarget()
  if (target.mode !== 'sqlserver') throw new Error('[db] runSqlServerSeedFile: not in sqlserver mode')

  const seedPool = new sql.ConnectionPool({
    server:   target.server,
    database: target.database,
    user:     target.user,
    password: target.password,
    options:  { encrypt: true, trustServerCertificate: false },
    pool:     { max: 10, min: 0, idleTimeoutMillis: 60000 },
  })
  await seedPool.connect()

  console.log(`[db] Running seed file: ${filePath} (${batches.length} batches)`)
  let i = 0
  try {
    for (const batch of batches) {
      i++
      try {
        await seedPool.request().query(batch)
      } catch (err) {
        console.error(`[db] Seed batch ${i} failed:\n${batch.slice(0, 300)}\nError: ${(err as Error).message}`)
        throw err
      }
    }
  } finally {
    await seedPool.close()
  }
  console.log(`[db] Seed file complete: ${batches.length} batches executed`)
}

// ─────────────────────────────────────────────────────────────────────────────
// TEARDOWN
// ─────────────────────────────────────────────────────────────────────────────
export async function closeDb(): Promise<void> {
  if (mssqlPool) {
    await mssqlPool.close()
    mssqlPool = null
    console.log('[db] SQL Server connection pool closed')
  }
}
