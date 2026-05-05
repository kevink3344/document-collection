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
}
