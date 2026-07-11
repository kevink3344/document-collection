import sql from 'mssql'
import type { DbAdapter } from '../adapter'

/**
 * Translates SQLite-specific SQL constructs to their SQL Server equivalents.
 * Applied to every query before execution.
 */
function translateSql(rawSql: string): string {
  let s = rawSql

  // 1. datetime('now') → GETUTCDATE()
  s = s.replace(/datetime\s*\(\s*'now'\s*\)/gi, 'GETUTCDATE()')

  // 2. COLLATE NOCASE → remove (SQL Server default collation is case-insensitive)
  s = s.replace(/\s+COLLATE\s+NOCASE\b/gi, '')

  // 3. INSERT OR IGNORE INTO table (cols) VALUES (vals) →
  //    INSERT INTO table (cols) SELECT vals WHERE NOT EXISTS (SELECT 1 FROM table WHERE cols=vals)
  //    Works AFTER placeholder conversion so named @p params can be reused in the WHERE clause.
  s = s.replace(
    /INSERT\s+OR\s+IGNORE\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/gi,
    (_match, table: string, colsPart: string, valsPart: string) => {
      const cols = colsPart.split(',').map((c) => c.trim())
      const vals = valsPart.split(',').map((v) => v.trim())
      const colList = cols.join(', ')
      const valList = vals.join(', ')
      const whereClauses = cols.map((col, i) => `${col} = ${vals[i]}`).join(' AND ')
      return (
        `INSERT INTO ${table} (${colList}) ` +
        `SELECT ${valList} WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE ${whereClauses})`
      )
    },
  )

  // 4. SQLite UPSERT: INSERT INTO t (cols) VALUES (vals) ON CONFLICT(conflictCol) DO UPDATE SET col = excluded.col
  //    → SQL Server two-statement equivalent using named params (duplicates are fine with @pN)
  s = s.replace(
    /INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)\s*ON\s+CONFLICT\s*\(([^)]+)\)\s*DO\s+UPDATE\s+SET\s+([\s\S]+?)(?=;|$)/gi,
    (_match, table: string, colsPart: string, valsPart: string, _conflictCol: string, setClause: string) => {
      const cols = colsPart.split(',').map((c) => c.trim())
      const vals = valsPart.split(',').map((v) => v.trim())
      // Build SET assignments from the DO UPDATE clause, replacing excluded.col with the param value
      const setCols = setClause.trim().split(',').map((assignment) => {
        // "col = excluded.col" → find the col and get its param
        const [lhs] = assignment.split('=').map((p) => p.trim())
        const colIdx = cols.indexOf(lhs)
        const paramVal = colIdx >= 0 ? vals[colIdx] : vals[0]
        return `${lhs} = ${paramVal}`
      }).join(', ')
      const conflictColWrapped = cols[0] // first col is typically the conflict col
      return (
        `IF EXISTS (SELECT 1 FROM ${table} WHERE ${conflictColWrapped} = ${vals[0]})\n` +
        `  UPDATE ${table} SET ${setCols} WHERE ${conflictColWrapped} = ${vals[0]}\n` +
        `ELSE\n` +
        `  INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')})`
      )
    },
  )

  // 5. `key` is a SQL Server reserved word — wrap it in brackets when used as a column name.
  //    Matches `key` as a whole word but not inside string literals (our queries don't embed `key`
  //    in literal strings so a simple word-boundary replacement is safe here).
  s = s.replace(/\bkey\b/g, '[key]')

  // 6. LIMIT n → TOP n  (SQL Server uses TOP, not LIMIT)
  //    Moves TOP n to immediately after the SELECT keyword.
  s = s.replace(
    /\bSELECT(\s+DISTINCT)?(\s+)([\s\S]*?)\s+LIMIT\s+(\d+)\b/gi,
    (_match, distinct, space, body, n) =>
      `SELECT${distinct ?? ''}${space}TOP ${n} ${body}`,
  )

  // 7. datetime('now', '-N days') → DATEADD(day, -N, GETUTCDATE())
  s = s.replace(
    /datetime\s*\(\s*'now'\s*,\s*'-(\d+)\s+days?'\s*\)/gi,
    (_m, n: string) => `DATEADD(day, -${n}, GETUTCDATE())`,
  )

  // 8. date(col) → CAST(col AS DATE)  (SQLite date extraction function)
  s = s.replace(/\bdate\s*\(([^)]+)\)/gi, 'CAST($1 AS DATE)')

  return s
}

/**
 * Converts a SQL string using `?` positional placeholders into the named
 * `@p0, @p1, ...` placeholders that mssql expects, and returns both the
 * converted SQL and the ordered parameter values.
 */
