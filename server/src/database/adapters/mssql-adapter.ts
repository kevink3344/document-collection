import sql from 'mssql'
import type { DbAdapter } from '../adapter'

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
    const { sql: converted, values } = convertPlaceholders(rawSql, params)
    const request = buildRequest(this.tx, converted, values)
    const result = await request.query<T>(converted)
    return result.recordset
  }

  async queryOne<T = Record<string, unknown>>(rawSql: string, params: unknown[] = []): Promise<T | undefined> {
    const rows = await this.queryAll<T>(rawSql, params)
    return rows[0]
  }

  async execute(rawSql: string, params: unknown[] = []): Promise<{ lastInsertRowid?: number | bigint; changes?: number }> {
    const isInsert = /^\s*INSERT\b/i.test(rawSql)
    const wrappedSql = isInsert ? `${rawSql}; SELECT SCOPE_IDENTITY() AS _last_id` : rawSql
    const { sql: converted, values } = convertPlaceholders(wrappedSql, params)
    const request = buildRequest(this.tx, converted, values)
    const result = await request.query(converted)
    if (isInsert) {
      const lastId = result.recordset?.[0]?._last_id
      return { lastInsertRowid: lastId != null ? Number(lastId) : undefined }
    }
    return { changes: result.rowsAffected?.[0] }
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
    const { sql: converted, values } = convertPlaceholders(rawSql, params)
    const request = buildRequest(this.pool, converted, values)
    const result = await request.query<T>(converted)
    return result.recordset
  }

  async queryOne<T = Record<string, unknown>>(rawSql: string, params: unknown[] = []): Promise<T | undefined> {
    const rows = await this.queryAll<T>(rawSql, params)
    return rows[0]
  }

  async execute(rawSql: string, params: unknown[] = []): Promise<{ lastInsertRowid?: number | bigint; changes?: number }> {
    const isInsert = /^\s*INSERT\b/i.test(rawSql)
    const wrappedSql = isInsert ? `${rawSql}; SELECT SCOPE_IDENTITY() AS _last_id` : rawSql
    const { sql: converted, values } = convertPlaceholders(wrappedSql, params)
    const request = buildRequest(this.pool, converted, values)
    const result = await request.query(converted)
    if (isInsert) {
      const lastId = (result.recordsets as Array<Array<{ _last_id?: number }>>)?.[1]?.[0]?._last_id
        ?? (result.recordset as Array<{ _last_id?: number }>)?.[0]?._last_id
      return { lastInsertRowid: lastId != null ? Number(lastId) : undefined }
    }
    return { changes: result.rowsAffected?.[0] }
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
