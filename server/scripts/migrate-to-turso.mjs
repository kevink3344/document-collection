import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { createClient } from '@libsql/client'

function qIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`
}

async function main() {
  const tursoUrl = process.env.TURSO_DATABASE_URL
  const tursoToken = process.env.TURSO_AUTH_TOKEN

  if (!tursoUrl || !tursoToken) {
    throw new Error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in environment')
  }

  const sourcePath = process.env.LOCAL_DATABASE_PATH ?? path.resolve(process.cwd(), 'data.db')
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Local SQLite source database not found at: ${sourcePath}`)
  }

  console.log(`[migrate:turso] Source SQLite: ${sourcePath}`)
  console.log(`[migrate:turso] Target Turso: ${tursoUrl}`)

  const localDb = new DatabaseSync(sourcePath)
  const turso = createClient({ url: tursoUrl, authToken: tursoToken })

  const tables = localDb
    .prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `)
    .all()

  if (!tables.length) {
    console.log('[migrate:turso] No tables found in local database. Nothing to migrate.')
    return
  }

  await turso.execute('PRAGMA foreign_keys = OFF')

  // Reset target schema to match local schema exactly.
  for (const t of [...tables].reverse()) {
    await turso.execute(`DROP TABLE IF EXISTS ${qIdent(t.name)}`)
  }

  for (const t of tables) {
    if (!t.sql) continue
    await turso.execute(t.sql)
  }

  for (const t of tables) {
    const tableName = t.name
    const rows = localDb.prepare(`SELECT * FROM ${qIdent(tableName)}`).all()

    if (!rows.length) {
      console.log(`[migrate:turso] ${tableName}: 0 rows`) 
      continue
    }

    const columns = Object.keys(rows[0])
    const insertSql = `INSERT INTO ${qIdent(tableName)} (${columns.map(qIdent).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`

    await turso.execute('BEGIN')
    try {
      for (const row of rows) {
        const args = columns.map((c) => row[c] ?? null)
        await turso.execute({ sql: insertSql, args })
      }
      await turso.execute('COMMIT')
    } catch (err) {
      await turso.execute('ROLLBACK')
      throw err
    }

    console.log(`[migrate:turso] ${tableName}: ${rows.length} rows`)
  }

  await turso.execute('PRAGMA foreign_keys = ON')
  console.log('[migrate:turso] Migration completed successfully.')
}

main().catch((err) => {
  console.error('[migrate:turso] Failed:', err?.message ?? err)
  process.exit(1)
})
