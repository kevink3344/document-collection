import { getConfiguredDatabaseMode } from './db'

/**
 * Returns the current database dialect based on DB_MODE.
 */
export function getDialect(): 'sqlite' | 'sqlserver' {
  return getConfiguredDatabaseMode() === 'sqlserver' ? 'sqlserver' : 'sqlite'
}

/**
 * Returns the SQL expression for the current UTC timestamp.
 *  - SQLite:     datetime('now')
 *  - SQL Server: GETUTCDATE()
 */
export function nowExpr(): string {
  return getDialect() === 'sqlserver' ? 'GETUTCDATE()' : "datetime('now')"
}

/**
 * Returns a SQL expression that orders a stored timestamp column as an instant.
 *  - SQLite:     datetime(col)
 *  - SQL Server: TRY_CONVERT(datetime2, col)
 *
 * Use this instead of writing datetime(col) by hand.  `datetime` is NOT a function
 * on SQL Server — it is a type name — and the mssql adapter's translateSql()
 * rewrites only the literal `datetime('now')`, so a `datetime(<column>)` reaches
 * the server verbatim and the whole statement fails with
 * "'datetime' is not a recognized built-in function name."
 * (That is what made every ticket-history request answer 500.)
 *
 * Why the CONVERT rather than ordering the column directly: on SQL Server this
 * column is nvarchar with `DEFAULT (getdate())`, and the implicit conversion
 * writes SQL Server's style-0 text ('Oct 16 2026 11:50PM') — not the canonical
 * 'YYYY-MM-DD HH:MM:SS' text the migrated rows carry.  Compared as raw text, a
 * month-name value sorts above every canonical one ('O' > any digit), so new rows
 * would leapfrog the list while every existing row stayed in place — a silent
 * mis-ordering rather than an error.  Both shapes parse to a datetime2; anything
 * that ever does not parses to NULL and sorts last instead of failing the page.
 */
export function timestampSortExpr(column: string): string {
  return getDialect() === 'sqlserver'
    ? `TRY_CONVERT(datetime2, ${column})`
    : `datetime(${column})`
}

/**
 * Builds an "insert if not exists" statement compatible with both dialects.
 *
 * SQLite:      INSERT OR IGNORE INTO table (col1, col2) VALUES (?, ?)
 * SQL Server:  IF NOT EXISTS (SELECT 1 FROM table WHERE col1 = @p0 AND col2 = @p1)
 *                INSERT INTO table (col1, col2) VALUES (@p0, @p1)
 *
 * Note: The SQL Server variant uses `?` placeholders — MssqlAdapter converts them.
 * The `conflictCols` list identifies which columns to check for existence.
 */
export function insertOrIgnore(
  table: string,
  cols: string[],
  conflictCols: string[],
): string {
  if (getDialect() === 'sqlserver') {
    const whereClauses = conflictCols.map(c => `${c} = ?`).join(' AND ')
    const colList = cols.join(', ')
    const valList = cols.map(() => '?').join(', ')
    return (
      `IF NOT EXISTS (SELECT 1 FROM ${table} WHERE ${whereClauses})\n` +
      `  INSERT INTO ${table} (${colList}) VALUES (${valList})`
    )
  }
  const colList = cols.join(', ')
  const valList = cols.map(() => '?').join(', ')
  return `INSERT OR IGNORE INTO ${table} (${colList}) VALUES (${valList})`
}
