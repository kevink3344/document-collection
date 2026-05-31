import Database from 'libsql'
import fs from 'fs'
import path from 'path'
import { createSchema, seedData } from './schema'
import type { AppDatabase } from './types'

let db: AppDatabase | null = null

type DbTarget =
  | { mode: 'turso'; url: string; authToken: string }
  | { mode: 'sqlite'; dbPath: string }

function hasForeignKeyTarget(database: AppDatabase, tableName: string, targetTable: string): boolean {
  const foreignKeys = database
    .prepare(`PRAGMA foreign_key_list(${tableName})`)
    .all() as unknown as Array<{ table: string }>

  return foreignKeys.some((foreignKey) => foreignKey.table === targetTable)
}

function rebuildCollectionResponseValues(database: AppDatabase): void {
  database.exec('PRAGMA foreign_keys = OFF')
  try {
    database.transaction(() => {
      database.prepare('ALTER TABLE collection_response_values RENAME TO collection_response_values_old').run()
      database.prepare(`
        CREATE TABLE collection_response_values (
          id                    INTEGER PRIMARY KEY AUTOINCREMENT,
          response_id           INTEGER NOT NULL REFERENCES collection_responses(id) ON DELETE CASCADE,
          field_id              INTEGER NOT NULL REFERENCES collection_fields(id),
          value                 TEXT,
          staff_updated_by_name TEXT,
          staff_updated_at      TEXT
        )
      `).run()
      database.prepare(`
        INSERT INTO collection_response_values (id, response_id, field_id, value, staff_updated_by_name, staff_updated_at)
        SELECT id, response_id, field_id, value,
          CASE WHEN EXISTS(SELECT 1 FROM pragma_table_info('collection_response_values_old') WHERE name='staff_updated_by_name') THEN staff_updated_by_name ELSE NULL END,
          CASE WHEN EXISTS(SELECT 1 FROM pragma_table_info('collection_response_values_old') WHERE name='staff_updated_at') THEN staff_updated_at ELSE NULL END
        FROM collection_response_values_old
      `).run()
      database.prepare('DROP TABLE collection_response_values_old').run()
    })()
    console.log('[db] Migration: rebuilt collection_response_values to refresh collection_fields foreign key')
  } finally {
    database.exec('PRAGMA foreign_keys = ON')
  }
}

function rebuildCollectionTableColumns(database: AppDatabase, preserveListOptions: boolean): void {
  database.exec('PRAGMA foreign_keys = OFF')
  try {
    database.transaction(() => {
      database.prepare('ALTER TABLE collection_table_columns RENAME TO collection_table_columns_old').run()
      database.prepare(`
        CREATE TABLE collection_table_columns (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          field_id     INTEGER NOT NULL REFERENCES collection_fields(id) ON DELETE CASCADE,
          name         TEXT    NOT NULL,
          col_type     TEXT    NOT NULL DEFAULT 'text'
                               CHECK(col_type IN ('text','number','date','checkbox','list')),
          list_options TEXT,
          sort_order   INTEGER NOT NULL DEFAULT 0
        )
      `).run()
      database.prepare(`
        INSERT INTO collection_table_columns (id, field_id, name, col_type, list_options, sort_order)
        SELECT
          id,
          field_id,
          name,
          CASE
            WHEN col_type IN ('text','number','date','checkbox','list') THEN col_type
            ELSE 'text'
          END,
          ${preserveListOptions ? 'list_options' : 'NULL'},
          sort_order
        FROM collection_table_columns_old
      `).run()
      database.prepare('DROP TABLE collection_table_columns_old').run()
    })()
    console.log('[db] Migration: rebuilt collection_table_columns to refresh collection_fields foreign key')
  } finally {
    database.exec('PRAGMA foreign_keys = ON')
  }
}

function rebuildTicketFields(database: AppDatabase): void {
  const existingCols = database
    .prepare(`PRAGMA table_info(ticket_fields)`)
    .all() as Array<{ name: string }>
  const ticketFieldCols = new Set(existingCols.map(column => column.name))
  const ticketTemplateIdExpr = ticketFieldCols.has('ticket_template_id') ? 'ticket_template_id' : 'NULL'
  const subtitleExpr = ticketFieldCols.has('subtitle') ? 'subtitle' : 'NULL'
  const pageNumberExpr = ticketFieldCols.has('page_number') ? 'COALESCE(page_number, 1)' : '1'
  const displayStyleExpr = ticketFieldCols.has('display_style') ? "COALESCE(display_style, 'radio')" : "'radio'"

  database.exec('PRAGMA foreign_keys = OFF')
  try {
    database.transaction(() => {
      database.prepare('ALTER TABLE ticket_fields RENAME TO ticket_fields_old').run()
      database.prepare(`
        CREATE TABLE ticket_fields (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          collection_id      INTEGER REFERENCES collections(id) ON DELETE CASCADE,
          ticket_template_id INTEGER REFERENCES ticket_templates(id) ON DELETE CASCADE,
          field_key          TEXT,
          type               TEXT    NOT NULL CHECK(type IN (
                               'short_text','date','long_text','single_choice','multiple_choice',
                               'attachment','signature','confirmation','custom_table','rating','comment','matrix_likert_scale',
                               'location'
                             )),
          label              TEXT    NOT NULL,
          subtitle           TEXT,
          page_number        INTEGER NOT NULL DEFAULT 1,
          required           INTEGER NOT NULL DEFAULT 0,
          options            TEXT,
          display_style      TEXT    NOT NULL DEFAULT 'radio',
          sort_order         INTEGER NOT NULL DEFAULT 0
        )
      `).run()
      database.prepare(`
        INSERT INTO ticket_fields (
          id,
          collection_id,
          ticket_template_id,
          field_key,
          type,
          label,
          subtitle,
          page_number,
          required,
          options,
          display_style,
          sort_order
        )
        SELECT
          id,
          collection_id,
          ${ticketTemplateIdExpr},
          COALESCE(NULLIF(trim(field_key), ''), 'tf-' || id),
          type,
          label,
          ${subtitleExpr},
          ${pageNumberExpr},
          required,
          options,
          ${displayStyleExpr},
          sort_order
        FROM ticket_fields_old
      `).run()
      database.prepare('DROP TABLE ticket_fields_old').run()
    })()
    console.log('[db] Migration: rebuilt ticket_fields for template ownership')
  } finally {
    database.exec('PRAGMA foreign_keys = ON')
  }
}

