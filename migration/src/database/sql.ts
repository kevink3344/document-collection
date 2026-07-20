import { getDbAsync } from './db'

/**
 * Returns the active SQL dialect based on DB_MODE.
 * Use this when a route must emit different SQL that translateSql() cannot
 * handle automatically (e.g. RETURNING clause, JSON functions).
 */
export function getDialect(): 'sqlite' | 'sqlserver' {
  const mode = process.env.DB_MODE?.trim().toLowerCase()
  return mode === 'sqlserver' ? 'sqlserver' : 'sqlite'
}

/**
 * Returns the SQL expression for the current UTC timestamp.
 *   SQLite:     datetime('now')
 *   SQL Server: GETUTCDATE()
 */
export function nowExpr(): string {
  return getDialect() === 'sqlserver' ? 'GETUTCDATE()' : "datetime('now')"
}

/**
 * Builds an "insert if not exists" statement compatible with both dialects.
 *
 *   SQLite:      INSERT OR IGNORE INTO table (col1, col2) VALUES (?, ?)
 *   SQL Server:  IF NOT EXISTS (SELECT 1 FROM table WHERE col1 = ? AND col2 = ?)
 *                  INSERT INTO table (col1, col2) VALUES (?, ?)
 *
 * Pass `?` placeholders as usual — MssqlAdapter converts them to @p0, @p1, ...
 * The `conflictCols` array identifies which columns to check for existence.
 *
 * NOTE: For SQL Server the WHERE params must appear BEFORE the INSERT params
 * in your params array.  Keep conflictCols === cols for simple cases (they're
 * the same values, just passed twice to fill both ? slots).
 */
export function insertOrIgnore(table: string, cols: string[], conflictCols: string[]): string {
  const colList = cols.join(', ')
  const valList = cols.map(() => '?').join(', ')

  if (getDialect() === 'sqlserver') {
    const where = conflictCols.map((c) => `${c} = ?`).join(' AND ')
    return (
      `IF NOT EXISTS (SELECT 1 FROM ${table} WHERE ${where})\n` +
      `  INSERT INTO ${table} (${colList}) VALUES (${valList})`
    )
  }

  return `INSERT OR IGNORE INTO ${table} (${colList}) VALUES (${valList})`
}
