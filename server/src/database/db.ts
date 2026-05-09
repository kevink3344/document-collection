import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import path from 'path'
import { createSchema, seedData } from './schema'

let db: DatabaseSync | null = null

function applyPragmas(database: DatabaseSync): void {
  // Some cloud/shared filesystems do not support WAL mode.
  // Fall back to DELETE so startup still succeeds.
  try {
    database.exec('PRAGMA journal_mode = WAL;')
  } catch {
    try {
      database.exec('PRAGMA journal_mode = DELETE;')
    } catch (err) {
      // If even DELETE fails, the database may be corrupted or locked.
      // Log the error but continue - schema setup may still work or provide a better error.
      console.warn('[db] Warning: Could not set journal mode:', (err as Error).message)
    }
  }
  
  try {
    database.exec('PRAGMA foreign_keys = ON;')
  } catch (err) {
    console.warn('[db] Warning: Could not enable foreign keys:', (err as Error).message)
  }
}

export function getDb(): DatabaseSync {
  if (!db) {
    const defaultDbPath =
      process.env.NODE_ENV === 'production'
        ? '/home/data/data.db'
        : path.join(__dirname, '../../data.db')
    const dbPath = process.env.DATABASE_PATH ?? defaultDbPath
    const dbDir = path.dirname(dbPath)

    console.log(`[db] Using database path: ${dbPath}`)
    
    fs.mkdirSync(dbDir, { recursive: true })
    
      // Clean up any corrupted database files and WAL artifacts
    const cleanupCorruptedDb = () => {
        const auxiliaryFiles = [
          dbPath,
          `${dbPath}-wal`,
          `${dbPath}-shm`,
          `${dbPath}-journal`,
        ]
        for (const file of auxiliaryFiles) {
          if (fs.existsSync(file)) {
            try {
              fs.unlinkSync(file)
              console.log(`[db] Removed corrupted artifact: ${file}`)
            } catch (err) {
              console.warn(`[db] Could not remove ${file}:`, (err as Error).message)
            }
          }
        }
    }
    
    // Try to open the existing database
    if (fs.existsSync(dbPath)) {
      try {
        db = new DatabaseSync(dbPath)
        applyPragmas(db)
        return db
      } catch (err) {
        console.warn('[db] Existing database is corrupted, cleaning up and starting fresh:', (err as Error).message)
        // Close the database connection if it was partially opened
        if (db) {
          try {
            db.close()
          } catch {}
          db = null
        }
        cleanupCorruptedDb()
      }
    }
    
    // Create a fresh database
    try {
      db = new DatabaseSync(dbPath)
      applyPragmas(db)
    } catch (err) {
      console.error('[db] FATAL: Could not create fresh database:', (err as Error).message)
      throw err
    }
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

  if (!collectionColNames.has('active_version_id')) {
    db.exec(`ALTER TABLE collections ADD COLUMN active_version_id INTEGER`)
    console.log('[db] Migration: added collections.active_version_id')
  }

  if (!collectionColNames.has('allow_submission_edits')) {
    db.exec(`ALTER TABLE collections ADD COLUMN allow_submission_edits INTEGER NOT NULL DEFAULT 0`)
    console.log('[db] Migration: added collections.allow_submission_edits')
  }

  if (!collectionColNames.has('submission_edit_window_hours')) {
    db.exec(`ALTER TABLE collections ADD COLUMN submission_edit_window_hours INTEGER`)
    console.log('[db] Migration: added collections.submission_edit_window_hours')
  }

  if (!collectionColNames.has('logo_url')) {
    db.exec(`ALTER TABLE collections ADD COLUMN logo_url TEXT`)
    console.log('[db] Migration: added collections.logo_url')
  }

  const versionsExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='collection_versions'`)
    .get()
  if (!versionsExists) {
    db.exec(`
      CREATE TABLE collection_versions (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_id  INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        status         TEXT    NOT NULL DEFAULT 'draft'
                               CHECK(status IN ('draft', 'published')),
        created_by     INTEGER NOT NULL REFERENCES users(id),
        created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
        published_at   TEXT,
        UNIQUE(collection_id, version_number)
      )
    `)
    console.log('[db] Migration: created collection_versions table')
  }

  const existingFieldCols = db
    .prepare(`PRAGMA table_info(collection_fields)`)
    .all() as unknown as { name: string }[]
  const fieldColNames = new Set(existingFieldCols.map(c => c.name))

  if (!fieldColNames.has('page_number')) {
    db.exec(`ALTER TABLE collection_fields ADD COLUMN page_number INTEGER NOT NULL DEFAULT 1`)
    console.log('[db] Migration: added collection_fields.page_number')
  }

  if (!fieldColNames.has('version_id')) {
    db.exec(`ALTER TABLE collection_fields ADD COLUMN version_id INTEGER`)
    console.log('[db] Migration: added collection_fields.version_id')
  }

  if (!fieldColNames.has('display_style')) {
    db.exec(`ALTER TABLE collection_fields ADD COLUMN display_style TEXT NOT NULL DEFAULT 'radio'`)
    console.log('[db] Migration: added collection_fields.display_style')
  }

  // Rebuild collection_fields if the CHECK constraint doesn't include 'rating', 'comment', or 'matrix_likert_scale'
  const fieldsSqlRow = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='collection_fields'`)
    .get() as unknown as { sql: string } | undefined
  if (fieldsSqlRow?.sql && (!fieldsSqlRow.sql.includes("'rating'") || !fieldsSqlRow.sql.includes("'comment'") || !fieldsSqlRow.sql.includes("'matrix_likert_scale'"))) {
    // Disable FK enforcement so renaming collection_fields doesn't break
    // the collection_table_columns FK reference during the rebuild.
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec('BEGIN')
    try {
      db.exec('ALTER TABLE collection_fields RENAME TO collection_fields_old')
      db.exec(`
        CREATE TABLE collection_fields (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
          version_id    INTEGER REFERENCES collection_versions(id) ON DELETE CASCADE,
          type          TEXT    NOT NULL CHECK(type IN (
                          'short_text','long_text','single_choice','multiple_choice',
                          'attachment','signature','confirmation','custom_table','rating','comment','matrix_likert_scale'
                        )),
          label         TEXT    NOT NULL,
          page_number   INTEGER NOT NULL DEFAULT 1,
          required      INTEGER NOT NULL DEFAULT 0,
          options       TEXT,
          display_style TEXT    NOT NULL DEFAULT 'radio',
          sort_order    INTEGER NOT NULL DEFAULT 0
        )
      `)
      db.exec(`
        INSERT INTO collection_fields
          (id, collection_id, version_id, type, label, page_number, required, options, display_style, sort_order)
        SELECT
          id, collection_id, version_id, type, label, page_number, required, options, display_style, sort_order
        FROM collection_fields_old
      `)
      db.exec('DROP TABLE collection_fields_old')
      db.exec('COMMIT')
      console.log('[db] Migration: rebuilt collection_fields to support rating, comment, and matrix_likert_scale types')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    } finally {
      db.exec('PRAGMA foreign_keys = ON')
    }
  }

  const existingResponseCols = db
    .prepare(`PRAGMA table_info(collection_responses)`)
    .all() as unknown as { name: string }[]
  const responseColNames = new Set(existingResponseCols.map(c => c.name))
  if (!responseColNames.has('collection_version_id')) {
    db.exec(`ALTER TABLE collection_responses ADD COLUMN collection_version_id INTEGER`)
    console.log('[db] Migration: added collection_responses.collection_version_id')
  }

  if (!responseColNames.has('editable_until')) {
    db.exec(`ALTER TABLE collection_responses ADD COLUMN editable_until TEXT`)
    console.log('[db] Migration: added collection_responses.editable_until')
  }

  if (!responseColNames.has('last_edited_at')) {
    db.exec(`ALTER TABLE collection_responses ADD COLUMN last_edited_at TEXT`)
    console.log('[db] Migration: added collection_responses.last_edited_at')
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

  // Backfill collection versions and version links for legacy data.
  db.exec('BEGIN')
  try {
    const cols = db.prepare(`SELECT id, status, created_by, active_version_id FROM collections`).all() as unknown as Array<{
      id: number
      status: 'draft' | 'published'
      created_by: number
      active_version_id: number | null
    }>

    for (const col of cols) {
      let activeVersionId = col.active_version_id
      if (!activeVersionId) {
        const existingVersion = db
          .prepare(`SELECT id FROM collection_versions WHERE collection_id = ? ORDER BY version_number LIMIT 1`)
          .get(col.id) as unknown as { id: number } | undefined

        if (existingVersion) {
          activeVersionId = existingVersion.id
        } else {
          const inserted = db
            .prepare(
              `INSERT INTO collection_versions (collection_id, version_number, status, created_by, published_at)
               VALUES (?, 1, ?, ?, CASE WHEN ? = 'published' THEN datetime('now') ELSE NULL END)`
            )
            .run(col.id, col.status, col.created_by, col.status)
          activeVersionId = inserted.lastInsertRowid as number
        }

        db
          .prepare(`UPDATE collections SET active_version_id = ? WHERE id = ?`)
          .run(activeVersionId, col.id)
      }

      db
        .prepare(`UPDATE collection_fields SET version_id = ? WHERE collection_id = ? AND version_id IS NULL`)
        .run(activeVersionId, col.id)

      db
        .prepare(
          `UPDATE collection_responses
           SET collection_version_id = ?
           WHERE collection_id = ? AND collection_version_id IS NULL`
        )
        .run(activeVersionId, col.id)
    }

    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  // Ensure app_settings table exists (for DBs created before this feature)
  const settingsExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'`)
    .get()
  if (!settingsExists) {
    db.exec(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    console.log('[db] Migration: created app_settings table')
  }
}
