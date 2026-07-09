/**
 * Unified async database adapter interface.
 * Both the libsql (Turso/SQLite) and mssql (SQL Server) adapters implement this.
 * Routes and services use only these methods — never the raw libsql/mssql APIs.
 */
export interface DbAdapter {
  /**
   * Run a SELECT (or any query returning rows). Returns all rows.
   * Use `?` as the parameter placeholder; the adapter converts as needed per dialect.
   */
  queryAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>

  /**
   * Run a SELECT (or any query returning rows). Returns the first row or undefined.
   * Use `?` as the parameter placeholder.
   */
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>

  /**
   * Run an INSERT / UPDATE / DELETE / DDL statement.
   * Returns `lastInsertRowid` for INSERT statements (undefined for non-INSERT).
   * Use `?` as the parameter placeholder.
   */
  execute(sql: string, params?: unknown[]): Promise<{ lastInsertRowid?: number | bigint; changes?: number }>

  /**
   * Run a set of operations atomically inside a transaction.
   * The callback receives the same adapter; if it throws the transaction is rolled back.
   */
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>

  /** Which underlying engine is being used — useful for dialect-specific logic. */
  readonly dialect: 'sqlite' | 'sqlserver'
}
