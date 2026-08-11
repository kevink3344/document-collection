import type Database from 'libsql'
import type { DbAdapter } from '../adapter'

type LibSqlDb = InstanceType<typeof Database>

// The remote Turso HTTP connection can be reset by the host mid-request
// (e.g. "Hrana(Http(\"error trying to connect: An existing connection was
// forcibly closed by the remote host. (os error 10054)\"))"). This is a
// transient network blip, not a real query failure, so it's worth one
// automatic retry against a freshly-opened connection before surfacing it.
function isConnectionResetError(err: unknown): boolean {
  const message = (err as { message?: string })?.message ?? ''
  return /forcibly closed|econnreset|hrana\(http/i.test(message)
}

/**
 * Wraps a synchronous libsql (Turso / SQLite) Database instance behind the
 * async DbAdapter interface.  All calls are synchronous under the hood but are
 * wrapped in resolved Promises so callers can uniformly await them.
 *
 * @param reconnect Optional callback that closes the stale connection and
 * opens a new one. When provided, a connection-reset error triggers one
 * automatic reconnect + retry before the error is thrown to the caller.
 */
export class LibsqlAdapter implements DbAdapter {
  readonly dialect = 'sqlite' as const

  constructor(private db: LibSqlDb, private readonly reconnect?: () => LibSqlDb) {}

  private withRetry<T>(run: (db: LibSqlDb) => T): T {
    try {
      return run(this.db)
    } catch (err) {
      if (!this.reconnect || !isConnectionResetError(err)) throw err
      console.warn('[db] Turso connection reset mid-request â€” reconnecting and retrying once:', (err as Error).message)
      this.db = this.reconnect()
      return run(this.db)
    }
  }

  queryAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const rows = this.withRetry((db) => db.prepare(sql).all(...params)) as T[]
    return Promise.resolve(rows)
  }

  queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const row = this.withRetry((db) => db.prepare(sql).get(...params)) as T | undefined
    return Promise.resolve(row)
  }

  execute(sql: string, params: unknown[] = []): Promise<{ lastInsertRowid?: number | bigint; changes?: number }> {
    const result = this.withRetry((db) => db.prepare(sql).run(...params))
    return Promise.resolve({ lastInsertRowid: result.lastInsertRowid, changes: result.changes })
  }

  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    // libsql transactions are synchronous; we execute the fn synchronously by
    // collecting all the awaited statements inside the transaction wrapper.
    // Because LibsqlAdapter methods return already-resolved Promises, the async
    // fn drains synchronously in a single microtask, making this safe.
    let result: T
    let thrown: unknown
    let didThrow = false

    const txAdapter = new LibsqlAdapter(this.db)

    const transactionFn = this.db.transaction(() => {
      // Run the async fn — because all Promises are already resolved this
      // executes synchronously.
      const promise = fn(txAdapter)
      promise.then(
        (r) => { result = r },
        (e) => { thrown = e; didThrow = true },
      )
    })

    transactionFn()

    if (didThrow) {
      return Promise.reject(thrown)
    }
    return Promise.resolve(result!)
  }

  /** Expose the underlying libsql db for migration / schema code that still needs it. */
  getRawDb(): LibSqlDb {
    return this.db
  }
}
