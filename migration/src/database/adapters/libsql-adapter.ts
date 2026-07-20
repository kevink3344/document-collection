import type Database from 'libsql'
import type { DbAdapter } from '../adapter'

type LibSqlDb = InstanceType<typeof Database>

/**
 * Wraps a synchronous libsql (Turso / SQLite) Database instance behind the
 * async DbAdapter interface. All calls are synchronous under the hood but
 * wrapped in resolved Promises so callers can uniformly await them.
 */
export class LibsqlAdapter implements DbAdapter {
  readonly dialect = 'sqlite' as const

  constructor(private readonly db: LibSqlDb) {}

  queryAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const rows = this.db.prepare(sql).all(...params) as T[]
    return Promise.resolve(rows)
  }

  queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const row = this.db.prepare(sql).get(...params) as T | undefined
    return Promise.resolve(row)
  }

  execute(sql: string, params: unknown[] = []): Promise<{ lastInsertRowid?: number | bigint; changes?: number }> {
    const result = this.db.prepare(sql).run(...params)
    return Promise.resolve({ lastInsertRowid: result.lastInsertRowid, changes: result.changes })
  }

  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    // libsql transactions are synchronous. Because LibsqlAdapter methods return
    // already-resolved Promises, the async fn drains synchronously in a single
    // microtask, making this safe.
    let result: T
    let thrown: unknown
    let didThrow = false

    const txAdapter = new LibsqlAdapter(this.db)

    const transactionFn = this.db.transaction(() => {
      const promise = fn(txAdapter)
      promise.then(
        (r) => { result = r },
        (e) => { thrown = e; didThrow = true },
      )
    })

    transactionFn()

    if (didThrow) return Promise.reject(thrown)
    return Promise.resolve(result!)
  }

  /** Expose the underlying db for schema/migration code that still needs it. */
  getRawDb(): LibSqlDb {
    return this.db
  }
}