function rebuildTicketTableColumns(database: AppDatabase, preserveListOptions: boolean): void {
  database.exec('PRAGMA foreign_keys = OFF')
  try {
    database.transaction(() => {
      database.prepare('ALTER TABLE ticket_table_columns RENAME TO ticket_table_columns_old').run()
      database.prepare(`
        CREATE TABLE ticket_table_columns (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_field_id INTEGER NOT NULL REFERENCES ticket_fields(id) ON DELETE CASCADE,
          name            TEXT    NOT NULL,
          col_type        TEXT    NOT NULL DEFAULT 'text'
                                   CHECK(col_type IN ('text','number','date','checkbox','list')),
          list_options    TEXT,
          sort_order      INTEGER NOT NULL DEFAULT 0
        )
      `).run()
      database.prepare(`
        INSERT INTO ticket_table_columns (id, ticket_field_id, name, col_type, list_options, sort_order)
        SELECT
          id,
          ticket_field_id,
          name,
          CASE
            WHEN col_type IN ('text','number','date','checkbox','list') THEN col_type
            ELSE 'text'
          END,
          ${preserveListOptions ? 'list_options' : 'NULL'},
          sort_order
        FROM ticket_table_columns_old
      `).run()
      database.prepare('DROP TABLE ticket_table_columns_old').run()
    })()
    console.log('[db] Migration: rebuilt ticket_table_columns to refresh ticket_fields foreign key')
  } finally {
    database.exec('PRAGMA foreign_keys = ON')
  }
}

function rebuildTicketResponses(database: AppDatabase): void {
  const existingCols = database
    .prepare(`PRAGMA table_info(ticket_responses)`)
    .all() as Array<{ name: string }>
  const ticketResponseCols = new Set(existingCols.map(column => column.name))
  const ticketTemplateIdExpr = ticketResponseCols.has('ticket_template_id') ? 'ticket_template_id' : 'NULL'

  database.exec('PRAGMA foreign_keys = OFF')
  try {
    database.transaction(() => {
      database.prepare('ALTER TABLE ticket_responses RENAME TO ticket_responses_old').run()
      database.prepare(`
        CREATE TABLE ticket_responses (
          id                     INTEGER PRIMARY KEY AUTOINCREMENT,
          collection_response_id INTEGER NOT NULL REFERENCES collection_responses(id) ON DELETE CASCADE,
          collection_id          INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
          ticket_template_id     INTEGER REFERENCES ticket_templates(id) ON DELETE CASCADE,
          filled_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
          filled_at              TEXT,
          finalized              INTEGER NOT NULL DEFAULT 0,
          finalized_at           TEXT,
          finalized_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at             TEXT    NOT NULL DEFAULT (datetime('now'))
        )
      `).run()
      database.prepare(`
        INSERT INTO ticket_responses (
          id,
          collection_response_id,
          collection_id,
          ticket_template_id,
          filled_by,
          filled_at,
          finalized,
          finalized_at,
          finalized_by,
          created_at,
          updated_at
        )
        SELECT
          id,
          collection_response_id,
          collection_id,
          ${ticketTemplateIdExpr},
          filled_by,
          filled_at,
          finalized,
          finalized_at,
          finalized_by,
          created_at,
          updated_at
        FROM ticket_responses_old
      `).run()
      database.prepare('DROP TABLE ticket_responses_old').run()
    })()
    console.log('[db] Migration: rebuilt ticket_responses for multi-ticket support')
  } finally {
    database.exec('PRAGMA foreign_keys = ON')
  }
}

function rebuildTicketResponseValues(database: AppDatabase): void {
  database.exec('PRAGMA foreign_keys = OFF')
  try {
    database.transaction(() => {
      database.prepare('ALTER TABLE ticket_response_values RENAME TO ticket_response_values_old').run()
      database.prepare(`
        CREATE TABLE ticket_response_values (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_response_id INTEGER NOT NULL REFERENCES ticket_responses(id) ON DELETE CASCADE,
          ticket_field_id    INTEGER NOT NULL REFERENCES ticket_fields(id),
          value              TEXT,
          UNIQUE(ticket_response_id, ticket_field_id)
        )
      `).run()
      database.prepare(`
        INSERT INTO ticket_response_values (id, ticket_response_id, ticket_field_id, value)
        SELECT id, ticket_response_id, ticket_field_id, value
        FROM ticket_response_values_old
      `).run()
      database.prepare('DROP TABLE ticket_response_values_old').run()
    })()
    console.log('[db] Migration: rebuilt ticket_response_values to refresh ticket foreign keys')
  } finally {
    database.exec('PRAGMA foreign_keys = ON')
  }
}

function rebuildTicketHistory(database: AppDatabase): void {
  database.exec('PRAGMA foreign_keys = OFF')
  try {
    database.transaction(() => {
      database.prepare('ALTER TABLE ticket_history RENAME TO ticket_history_old').run()
      database.prepare(`
        CREATE TABLE ticket_history (
          id                   INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_response_id   INTEGER NOT NULL REFERENCES ticket_responses(id) ON DELETE CASCADE,
          ticket_field_id      INTEGER,
          ticket_field_key     TEXT,
          field_label_snapshot TEXT,
          field_type_snapshot  TEXT,
          event_type           TEXT NOT NULL CHECK(event_type IN ('field_changed', 'ticket_closed', 'ticket_reopened')),
          old_value            TEXT,
          new_value            TEXT,
          changed_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
          changed_by_name      TEXT,
          changed_at           TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `).run()
      database.prepare(`
        INSERT INTO ticket_history (
          id,
          ticket_response_id,
          ticket_field_id,
          ticket_field_key,
          field_label_snapshot,
          field_type_snapshot,
          event_type,
          old_value,
          new_value,
          changed_by,
          changed_by_name,
          changed_at
        )
        SELECT
          id,
          ticket_response_id,
          ticket_field_id,
          ticket_field_key,
          field_label_snapshot,
          field_type_snapshot,
          event_type,
          old_value,
          new_value,
          changed_by,
          changed_by_name,
          changed_at
        FROM ticket_history_old
      `).run()
      database.prepare('DROP TABLE ticket_history_old').run()
    })()
    console.log('[db] Migration: rebuilt ticket_history to refresh ticket_responses foreign key')
  } finally {
    database.exec('PRAGMA foreign_keys = ON')
  }
}

function slugifyOrganizationName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function ensureOrganization(database: AppDatabase, name: string, description?: string): number {
  const normalizedName = name.trim()
  const existing = database
    .prepare('SELECT id FROM organizations WHERE lower(name) = lower(?)')
    .get(normalizedName) as unknown as { id: number } | undefined

  if (existing) {
    return existing.id
  }

  const baseSlug = slugifyOrganizationName(normalizedName) || 'organization'
  let slug = baseSlug
  let suffix = 1
  while (
    database.prepare('SELECT id FROM organizations WHERE slug = ?').get(slug)
  ) {
    suffix += 1
    slug = `${baseSlug}-${suffix}`
  }

  const inserted = database
    .prepare(
      `INSERT INTO organizations (name, slug, description)
       VALUES (?, ?, ?)`
    )
    .run(normalizedName, slug, description ?? null)

  return Number(inserted.lastInsertRowid)
}

function tableExists(database: AppDatabase, tableName: string): boolean {
  const row = database
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(tableName)

  return Boolean(row)
}

