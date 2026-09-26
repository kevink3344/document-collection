import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { createClient } from '@libsql/client'

function qIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`
}

/** Return tables sorted so parent tables come before child tables. */
function topologicalSort(tables, localDb) {
  const nameSet = new Set(tables.map((t) => t.name))
  const deps = new Map()
  for (const t of tables) {
    const fkList = localDb.prepare(`PRAGMA foreign_key_list(${qIdent(t.name)})`).all()
    deps.set(
      t.name,
      fkList.map((fk) => fk.table).filter((dep) => nameSet.has(dep) && dep !== t.name)
    )
  }

  const sorted = []
  const visited = new Set()

  function visit(name) {
    if (visited.has(name)) return
    visited.add(name)
    for (const dep of deps.get(name) ?? []) visit(dep)
    sorted.push(tables.find((t) => t.name === name))
  }

  for (const t of tables) visit(t.name)
  return sorted
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

  // Drop in reverse topological order, create in forward order
  const ordered = topologicalSort(tables, localDb)

  for (const t of [...ordered].reverse()) {
    await turso.execute(`DROP TABLE IF EXISTS ${qIdent(t.name)}`)
  }

  for (const t of ordered) {
    if (!t.sql) continue
    await turso.execute(t.sql)
  }

  // Insert parent tables before child tables — no FK violations
  for (const t of ordered) {
    const tableName = t.name
    const rows = localDb.prepare(`SELECT * FROM ${qIdent(tableName)}`).all()

    if (!rows.length) {
      console.log(`[migrate:turso] ${tableName}: 0 rows`)
      continue
    }

    const columns = Object.keys(rows[0])
    const insertSql = `INSERT INTO ${qIdent(tableName)} (${columns.map(qIdent).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    const statements = rows.map((row) => ({
      sql: insertSql,
      args: columns.map((c) => row[c] ?? null),
    }))

    await turso.batch(statements, 'write')
    console.log(`[migrate:turso] ${tableName}: ${rows.length} rows`)
  }

  console.log('[migrate:turso] Migration completed successfully.')
}

main().catch((err) => {
  console.error('[migrate:turso] Failed:', err?.message ?? err)
  process.exit(1)
})
