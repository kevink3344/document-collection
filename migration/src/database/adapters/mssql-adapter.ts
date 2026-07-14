import sql from 'mssql'
import type { DbAdapter } from '../adapter'

// ─────────────────────────────────────────────────────────────────────────────
// SQL TRANSLATION
// Converts SQLite-specific SQL constructs to SQL Server equivalents.
// Applied to every query before execution — routes never need dialect guards.
// ─────────────────────────────────────────────────────────────────────────────
function translateSql(rawSql: string): string {
  let s = rawSql

  // 1. datetime('now') → GETUTCDATE()
  s = s.replace(/datetime\s*\(\s*'now'\s*\)/gi, 'GETUTCDATE()')

  // 2. COLLATE NOCASE → remove (SQL Server default collation is case-insensitive)
  s = s.replace(/\s+COLLATE\s+NOCASE\b/gi, '')

  // 3. INSERT OR IGNORE INTO table (cols) VALUES (vals)
  //    → INSERT INTO table (cols) SELECT vals WHERE NOT EXISTS (SELECT 1 FROM table WHERE ...)
  s = s.replace(
    /INSERT\s+OR\s+IGNORE\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/gi,
    (_match, table: string, colsPart: string, valsPart: string) => {
      const cols = colsPart.split(',').map((c) => c.trim())
      const vals = valsPart.split(',').map((v) => v.trim())
      const whereClauses = cols.map((col, i) => `${col} = ${vals[i]}`).join(' AND ')
      return (
        `INSERT INTO ${table} (${cols.join(', ')}) ` +
        `SELECT ${vals.join(', ')} WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE ${whereClauses})`
      )
    },
  )

  // 4. SQLite UPSERT: INSERT INTO t (...) VALUES (...) ON CONFLICT(col) DO UPDATE SET ...
  //    → SQL Server IF EXISTS UPDATE ELSE INSERT
  s = s.replace(
    /INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)\s*ON\s+CONFLICT\s*\(([^)]+)\)\s*DO\s+UPDATE\s+SET\s+([\s\S]+?)(?=;|$)/gi,
    (_match, table: string, colsPart: string, valsPart: string, _conflictCol: string, setClause: string) => {
      const cols = colsPart.split(',').map((c) => c.trim())
      const vals = valsPart.split(',').map((v) => v.trim())
      const setCols = setClause.trim().split(',').map((assignment) => {
        const [lhs] = assignment.split('=').map((p) => p.trim())
        const colIdx = cols.indexOf(lhs)
        const paramVal = colIdx >= 0 ? vals[colIdx] : vals[0]
        return `${lhs} = ${paramVal}`
      }).join(', ')
      return (
        `IF EXISTS (SELECT 1 FROM ${table} WHERE ${cols[0]} = ${vals[0]})\n` +
        `  UPDATE ${table} SET ${setCols} WHERE ${cols[0]} = ${vals[0]}\n` +
        `ELSE\n` +
        `  INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')})`
      )
    },
  )

  // 5. `key` is a SQL Server reserved word — wrap in brackets when used as a column
  s = s.replace(/\bkey\b/g, '[key]')

  // 6. LIMIT n → TOP n
  s = s.replace(
    /\bSELECT(\s+DISTINCT)?(\s+)([\s\S]*?)\s+LIMIT\s+(\d+)\b/gi,
    (_match, distinct, space, body, n) => `SELECT${distinct ?? ''}${space}TOP ${n} ${body}`,
  )

  // 7. datetime('now', '-N days') → DATEADD(day, -N, GETUTCDATE())
  s = s.replace(
    /datetime\s*\(\s*'now'\s*,\s*'-(\d+)\s+days?'\s*\)/gi,
    (_m, n: string) => `DATEADD(day, -${n}, GETUTCDATE())`,
  )

  // 8. date(col) → CAST(col AS DATE)
  s = s.replace(/\bdate\s*\(([^)]+)\)/gi, 'CAST($1 AS DATE)')

  return s
}