function normalizeSqlitePath(databaseUrl: string): string {
  return databaseUrl.replace(/^sqlite:\/\//, '').trim()
}

function resolveDbPath(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (databaseUrl?.startsWith('sqlite://')) {
    return normalizeSqlitePath(databaseUrl)
  }

  const defaultDbPath =
    process.env.NODE_ENV === 'production'
      ? '/home/data/data.db'
      : path.join(__dirname, '../../data.db')
  return process.env.DATABASE_PATH ?? defaultDbPath
}

function resolveDbTarget(): DbTarget {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  const databaseAuthToken = process.env.DATABASE_AUTH_TOKEN?.trim()
  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim()
  const tursoToken = process.env.TURSO_AUTH_TOKEN?.trim()

  if (databaseUrl?.startsWith('libsql://')) {
    if (!databaseAuthToken && !tursoToken) {
      throw new Error('DATABASE_URL points to Turso/libsql but no DATABASE_AUTH_TOKEN or TURSO_AUTH_TOKEN is set')
    }

    return {
      mode: 'turso',
      url: databaseUrl,
      authToken: databaseAuthToken ?? tursoToken!,
    }
  }

  if (databaseUrl?.startsWith('sqlite://')) {
    return { mode: 'sqlite', dbPath: resolveDbPath() }
  }

  if (tursoUrl && tursoToken) {
    return { mode: 'turso', url: tursoUrl, authToken: tursoToken }
  }

  return { mode: 'sqlite', dbPath: resolveDbPath() }
}

function isMalformedDbError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false
  }
  const message = (err as { message?: string }).message ?? ''
  return message.toLowerCase().includes('malformed')
}

