/**
 * Unified async database adapter interface.
 * Both the LibsqlAdapter (Turso/SQLite) and MssqlAdapter (SQL Server) implement this.
 * Routes and services use only these methods — never the raw libsql/mssql APIs.
 *
 * Use `?` as the parameter placeholder in all SQL strings; each adapter
 * converts to its own dialect internally.
 */
export interface DbAdapter {
  /** Run a SELECT (or any rows-returning query). Returns all rows. */
  queryAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>

  /** Run a SELECT. Returns the first row or undefined. */
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>

  /**
   * Run an INSERT / UPDATE / DELETE / DDL statement.
   * Returns `lastInsertRowid` for INSERT (undefined for non-INSERT).
   */
  execute(sql: string, params?: unknown[]): Promise<{ lastInsertRowid?: number | bigint; changes?: number }>

  /**
   * Run a set of operations atomically inside a transaction.
   * The callback receives a DbAdapter scoped to the transaction;
   * throwing inside rolls back.
   */
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>

  /** Which underlying engine is active — useful for dialect-specific fallbacks. */
  readonly dialect: 'sqlite' | 'sqlserver'
}