// ─────────────────────────────────────────────────────────────────────────────
// PLACEHOLDER CONVERSION  ?  →  @p0, @p1, ...
// ─────────────────────────────────────────────────────────────────────────────
function convertPlaceholders(rawSql: string, params: unknown[]): { sql: string; values: unknown[] } {
  let index = 0
  const converted = rawSql.replace(/\?/g, () => `@p${index++}`)
  return { sql: converted, values: params }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROW NORMALISATION
// SQL Server returns BIT as boolean, BIGINT as string, and datetime as Date.
// Normalize so the rest of the codebase sees the same shapes as SQLite.
// ─────────────────────────────────────────────────────────────────────────────
const MSSQL_DATE_STRING_RE = /^[A-Za-z]{3}\s+\d{1,2}\s+\d{4}\s+\d{1,2}:\d{2}[AP]M$/

function normalizeRow<T>(row: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (typeof v === 'boolean') {
      out[k] = v ? 1 : 0
    } else if (v instanceof Date) {
      out[k] = v.toISOString().replace('T', ' ').slice(0, 19)
    } else if (typeof v === 'string' && MSSQL_DATE_STRING_RE.test(v.trim())) {
      const cleaned = v.trim().replace(/([AP]M)$/, ' $1')
      const d = new Date(cleaned)
      out[k] = isNaN(d.getTime()) ? v : d.toISOString().replace('T', ' ').slice(0, 19)
    } else if (typeof v === 'string' && /^\d+$/.test(v)) {
      // BIGINT columns come back as digit strings from mssql.
      // Only convert columns whose names indicate they hold integer values.
      const isIntegerColumn =
        /^id$|_id$|^count$|Count$|_count$|_only$|_enabled$|_edits$|^anonymous$|^required$|^size_bytes$|^sort_order$|^page_number$|^version_number$/.test(k)
      if (isIntegerColumn) {
        const n = Number(v)
        out[k] = Number.isSafeInteger(n) ? n : v
      } else {
        out[k] = v
      }
    } else {
      out[k] = v
    }
  }
  return out as T
}

function normalizeRows<T>(rows: T[]): T[] {
  return rows.map(normalizeRow)
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED EXECUTE HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executes a single statement. Appends SCOPE_IDENTITY() after INSERT to
 * retrieve the generated id. If the id column has no IDENTITY property,
 * automatically retries by injecting MAX(id)+1.
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
    result = await buildRequest(conn, finalSql, values).query(finalSql)
  } catch (err) {
    if (isInsert && /Cannot insert the value NULL into column 'id'/i.test((err as Error).message ?? '')) {
      return retryInsertWithExplicitId(conn, rawSql, params)
    }
    throw err
  }

  if (isInsert) {
    const lastId =
      (result.recordsets as Array<Array<{ _last_id?: number }>>)?.[1]?.[0]?._last_id ??
      (result.recordset as Array<{ _last_id?: number }>)?.[0]?._last_id
    return { lastInsertRowid: lastId != null ? Number(lastId) : undefined }
  }
  return { changes: result.rowsAffected?.[0] }
}

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

function buildRequest(
  conn: sql.ConnectionPool | sql.Transaction,
  _sql: string,
  values: unknown[],
): sql.Request {
  const request = conn instanceof sql.Transaction ? new sql.Request(conn) : conn.request()

  values.forEach((value, i) => {
    if (value === null || value === undefined) {
      request.input(`p${i}`, sql.NVarChar, null)
    } else if (typeof value === 'number') {
      request.input(`p${i}`, Number.isInteger(value) ? sql.BigInt : sql.Float, value)
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

// ─────────────────────────────────────────────────────────────────────────────
// TRANSACTION ADAPTER  (used inside MssqlAdapter.transaction())
// ─────────────────────────────────────────────────────────────────────────────
class MssqlTransactionAdapter implements DbAdapter {
  readonly dialect = 'sqlserver' as const

  constructor(private readonly tx: sql.Transaction) {}

  async queryAll<T = Record<string, unknown>>(rawSql: string, params: unknown[] = []): Promise<T[]> {
    const { sql: converted, values } = convertPlaceholders(translateSql(rawSql), params)
    const result = await buildRequest(this.tx, converted, values).query<T>(converted)
    return normalizeRows(result.recordset)
  }

  async queryOne<T = Record<string, unknown>>(rawSql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.queryAll<T>(rawSql, params))[0]
  }

  async execute(rawSql: string, params: unknown[] = []) {
    return executeStatement(this.tx, rawSql, params)
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    // Nested: run in the same transaction context (no savepoints needed here)
    return fn(this)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ADAPTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps an mssql ConnectionPool behind the DbAdapter interface.
 *
 * - Converts `?` → `@p0, @p1, ...` automatically
 * - Translates SQLite SQL to SQL Server SQL automatically
 * - Normalises BIT/BIGINT/Date return values to match SQLite shapes
 */
export class MssqlAdapter implements DbAdapter {
  readonly dialect = 'sqlserver' as const

  constructor(private readonly pool: sql.ConnectionPool) {}

  async queryAll<T = Record<string, unknown>>(rawSql: string, params: unknown[] = []): Promise<T[]> {
    const { sql: converted, values } = convertPlaceholders(translateSql(rawSql), params)
    const result = await buildRequest(this.pool, converted, values).query<T>(converted)
    return normalizeRows(result.recordset)
  }

  async queryOne<T = Record<string, unknown>>(rawSql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.queryAll<T>(rawSql, params))[0]
  }

  async execute(rawSql: string, params: unknown[] = []) {
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
