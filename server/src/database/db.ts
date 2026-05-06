import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import path from 'path'
import { createSchema, seedData } from './schema'

let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (!db) {
    const dbPath = process.env.DATABASE_PATH ?? path.join(__dirname, '../../data.db')
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    db = new DatabaseSync(dbPath)
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  }
  return db
}

export function setupDatabase(): void {
  const database = getDb()
  createSchema(database)
  runMigrations(database)
  seedData(database)
  console.log('[db] Database ready')
}

function runMigrations(db: DatabaseSync): void {
  // Add columns introduced after the initial schema without dropping existing data
  const existingCollectionCols = db
    .prepare(`PRAGMA table_info(collections)`)
    .all() as unknown as { name: string }[]
  const collectionColNames = new Set(existingCollectionCols.map(c => c.name))

  if (!collectionColNames.has('description')) {
    db.exec(`ALTER TABLE collections ADD COLUMN description TEXT`)
    console.log('[db] Migration: added collections.description')
  }

  if (!collectionColNames.has('status')) {
    db.exec(`ALTER TABLE collections ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'`)
    db.exec(`UPDATE collections SET status = 'published'`)
    console.log('[db] Migration: added collections.status and backfilled existing rows')
  }

  const existingFieldCols = db
    .prepare(`PRAGMA table_info(collection_fields)`)
    .all() as unknown as { name: string }[]
  const fieldColNames = new Set(existingFieldCols.map(c => c.name))

  if (!fieldColNames.has('page_number')) {
    db.exec(`ALTER TABLE collection_fields ADD COLUMN page_number INTEGER NOT NULL DEFAULT 1`)
    console.log('[db] Migration: added collection_fields.page_number')
  }

  const existingTableColCols = db
    .prepare(`PRAGMA table_info(collection_table_columns)`)
    .all() as unknown as { name: string }[]
  const tableColNames = new Set(existingTableColCols.map(c => c.name))

  const tableSqlRow = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='collection_table_columns'`)
    .get() as unknown as { sql: string } | undefined
  const supportsListType = tableSqlRow?.sql?.includes("'list'") ?? false
  const hasListOptionsColumn = tableColNames.has('list_options')

  if (!supportsListType || !hasListOptionsColumn) {
    db.exec('BEGIN')
    try {
      db.exec('ALTER TABLE collection_table_columns RENAME TO collection_table_columns_old')
      db.exec(`
        CREATE TABLE collection_table_columns (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          field_id     INTEGER NOT NULL REFERENCES collection_fields(id) ON DELETE CASCADE,
          name         TEXT    NOT NULL,
          col_type     TEXT    NOT NULL DEFAULT 'text'
                               CHECK(col_type IN ('text','number','date','checkbox','list')),
          list_options TEXT,
          sort_order   INTEGER NOT NULL DEFAULT 0
        )
      `)
      db.exec(`
        INSERT INTO collection_table_columns (id, field_id, name, col_type, list_options, sort_order)
        SELECT
          id,
          field_id,
          name,
          CASE
            WHEN col_type IN ('text','number','date','checkbox','list') THEN col_type
            ELSE 'text'
          END,
          NULL,
          sort_order
        FROM collection_table_columns_old
      `)
      db.exec('DROP TABLE collection_table_columns_old')
      db.exec('COMMIT')
      console.log('[db] Migration: rebuilt collection_table_columns for list type support')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}
