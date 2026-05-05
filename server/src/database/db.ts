import { DatabaseSync } from 'node:sqlite'
import path from 'path'
import { createSchema, seedData } from './schema'

let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(path.join(__dirname, '../../data.db'))
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  }
  return db
}

export function setupDatabase(): void {
  const database = getDb()
  createSchema(database)
  seedData(database)
  console.log('[db] Database ready')
}
