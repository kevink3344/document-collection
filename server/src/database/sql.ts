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