function convertPlaceholders(rawSql: string, params: unknown[]): { sql: string; values: unknown[] } {
  let index = 0
  const converted = rawSql.replace(/\?/g, () => `@p${index++}`)
  return { sql: converted, values: params }
}

/**
 * SQL Server (via tedious) returns:
 *  - BIT columns as JS booleans (true/false) — code expects 1/0
 *  - BIGINT columns as JS strings ("1") — code and JWT expect numbers
 *  - datetime/smalldatetime columns as JS Date objects — convert to ISO string
 *  - NVARCHAR columns with DEFAULT GETDATE() store SQL Server locale date strings
 *    like "Jul 11 2026  8:26PM" — convert to ISO string so the client can parse them.
 * Normalize all so existing comparisons and JWT payloads work correctly.
 */
// Matches SQL Server's implicit datetime→varchar format: "Mon DD YYYY HH:MMAM/PM"
const MSSQL_DATE_STRING_RE = /^[A-Za-z]{3}\s+\d{1,2}\s+\d{4}\s+\d{1,2}:\d{2}[AP]M$/

function normalizeRow<T>(row: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (typeof v === 'boolean') {
      out[k] = v ? 1 : 0
    } else if (v instanceof Date) {
      // datetime/datetime2 columns come back as JS Date objects
      out[k] = v.toISOString().replace('T', ' ').slice(0, 19)
    } else if (typeof v === 'string' && MSSQL_DATE_STRING_RE.test(v.trim())) {
      // NVARCHAR column with DEFAULT GETDATE() — convert to ISO format
      // Insert space before AM/PM so JS Date can parse it: "Jul 11 2026 12:37AM" → "Jul 11 2026 12:37 AM"
      const cleaned = v.trim().replace(/([AP]M)$/, ' $1')
      const d = new Date(cleaned)
      out[k] = isNaN(d.getTime()) ? v : d.toISOString().replace('T', ' ').slice(0, 19)
    } else if (typeof v === 'string' && /^\d+$/.test(v) && /^id$|_id$|^count$|Count$|_count$/.test(k)) {
      // BIGINT returned as string — only convert columns that are IDs or counts.
      // Generic string columns (e.g. app_settings.value) must not be coerced.
      const n = Number(v)
      out[k] = Number.isSafeInteger(n) ? n : v
    } else {
      out[k] = v
    }
  }
  return out as T
}

function normalizeRows<T>(rows: T[]): T[] {
  return rows.map(normalizeRow)
}

/**
 * Shared execute logic used by both MssqlAdapter and MssqlTransactionAdapter.
 *
 * If a plain INSERT fails with "Cannot insert the value NULL into column 'id'"
 * (i.e. the table was created without IDENTITY on its PK), this automatically
 * retries by fetching MAX(id)+1 and injecting it as a literal into the INSERT.
 * This is a safety net — run create-missing-sqlserver-tables.sql to add
 * IDENTITY permanently so the retry path is never needed.
 */
async function executeStatement(
  conn: sql.ConnectionPool | sql.Transaction,
  rawSql: string,
  params: unknown[],
): Promise<{ lastInsertRowid?: number | bigint; changes?: number }> {
  const isInsert = /^\s*INSERT\b/i.test(rawSql)
  const { sql: withNamedParams, values } = convertPlaceholders(rawSql, params)
  const translated = translateSql(withNamedParams)
  const finalSql = isInsert ? `${translated}; SELECT SCOPE_IDENTITY() AS _last_id` : translated

  let result: sql.IResult<unknown>
  try {
    const request = buildRequest(conn, finalSql, values)
    result = await request.query(finalSql)
  } catch (err) {
    // If the table's id column lacks IDENTITY, inject MAX(id)+1 and retry once.
    if (isInsert && /Cannot insert the value NULL into column 'id'/i.test((err as Error).message ?? '')) {
      return retryInsertWithExplicitId(conn, rawSql, params)
    }
    throw err
  }

  if (isInsert) {
    const lastId = (result.recordsets as Array<Array<{ _last_id?: number }>>)?.[1]?.[0]?._last_id
      ?? (result.recordset as Array<{ _last_id?: number }>)?.[0]?._last_id
    return { lastInsertRowid: lastId != null ? Number(lastId) : undefined }
  }
  return { changes: result.rowsAffected?.[0] }
}

/**
 * Called when an INSERT fails because `id` has no IDENTITY.
 * Queries MAX(id)+1 from the target table and injects it as a literal
 * into the column list, then re-executes.
 */