function cleanupDatabaseFiles(dbPath: string): void {
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

function resetDatabase(dbPath: string): void {
  if (db) {
    try {
      db.close()
    } catch {}
    db = null
  }
  cleanupDatabaseFiles(dbPath)
}

function applyPragmas(database: AppDatabase): void {
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

export function getDb(): AppDatabase {
  if (!db) {
    const target = resolveDbTarget()

    if (target.mode === 'turso') {
      try {
        console.log(`[db] Using Turso database: ${target.url}`)
        db = new Database(target.url, { authToken: target.authToken } as Database.Options)
        db.prepare('SELECT 1').get()
        return db
      } catch (err) {
        console.warn('[db] Turso connection failed, falling back to local SQLite:', (err as Error).message)
      }
    }

    const dbPath = resolveDbPath()
    const dbDir = path.dirname(dbPath)

    console.log(`[db] Using local SQLite path: ${dbPath}`)
    fs.mkdirSync(dbDir, { recursive: true })

    if (fs.existsSync(dbPath)) {
      try {
        db = new Database(dbPath)
        applyPragmas(db)
        db.prepare('SELECT name FROM sqlite_master LIMIT 1').all()
        return db
      } catch (err) {
        console.warn('[db] Existing local database is corrupted, cleaning up and starting fresh:', (err as Error).message)
        resetDatabase(dbPath)
      }
    }

    try {
      db = new Database(dbPath)
      applyPragmas(db)
    } catch (err) {
      console.error('[db] FATAL: Could not create local SQLite database:', (err as Error).message)
      throw err
    }
  }
  return db
}

export function setupDatabase(): void {
  const initialize = (database: AppDatabase) => {
    createSchema(database)
    runMigrations(database)
    seedData(database)
  }

  try {
    initialize(getDb())
    console.log('[db] Database ready')
  } catch (err) {
    if (!isMalformedDbError(err)) {
      throw err
    }

    const target = resolveDbTarget()
    if (target.mode !== 'sqlite') {
      throw err
    }

    console.warn('[db] Malformed local SQLite database detected during setup, rebuilding from scratch...')
    resetDatabase(target.dbPath)
    initialize(getDb())
    console.log('[db] Database ready after recovery')
  }
}

function runMigrations(db: AppDatabase): void {
  // ── Migration tracking table ─────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  const appliedMigrations = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: string }>).map(r => r.id)
  )
  function hasRun(migrationId: string): boolean {
    return appliedMigrations.has(migrationId)
  }
  function markRan(migrationId: string): void {
    db.prepare('INSERT OR IGNORE INTO schema_migrations (id) VALUES (?)').run(migrationId)
    appliedMigrations.add(migrationId)
  }

  const organizationsExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='organizations'`)
    .get()
  if (!organizationsExists) {
    db.exec(`
      CREATE TABLE organizations (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        slug        TEXT    UNIQUE,
        description TEXT,
        is_active   INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `)
    console.log('[db] Migration: created organizations table')
  }

  const defaultOrganizationId = ensureOrganization(db, 'TSD', 'Default organization')

  const existingUserCols = db
    .prepare(`PRAGMA table_info(users)`)
    .all() as unknown as { name: string }[]
  const userColNames = new Set(existingUserCols.map((c) => c.name))

  if (!userColNames.has('organization_id')) {
    db.exec(`ALTER TABLE users ADD COLUMN organization_id INTEGER`)
    console.log('[db] Migration: added users.organization_id')
  }

  const existingOrganizationNames = db
    .prepare(`
      SELECT DISTINCT trim(organization) AS name
      FROM users
      WHERE organization IS NOT NULL AND trim(organization) <> ''
    `)
    .all() as unknown as Array<{ name: string }>

  for (const row of existingOrganizationNames) {
    ensureOrganization(db, row.name)
  }

  // Only backfill organization_id on users that don't have it yet
  const usersNeedingOrg = db
    .prepare('SELECT id, organization, organization_id FROM users WHERE organization_id IS NULL')
    .all() as unknown as Array<{ id: number; organization: string | null; organization_id: number | null }>

  if (usersNeedingOrg.length > 0) {
    for (const user of usersNeedingOrg) {
      const organizationName = user.organization?.trim() || 'TSD'
      const organizationId = ensureOrganization(db, organizationName)
      db.prepare('UPDATE users SET organization_id = ?, organization = ? WHERE id = ?').run(
        organizationId,
        organizationName,
        user.id,
      )
    }
  }

  // Add columns introduced after the initial schema without dropping existing data
  const existingCollectionCols = db
    .prepare(`PRAGMA table_info(collections)`)
    .all() as unknown as { name: string }[]
  const collectionColNames = new Set(existingCollectionCols.map(c => c.name))

  if (!collectionColNames.has('organization_id')) {
    db.exec(`ALTER TABLE collections ADD COLUMN organization_id INTEGER`)
    console.log('[db] Migration: added collections.organization_id')
  }

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

  if (!fieldColNames.has('field_key')) {
    db.exec(`ALTER TABLE collection_fields ADD COLUMN field_key TEXT`)
    db.exec(`UPDATE collection_fields SET field_key = 'field-' || id WHERE field_key IS NULL OR trim(field_key) = ''`)
    console.log('[db] Migration: added collection_fields.field_key')
  }

  if (!fieldColNames.has('display_style')) {
    db.exec(`ALTER TABLE collection_fields ADD COLUMN display_style TEXT NOT NULL DEFAULT 'radio'`)
    console.log('[db] Migration: added collection_fields.display_style')
  }

  if (!fieldColNames.has('branch_rules')) {
    db.exec(`ALTER TABLE collection_fields ADD COLUMN branch_rules TEXT`)
    console.log('[db] Migration: added collection_fields.branch_rules')
  }

  if (!fieldColNames.has('staff_only')) {
    db.exec(`ALTER TABLE collection_fields ADD COLUMN staff_only INTEGER NOT NULL DEFAULT 0`)
    console.log('[db] Migration: added collection_fields.staff_only')
  }

  if (!fieldColNames.has('subtitle')) {
    db.exec(`ALTER TABLE collection_fields ADD COLUMN subtitle TEXT`)
    console.log('[db] Migration: added collection_fields.subtitle')
  }

  // Rebuild collection_fields if the CHECK constraint doesn't include newer field types.
  const fieldsSqlRow = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='collection_fields'`)
    .get() as unknown as { sql: string } | undefined
  if (fieldsSqlRow?.sql && (!fieldsSqlRow.sql.includes("'date'") || !fieldsSqlRow.sql.includes("'rating'") || !fieldsSqlRow.sql.includes("'comment'") || !fieldsSqlRow.sql.includes("'matrix_likert_scale'"))) {
    // Disable FK enforcement so renaming collection_fields doesn't break
    // the collection_table_columns FK reference during the rebuild.
    db.exec('PRAGMA foreign_keys = OFF')
    try {
      db.transaction(() => {
        db.prepare('ALTER TABLE collection_fields RENAME TO collection_fields_old').run()
        db.prepare(`
          CREATE TABLE collection_fields (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
            version_id    INTEGER REFERENCES collection_versions(id) ON DELETE CASCADE,
            field_key     TEXT,
            type          TEXT    NOT NULL CHECK(type IN (
                            'short_text','date','long_text','single_choice','multiple_choice',
                            'attachment','signature','confirmation','custom_table','rating','comment','matrix_likert_scale'
                          )),
            label         TEXT    NOT NULL,
            page_number   INTEGER NOT NULL DEFAULT 1,
            required      INTEGER NOT NULL DEFAULT 0,
            options       TEXT,
            display_style TEXT    NOT NULL DEFAULT 'radio',
            branch_rules  TEXT,
            sort_order    INTEGER NOT NULL DEFAULT 0
          )
        `).run()
        db.prepare(`
          INSERT INTO collection_fields
            (id, collection_id, version_id, field_key, type, label, page_number, required, options, display_style, branch_rules, sort_order)
          SELECT
            id, collection_id, version_id, COALESCE(NULLIF(trim(field_key), ''), 'field-' || id), type, label, page_number, required, options, display_style, branch_rules, sort_order
          FROM collection_fields_old
        `).run()
        db.prepare('DROP TABLE collection_fields_old').run()
      })()
      console.log('[db] Migration: rebuilt collection_fields to support date, rating, comment, and matrix_likert_scale types')
    } finally {
      db.exec('PRAGMA foreign_keys = ON')
    }
  }

  // ── Add 'location' to collection_fields CHECK constraint ─────────────────
  const fieldsSqlRowForLocation = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='collection_fields'`)
    .get() as unknown as { sql: string } | undefined
  const supportsLocationType = fieldsSqlRowForLocation?.sql?.includes("'location'") ?? false

  if (!supportsLocationType) {
    db.exec('PRAGMA foreign_keys = OFF')
    try {
      db.transaction(() => {
        db.prepare('ALTER TABLE collection_fields RENAME TO collection_fields_pre_location').run()
        db.prepare(`
          CREATE TABLE collection_fields (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
            version_id    INTEGER REFERENCES collection_versions(id) ON DELETE CASCADE,
            field_key     TEXT,
            type          TEXT    NOT NULL CHECK(type IN (
                            'short_text','date','long_text','single_choice','multiple_choice',
                            'attachment','signature','confirmation','custom_table','rating','comment','matrix_likert_scale',
                            'location'
                          )),
            label         TEXT    NOT NULL,
            page_number   INTEGER NOT NULL DEFAULT 1,
            required      INTEGER NOT NULL DEFAULT 0,
            options       TEXT,
            display_style TEXT    NOT NULL DEFAULT 'radio',
            branch_rules  TEXT,
            sort_order    INTEGER NOT NULL DEFAULT 0
          )
        `).run()
        db.prepare(`
          INSERT INTO collection_fields
            (id, collection_id, version_id, field_key, type, label, page_number, required, options, display_style, branch_rules, sort_order)
          SELECT
            id, collection_id, version_id, field_key, type, label, page_number, required, options, display_style, branch_rules, sort_order
          FROM collection_fields_pre_location
        `).run()
        db.prepare('DROP TABLE collection_fields_pre_location').run()
      })()
      console.log('[db] Migration: rebuilt collection_fields to support location type')
    } finally {
      db.exec('PRAGMA foreign_keys = ON')
    }
  }

  const fieldsSqlRowForDocument = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='collection_fields'`)
    .get() as unknown as { sql: string } | undefined
  const supportsDocumentType = fieldsSqlRowForDocument?.sql?.includes("'document'") ?? false

  if (!supportsDocumentType) {
    const collectionFieldCols = db
      .prepare(`PRAGMA table_info(collection_fields)`)
      .all() as Array<{ name: string }>
    const collectionFieldColNames = new Set(collectionFieldCols.map(column => column.name))
    const subtitleExpr = collectionFieldColNames.has('subtitle') ? 'subtitle' : 'NULL'
    const displayStyleExpr = collectionFieldColNames.has('display_style') ? "COALESCE(display_style, 'radio')" : "'radio'"
    const branchRulesExpr = collectionFieldColNames.has('branch_rules') ? 'branch_rules' : 'NULL'
    const staffOnlyExpr = collectionFieldColNames.has('staff_only') ? 'staff_only' : '0'

    db.exec('PRAGMA foreign_keys = OFF')
    try {
      db.transaction(() => {
        db.prepare('ALTER TABLE collection_fields RENAME TO collection_fields_pre_document').run()
        db.prepare(`
          CREATE TABLE collection_fields (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
            version_id    INTEGER REFERENCES collection_versions(id) ON DELETE CASCADE,
            field_key     TEXT,
            type          TEXT    NOT NULL CHECK(type IN (
                            'short_text','date','long_text','single_choice','multiple_choice',
                            'document','attachment','signature','confirmation','custom_table','rating','comment','matrix_likert_scale',
                            'location'
                          )),
            label         TEXT    NOT NULL,
            subtitle      TEXT,
            page_number   INTEGER NOT NULL DEFAULT 1,
            required      INTEGER NOT NULL DEFAULT 0,
            options       TEXT,
            display_style TEXT    NOT NULL DEFAULT 'radio',
            branch_rules  TEXT,
            sort_order    INTEGER NOT NULL DEFAULT 0,
            staff_only    INTEGER NOT NULL DEFAULT 0
          )
        `).run()
        db.prepare(`
          INSERT INTO collection_fields
            (id, collection_id, version_id, field_key, type, label, subtitle, page_number, required, options, display_style, branch_rules, sort_order, staff_only)
          SELECT
            id,
            collection_id,
            version_id,
            COALESCE(NULLIF(trim(field_key), ''), 'field-' || id),
            type,
            label,
            ${subtitleExpr},
            page_number,
            required,
            options,
            ${displayStyleExpr},
            ${branchRulesExpr},
            sort_order,
            ${staffOnlyExpr}
          FROM collection_fields_pre_document
        `).run()
        db.prepare('DROP TABLE collection_fields_pre_document').run()
      })()
      console.log('[db] Migration: rebuilt collection_fields to support document type')
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

  if (
    hasForeignKeyTarget(db, 'collection_response_values', 'collection_fields_old') ||
    hasForeignKeyTarget(db, 'collection_response_values', 'collection_fields_pre_location') ||
    hasForeignKeyTarget(db, 'collection_response_values', 'collection_fields_pre_document')
  ) {
    rebuildCollectionResponseValues(db)
  }

  const existingResponseValueCols = db
    .prepare(`PRAGMA table_info(collection_response_values)`)
    .all() as unknown as { name: string }[]
  const responseValueColNames = new Set(existingResponseValueCols.map(c => c.name))

  if (!responseValueColNames.has('staff_updated_by_name')) {
    db.exec(`ALTER TABLE collection_response_values ADD COLUMN staff_updated_by_name TEXT`)
    console.log('[db] Migration: added collection_response_values.staff_updated_by_name')
  }
  if (!responseValueColNames.has('staff_updated_at')) {
    db.exec(`ALTER TABLE collection_response_values ADD COLUMN staff_updated_at TEXT`)
    console.log('[db] Migration: added collection_response_values.staff_updated_at')
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
  const hasStaleTableColumnsFieldFk =
    hasForeignKeyTarget(db, 'collection_table_columns', 'collection_fields_old') ||
    hasForeignKeyTarget(db, 'collection_table_columns', 'collection_fields_pre_location')

  if (!supportsListType || !hasListOptionsColumn || hasStaleTableColumnsFieldFk) {
    rebuildCollectionTableColumns(db, hasListOptionsColumn)
  }

  // Backfill collection versions and version links for legacy data.
  if (!hasRun('backfill-collection-versions')) {
  db.transaction(() => {
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

      const creator = db
        .prepare('SELECT organization_id FROM users WHERE id = ?')
        .get(col.created_by) as unknown as { organization_id: number | null } | undefined

      db
        .prepare(`UPDATE collections SET organization_id = COALESCE(organization_id, ?) WHERE id = ?`)
        .run(creator?.organization_id ?? defaultOrganizationId, col.id)
    }
  })()
  markRan('backfill-collection-versions')
  }

  // Ensure app_settings table exists (for DBs created before this feature)
  const settingsExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'`)
    .get()
  if (!settingsExists) {
    db.exec(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    console.log('[db] Migration: created app_settings table')
  }

  if (!tableExists(db, 'notification_events')) {
    db.exec(`
      CREATE TABLE notification_events (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
        type            TEXT    NOT NULL CHECK(type IN ('due_soon', 'overdue', 'system')),
        title           TEXT    NOT NULL,
        message         TEXT    NOT NULL,
        collection_id   INTEGER REFERENCES collections(id) ON DELETE CASCADE,
        collection_slug TEXT,
        due_date        TEXT,
        target_type     TEXT    CHECK(target_type IN ('collection', 'submission', 'user', 'organization', 'system')),
        target_id       INTEGER,
        action_url      TEXT,
        priority        TEXT    NOT NULL DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high')),
        metadata        TEXT,
        dedupe_key      TEXT    UNIQUE,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `)
    console.log('[db] Migration: created notification_events table')
  }

  if (!tableExists(db, 'notification_deliveries')) {
    db.exec(`
      CREATE TABLE notification_deliveries (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id          INTEGER NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
        recipient_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        recipient_email   TEXT,
        channel           TEXT    NOT NULL CHECK(channel IN ('in_app', 'email')),
        recipient_role    TEXT    NOT NULL DEFAULT 'primary' CHECK(recipient_role IN ('primary', 'cc')),
        status            TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed', 'read', 'dismissed')),
        sent_at           TEXT,
        read_at           TEXT,
        failed_at         TEXT,
        failure_reason    TEXT,
        dedupe_key        TEXT    UNIQUE,
        created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `)
    console.log('[db] Migration: created notification_deliveries table')
  }

  if (!tableExists(db, 'ticket_templates')) {
    db.exec(`
      CREATE TABLE ticket_templates (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
        title           TEXT    NOT NULL,
        description     TEXT,
        created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
        is_active       INTEGER NOT NULL DEFAULT 1,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `)
    console.log('[db] Migration: created ticket_templates table')
  }

  if (!tableExists(db, 'collection_ticket_templates')) {
    db.exec(`
      CREATE TABLE collection_ticket_templates (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_id      INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        ticket_template_id INTEGER NOT NULL REFERENCES ticket_templates(id) ON DELETE CASCADE,
        display_order      INTEGER NOT NULL DEFAULT 0,
        is_active          INTEGER NOT NULL DEFAULT 1,
        created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(collection_id, ticket_template_id)
      )
    `)
    console.log('[db] Migration: created collection_ticket_templates table')
  }

  const existingTicketFieldCols = db
    .prepare(`PRAGMA table_info(ticket_fields)`)
    .all() as unknown as { name: string }[]
  const ticketFieldColNames = new Set(existingTicketFieldCols.map(c => c.name))
  const ticketFieldsSqlRow = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='ticket_fields'`)
    .get() as unknown as { sql: string } | undefined
  const ticketFieldsNeedRebuild =
    !ticketFieldColNames.has('ticket_template_id') ||
    (ticketFieldsSqlRow?.sql?.includes('collection_id INTEGER NOT NULL') ?? false) ||
    !(ticketFieldsSqlRow?.sql?.includes("'location'") ?? false)

  if (ticketFieldsNeedRebuild) {
    rebuildTicketFields(db)
  }

  const existingTicketTableColumnCols = db
    .prepare(`PRAGMA table_info(ticket_table_columns)`)
    .all() as unknown as { name: string }[]
  const ticketTableColumnNames = new Set(existingTicketTableColumnCols.map(c => c.name))
  const ticketTableColumnsSqlRow = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='ticket_table_columns'`)
    .get() as unknown as { sql: string } | undefined
  const ticketTableSupportsListType = ticketTableColumnsSqlRow?.sql?.includes("'list'") ?? false

  if (
    !ticketTableColumnNames.has('list_options') ||
    !ticketTableSupportsListType ||
    hasForeignKeyTarget(db, 'ticket_table_columns', 'ticket_fields_old')
  ) {
    rebuildTicketTableColumns(db, ticketTableColumnNames.has('list_options'))
  }

  const existingTicketResponseCols = db
    .prepare(`PRAGMA table_info(ticket_responses)`)
    .all() as unknown as { name: string }[]
  const ticketResponseColNames = new Set(existingTicketResponseCols.map(c => c.name))
  const ticketResponsesSqlRow = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='ticket_responses'`)
    .get() as unknown as { sql: string } | undefined
  const ticketResponsesNeedRebuild =
    !ticketResponseColNames.has('ticket_template_id') ||
    (ticketResponsesSqlRow?.sql?.includes('collection_response_id INTEGER NOT NULL UNIQUE') ?? false)

  if (ticketResponsesNeedRebuild) {
    rebuildTicketResponses(db)
  }

  if (
    hasForeignKeyTarget(db, 'ticket_response_values', 'ticket_fields_old') ||
    hasForeignKeyTarget(db, 'ticket_response_values', 'ticket_responses_old')
  ) {
    rebuildTicketResponseValues(db)
  }

  if (hasForeignKeyTarget(db, 'ticket_history', 'ticket_responses_old')) {
    rebuildTicketHistory(db)
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_responses_response_template
      ON ticket_responses(collection_response_id, ticket_template_id)
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ticket_fields_template
      ON ticket_fields(ticket_template_id, sort_order, id)
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_collection_ticket_templates_collection
      ON collection_ticket_templates(collection_id, display_order, id)
  `)

  if (!hasRun('backfill-ticket-templates')) {
    db.transaction(() => {
      const legacyCollections = db.prepare(`
        SELECT DISTINCT c.id, c.title, c.organization_id, c.created_by
        FROM collections c
        JOIN ticket_fields tf ON tf.collection_id = c.id
        WHERE tf.ticket_template_id IS NULL
        ORDER BY c.id ASC
      `).all() as Array<{
        id: number
        title: string
        organization_id: number | null
        created_by: number | null
      }>

      for (const collection of legacyCollections) {
        const created = db.prepare(`
          INSERT INTO ticket_templates (organization_id, title, description, created_by)
          VALUES (?, ?, ?, ?)
        `).run(
          collection.organization_id,
          `${collection.title} Ticket`,
          'Migrated from the legacy collection ticket designer.',
          collection.created_by,
        )

        const templateId = Number(created.lastInsertRowid)

        db.prepare(`
          UPDATE ticket_fields
          SET ticket_template_id = ?, collection_id = NULL
          WHERE collection_id = ? AND ticket_template_id IS NULL
        `).run(templateId, collection.id)

        db.prepare(`
          INSERT OR IGNORE INTO collection_ticket_templates (collection_id, ticket_template_id, display_order)
          VALUES (?, ?, 0)
        `).run(collection.id, templateId)

        db.prepare(`
          UPDATE ticket_responses
          SET ticket_template_id = ?
          WHERE collection_id = ? AND ticket_template_id IS NULL
        `).run(templateId, collection.id)
      }

      const collectionsNeedingAssignments = db.prepare(`
        SELECT DISTINCT c.id AS collection_id, tf.ticket_template_id AS ticket_template_id
        FROM collections c
        JOIN ticket_fields tf ON tf.ticket_template_id IS NOT NULL
        LEFT JOIN collection_ticket_templates ctt
          ON ctt.collection_id = c.id AND ctt.ticket_template_id = tf.ticket_template_id
        WHERE ctt.id IS NULL
        ORDER BY c.id ASC, tf.ticket_template_id ASC
      `).all() as Array<{ collection_id: number; ticket_template_id: number }>

      collectionsNeedingAssignments.forEach((row, index) => {
        db.prepare(`
          INSERT OR IGNORE INTO collection_ticket_templates (collection_id, ticket_template_id, display_order)
          VALUES (?, ?, ?)
        `).run(row.collection_id, row.ticket_template_id, index)
      })
    })()
    markRan('backfill-ticket-templates')
  }

  if (!tableExists(db, 'notification_preferences')) {
    db.exec(`
      CREATE TABLE notification_preferences (
        user_id              INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        in_app_enabled       INTEGER NOT NULL DEFAULT 1,
        email_enabled        INTEGER NOT NULL DEFAULT 0,
        due_soon             INTEGER NOT NULL DEFAULT 1,
        overdue              INTEGER NOT NULL DEFAULT 1,
        collection_updates   INTEGER NOT NULL DEFAULT 1,
        submission_activity  INTEGER NOT NULL DEFAULT 1,
        admin_events         INTEGER NOT NULL DEFAULT 1,
        updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `)
    console.log('[db] Migration: created notification_preferences table')
  }

  if (!tableExists(db, 'notification_email_ccs')) {
    db.exec(`
      CREATE TABLE notification_email_ccs (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        cc_email           TEXT    NOT NULL,
        notification_types TEXT,
        is_active          INTEGER NOT NULL DEFAULT 1,
        created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, cc_email)
      )
    `)
    console.log('[db] Migration: created notification_email_ccs table')
  }

  if (tableExists(db, 'notifications') && !hasRun('migrate-legacy-notifications')) {
    db.transaction(() => {
      const legacyNotifications = db
        .prepare(`
          SELECT n.id, n.user_id, n.collection_id, n.collection_slug, n.type, n.title, n.message,
                 n.due_date, n.is_read, n.created_at, n.read_at, c.organization_id
          FROM notifications n
          LEFT JOIN collections c ON c.id = n.collection_id
        `)
        .all() as Array<{
          id: number
          user_id: number
          collection_id: number
          collection_slug: string
          type: 'due_soon' | 'overdue'
          title: string
          message: string
          due_date: string
          is_read: number
          created_at: string
          read_at: string | null
          organization_id: number | null
        }>

      for (const notification of legacyNotifications) {
        const eventDedupeKey = `legacy:${notification.collection_id}:${notification.type}:${notification.due_date}`
        let event = db
          .prepare('SELECT id FROM notification_events WHERE dedupe_key = ?')
          .get(eventDedupeKey) as unknown as { id: number } | undefined

        if (!event) {
          const insertedEvent = db
            .prepare(
              `INSERT INTO notification_events (
                 organization_id, type, title, message, collection_id, collection_slug, due_date,
                 target_type, target_id, action_url, priority, dedupe_key, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, 'collection', ?, ?, 'normal', ?, ?)`
            )
            .run(
              notification.organization_id,
              notification.type,
              notification.title,
              notification.message,
              notification.collection_id,
              notification.collection_slug,
              notification.due_date,
              notification.collection_id,
              `/fill/${notification.collection_slug}`,
              eventDedupeKey,
              notification.created_at,
            )

          event = { id: Number(insertedEvent.lastInsertRowid) }
        }

        const deliveryDedupeKey = `legacy:${notification.id}:in_app`
        db.prepare(
          `INSERT OR IGNORE INTO notification_deliveries (
             event_id, recipient_user_id, recipient_email, channel, recipient_role,
             status, sent_at, read_at, dedupe_key, created_at
           ) VALUES (?, ?, NULL, 'in_app', 'primary', ?, ?, ?, ?, ?)`
        ).run(
          event.id,
          notification.user_id,
          notification.is_read === 1 ? 'read' : 'sent',
          notification.created_at,
          notification.read_at,
          deliveryDedupeKey,
          notification.created_at,
        )
      }
    })()
    markRan('migrate-legacy-notifications')
  }

  // ── Categories: add organization_id and enforce per-org uniqueness ──────────
  const existingCategoryCols = db
    .prepare(`PRAGMA table_info(categories)`)
    .all() as unknown as { name: string }[]
  const categoryColNames = new Set(existingCategoryCols.map(c => c.name))

  if (!categoryColNames.has('organization_id')) {
    db.exec(`ALTER TABLE categories ADD COLUMN organization_id INTEGER REFERENCES organizations(id)`)
    db.exec(`UPDATE categories SET organization_id = (SELECT MIN(id) FROM organizations) WHERE organization_id IS NULL`)
    console.log('[db] Migration: added categories.organization_id and backfilled to first org')
  }

  // Rebuild categories table if it still has the old global UNIQUE constraint on name
  const categoriesSqlRow = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='categories'`)
    .get() as unknown as { sql: string } | undefined
  if (categoriesSqlRow?.sql && !categoriesSqlRow.sql.includes('UNIQUE(name, organization_id)')) {
    db.transaction(() => {
      db.prepare('ALTER TABLE categories RENAME TO categories_old').run()
      db.prepare(`
        CREATE TABLE categories (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          name            TEXT    NOT NULL,
          sort_order      INTEGER NOT NULL DEFAULT 0,
          organization_id INTEGER REFERENCES organizations(id),
          created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
          UNIQUE(name, organization_id)
        )
      `).run()
      db.prepare(`
        INSERT OR IGNORE INTO categories (id, name, sort_order, organization_id, created_at)
        SELECT id, name, sort_order, organization_id, created_at FROM categories_old
      `).run()
      db.prepare('DROP TABLE categories_old').run()
    })()
    console.log('[db] Migration: rebuilt categories table with per-org unique constraint')
  }

  // Seed "General" for any organization that has no categories
  const orgsWithoutCategories = db
    .prepare(`
      SELECT o.id FROM organizations o
      WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.organization_id = o.id)
    `)
    .all() as unknown as { id: number }[]
  for (const org of orgsWithoutCategories) {
    const nextSortOrder = (db
      .prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories WHERE organization_id = ?`)
      .get(org.id) as unknown as { n: number }).n
    db.prepare(`INSERT OR IGNORE INTO categories (name, sort_order, organization_id) VALUES ('General', ?, ?)`)
      .run(nextSortOrder, org.id)
    console.log(`[db] Seeded default "General" category for organization ${org.id}`)
  }

  // ── Rebuild users table if CHECK constraint is missing super_admin ──────────
  const usersSchema = (
    db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`)
      .get() as unknown as { sql: string } | undefined
  )?.sql ?? ''
  if (!usersSchema.includes('super_admin')) {
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec('PRAGMA legacy_alter_table = ON')
    try {
      db.transaction(() => {
        db.prepare('ALTER TABLE users RENAME TO users_old').run()
        db.prepare(`
          CREATE TABLE users (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            name             TEXT    NOT NULL,
            email            TEXT    NOT NULL UNIQUE,
            role             TEXT    NOT NULL DEFAULT 'user'
                                     CHECK(role IN ('super_admin', 'administrator', 'team_manager', 'user')),
            organization     TEXT,
            created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
            organization_id  INTEGER REFERENCES organizations(id)
          )
        `).run()
        db.prepare(`INSERT INTO users SELECT id, name, email, role, organization, created_at, organization_id FROM users_old`).run()
        db.prepare('DROP TABLE users_old').run()
      })()
      console.log('[db] Migration: rebuilt users table to add super_admin to role CHECK constraint')
    } finally {
      db.exec('PRAGMA legacy_alter_table = OFF')
      db.exec('PRAGMA foreign_keys = ON')
    }
  }

  // ── Promote null-org administrators to super_admin ──────────────────────────
  const promoted = db
    .prepare(`UPDATE users SET role = 'super_admin' WHERE role = 'administrator' AND organization_id IS NULL`)
    .run()
  if (promoted.changes > 0) {
    console.log(`[db] Migration: promoted ${promoted.changes} global administrator(s) to super_admin`)
  }

  // ── Invite / password columns on users ──────────────────────────────────────
  const allUserCols = db
    .prepare(`PRAGMA table_info(users)`)
    .all() as unknown as { name: string }[]
  const userColSet = new Set(allUserCols.map(c => c.name))

  if (!userColSet.has('password_hash')) {
    db.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT`)
    console.log('[db] Migration: added users.password_hash')
  }
  if (!userColSet.has('must_change_password')) {
    db.exec(`ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`)
    console.log('[db] Migration: added users.must_change_password')
  }
  if (!userColSet.has('invite_token')) {
    db.exec(`ALTER TABLE users ADD COLUMN invite_token TEXT`)
    console.log('[db] Migration: added users.invite_token')
  }
  if (!userColSet.has('invite_token_expires_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN invite_token_expires_at TEXT`)
    console.log('[db] Migration: added users.invite_token_expires_at')
  }
  if (!userColSet.has('reset_token')) {
    db.exec(`ALTER TABLE users ADD COLUMN reset_token TEXT`)
    console.log('[db] Migration: added users.reset_token')
  }
  if (!userColSet.has('reset_token_expires_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN reset_token_expires_at TEXT`)
    console.log('[db] Migration: added users.reset_token_expires_at')
  }

  // ── Rebuild users table to include 'reviewer' role ──────────────────────────
  const usersSchemaV2 = (
    db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`)
      .get() as unknown as { sql: string } | undefined
  )?.sql ?? ''
  if (!usersSchemaV2.includes("'reviewer'")) {
    try { db.exec('PRAGMA foreign_keys = OFF') } catch { /* Turso: FK not enforced */ }
    try { db.exec('PRAGMA legacy_alter_table = ON') } catch { /* Turso: not needed */ }
    try {
      db.transaction(() => {
        db.prepare('ALTER TABLE users RENAME TO users_old').run()
        db.prepare(`
          CREATE TABLE users (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            name                    TEXT    NOT NULL,
            email                   TEXT    NOT NULL UNIQUE,
            role                    TEXT    NOT NULL DEFAULT 'user'
                                            CHECK(role IN ('super_admin', 'administrator', 'team_manager', 'reviewer', 'user')),
            organization            TEXT,
            created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
            organization_id         INTEGER REFERENCES organizations(id),
            password_hash           TEXT,
            must_change_password    INTEGER NOT NULL DEFAULT 0,
            invite_token            TEXT,
            invite_token_expires_at TEXT,
            reset_token             TEXT,
            reset_token_expires_at  TEXT
          )
        `).run()
        db.prepare(`
          INSERT INTO users
            (id, name, email, role, organization, created_at, organization_id,
             password_hash, must_change_password, invite_token, invite_token_expires_at,
             reset_token, reset_token_expires_at)
          SELECT
            id, name, email, role, organization, created_at, organization_id,
            password_hash, must_change_password, invite_token, invite_token_expires_at,
            reset_token, reset_token_expires_at
          FROM users_old
        `).run()
        db.prepare('DROP TABLE users_old').run()
      })()
      console.log("[db] Migration: rebuilt users table to add 'reviewer' to role CHECK constraint")
    } finally {
      try { db.exec('PRAGMA legacy_alter_table = OFF') } catch { /* Turso: not needed */ }
      try { db.exec('PRAGMA foreign_keys = ON') } catch { /* Turso: not needed */ }
    }
  }

  if (!tableExists(db, 'user_organizations')) {
    db.exec(`
      CREATE TABLE user_organizations (
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        role            TEXT    NOT NULL CHECK(role IN ('administrator', 'team_manager', 'reviewer', 'user')),
        is_default      INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, organization_id)
      )
    `)
    console.log('[db] Migration: created user_organizations table')
  }

  const existingUserOrganizationCols = db
    .prepare(`PRAGMA table_info(user_organizations)`)
    .all() as Array<{ name: string }>
  const userOrgColNames = new Set(existingUserOrganizationCols.map(column => column.name))
  if (!userOrgColNames.has('is_default')) {
    db.exec(`ALTER TABLE user_organizations ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0`)
    console.log('[db] Migration: added user_organizations.is_default')
  }
  if (!userOrgColNames.has('created_at')) {
    db.exec(`ALTER TABLE user_organizations ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))`)
    console.log('[db] Migration: added user_organizations.created_at')
  }
  if (!userOrgColNames.has('updated_at')) {
    db.exec(`ALTER TABLE user_organizations ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))`)
    console.log('[db] Migration: added user_organizations.updated_at')
  }

  db.prepare(`
    INSERT OR IGNORE INTO user_organizations (user_id, organization_id, role, is_default)
    SELECT
      u.id,
      u.organization_id,
      CASE WHEN u.role = 'super_admin' THEN 'administrator' ELSE u.role END,
      1
    FROM users u
    WHERE u.organization_id IS NOT NULL
  `).run()

  const membershipUsersMissingDefault = db
    .prepare(`
      SELECT DISTINCT uo.user_id
      FROM user_organizations uo
      WHERE NOT EXISTS (
        SELECT 1
        FROM user_organizations existing
        WHERE existing.user_id = uo.user_id AND existing.is_default = 1
      )
    `)
    .all() as Array<{ user_id: number }>

  for (const row of membershipUsersMissingDefault) {
    const defaultMembership = db
      .prepare(`
        SELECT organization_id
        FROM user_organizations
        WHERE user_id = ?
        ORDER BY organization_id ASC
        LIMIT 1
      `)
      .get(row.user_id) as { organization_id: number } | undefined

    if (defaultMembership) {
      db.prepare(
        `UPDATE user_organizations SET is_default = 1, updated_at = datetime('now') WHERE user_id = ? AND organization_id = ?`
      ).run(row.user_id, defaultMembership.organization_id)
    }
  }

  // ── Locations table ──────────────────────────────────────────────────────────
  if (!tableExists(db, 'locations')) {
    db.exec(`
      CREATE TABLE locations (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT    NOT NULL,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(name, organization_id)
      )
    `)
    console.log('[db] Migration: created locations table')
  }

  if (!tableExists(db, 'user_locations')) {
    db.exec(`
      CREATE TABLE user_locations (
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, location_id)
      )
    `)
    console.log('[db] Migration: created user_locations table')
  }

  // ── Repair user_locations FK if broken by ALTER TABLE users RENAME ───────────
  // When legacy_alter_table is OFF (default on Turso), renaming `users` to
  // `users_old` rewrites the FK in user_locations to reference `users_old`.
  // After `users_old` is dropped the FK is dangling and every INSERT fails.
  if (hasForeignKeyTarget(db, 'user_locations', 'users_old')) {
    try {
      const existing = db
        .prepare('SELECT user_id, location_id FROM user_locations')
        .all() as unknown as Array<{ user_id: number; location_id: number }>
      db.exec('DROP TABLE user_locations')
      db.exec(`
        CREATE TABLE user_locations (
          user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
          PRIMARY KEY (user_id, location_id)
        )
      `)
      for (const row of existing) {
        db.prepare('INSERT OR IGNORE INTO user_locations (user_id, location_id) VALUES (?, ?)').run(row.user_id, row.location_id)
      }
      console.log('[db] Migration: repaired user_locations FK (was referencing dropped users_old)')
    } catch (repairErr) {
      console.warn('[db] Could not repair user_locations FK:', (repairErr as Error).message)
    }
  }

  // ── General repair: fix ALL tables whose FK still points to dropped users_old ─
  // The V2 users migration renamed `users` → `users_old` then dropped it.
  // Turso's ALTER TABLE RENAME rewrites FK references in all dependent tables.
  // Only user_locations was explicitly repaired above; this block catches the rest
  // (collections, collection_versions, notifications, notification_deliveries,
  //  notification_preferences, notification_email_ccs, user_preferences, etc.)
  const tablesWithBrokenUsersFk = db
    .prepare(`SELECT name, sql FROM sqlite_master WHERE type='table' AND sql LIKE '%users_old%' ORDER BY name`)
    .all() as unknown as Array<{ name: string; sql: string }>

  for (const { name, sql } of tablesWithBrokenUsersFk) {
    try {
      const rows = db.prepare(`SELECT * FROM "${name}"`).all() as unknown as Record<string, unknown>[]
      const colInfo = db.prepare(`PRAGMA table_info("${name}")`).all() as unknown as Array<{ name: string }>
      const cols = colInfo.map(c => c.name)
      const fixedSql = sql.replace(/users_old/g, 'users')

      db.exec('PRAGMA foreign_keys = OFF')
      try {
        db.exec(`DROP TABLE "${name}"`)
        db.exec(fixedSql)
        if (rows.length > 0) {
          const colNames = cols.map(c => `"${c}"`).join(', ')
          const placeholders = cols.map(() => '?').join(', ')
          const stmt = db.prepare(`INSERT INTO "${name}" (${colNames}) VALUES (${placeholders})`)
          for (const row of rows) {
            stmt.run(...cols.map(c => (row[c] !== undefined ? row[c] : null)))
          }
        }
        console.log(`[db] Migration: repaired ${name} FK (users_old → users)`)
      } finally {
        db.exec('PRAGMA foreign_keys = ON')
      }
    } catch (repairErr) {
      console.warn(`[db] Could not repair ${name} FK:`, (repairErr as Error).message)
    }
  }

}