async function retryInsertWithExplicitId(
  conn: sql.ConnectionPool | sql.Transaction,
  rawSql: string,
  params: unknown[],
): Promise<{ lastInsertRowid?: number | bigint; changes?: number }> {
  const tableMatch = rawSql.match(/INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(\w+)\s*\(/i)
  if (!tableMatch) throw new Error('[mssql] retryInsertWithExplicitId: could not parse table name')
  const table = tableMatch[1]

  const maxSql = `SELECT ISNULL(MAX(id), 0) + 1 AS nextId FROM ${table}`
  const maxResult = await buildRequest(conn, maxSql, []).query<{ nextId: number }>(maxSql)
  const nextId: number = maxResult.recordset[0]?.nextId ?? 1

  // Inject `id` into the column list and the literal nextId into VALUES
  const modifiedSql = rawSql.replace(
    /(INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+\w+\s*\()([^)]+)(\)\s*VALUES\s*\()([^)]+)(\))/i,
    (_m, pre: string, cols: string, mid: string, vals: string, post: string) =>
      `${pre}id, ${cols}${mid}${nextId}, ${vals}${post}`,
  )

  const { sql: withNamedParams, values } = convertPlaceholders(modifiedSql, params)
  const translated = translateSql(withNamedParams)
  await buildRequest(conn, translated, values).query(translated)
  return { lastInsertRowid: nextId }
}

function buildRequest(pool: sql.ConnectionPool | sql.Transaction, convertedSql: string, values: unknown[]): sql.Request {
  const request = pool instanceof sql.Transaction
    ? new sql.Request(pool)
    : pool.request()

  values.forEach((value, i) => {
    if (value === null || value === undefined) {
      request.input(`p${i}`, sql.NVarChar, null)
    } else if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        request.input(`p${i}`, sql.BigInt, value)
      } else {
        request.input(`p${i}`, sql.Float, value)
      }
    } else if (typeof value === 'bigint') {
      request.input(`p${i}`, sql.BigInt, Number(value))
    } else if (typeof value === 'boolean') {
      request.input(`p${i}`, sql.Bit, value ? 1 : 0)
    } else {
      request.input(`p${i}`, sql.NVarChar(sql.MAX), String(value))
    }
  })

  return request
}

/** mssql transaction wrapper used inside `MssqlAdapter.transaction()` */
class MssqlTransactionAdapter implements DbAdapter {
  readonly dialect = 'sqlserver' as const

  constructor(private readonly tx: sql.Transaction) {}

  async queryAll<T = Record<string, unknown>>(rawSql: string, params: unknown[] = []): Promise<T[]> {
    const { sql: converted, values } = convertPlaceholders(translateSql(rawSql), params)
    const request = buildRequest(this.tx, converted, values)
    const result = await request.query<T>(converted)
    return normalizeRows(result.recordset)
  }

  async queryOne<T = Record<string, unknown>>(rawSql: string, params: unknown[] = []): Promise<T | undefined> {
    const rows = await this.queryAll<T>(rawSql, params)
    return rows[0]
  }

  async execute(rawSql: string, params: unknown[] = []): Promise<{ lastInsertRowid?: number | bigint; changes?: number }> {
    return executeStatement(this.tx, rawSql, params)
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    // Nested transactions in SQL Server require savepoints; for simplicity we
    // just run the inner fn in the same transaction context.
    return fn(this)
  }
}

/**
 * Wraps an mssql ConnectionPool behind the DbAdapter interface.
 * Converts `?` positional placeholders to `@p0, @p1, ...` automatically.
 */
export class MssqlAdapter implements DbAdapter {
  readonly dialect = 'sqlserver' as const

  constructor(private readonly pool: sql.ConnectionPool) {}

  async queryAll<T = Record<string, unknown>>(rawSql: string, params: unknown[] = []): Promise<T[]> {
    const { sql: converted, values } = convertPlaceholders(translateSql(rawSql), params)
    const request = buildRequest(this.pool, converted, values)
    const result = await request.query<T>(converted)
    return normalizeRows(result.recordset)
  }

  async queryOne<T = Record<string, unknown>>(rawSql: string, params: unknown[] = []): Promise<T | undefined> {
    const rows = await this.queryAll<T>(rawSql, params)
    return rows[0]
  }

  async execute(rawSql: string, params: unknown[] = []): Promise<{ lastInsertRowid?: number | bigint; changes?: number }> {
    return executeStatement(this.pool, rawSql, params)
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    const tx = new sql.Transaction(this.pool)
    await tx.begin()
    try {
      const result = await fn(new MssqlTransactionAdapter(tx))
      await tx.commit()
      return result
    } catch (err) {
      await tx.rollback()
      throw err
    }
  }
}
