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
  database.exec('BEGIN')
  try {
    database.exec('ALTER TABLE collection_response_values RENAME TO collection_response_values_old')
    database.exec(`
      CREATE TABLE collection_response_values (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        response_id INTEGER NOT NULL REFERENCES collection_responses(id) ON DELETE CASCADE,
        field_id    INTEGER NOT NULL REFERENCES collection_fields(id),
        value       TEXT
      )
    `)
    database.exec(`
      INSERT INTO collection_response_values (id, response_id, field_id, value)
      SELECT id, response_id, field_id, value
      FROM collection_response_values_old
    `)
    database.exec('DROP TABLE collection_response_values_old')
    database.exec('COMMIT')
    console.log('[db] Migration: rebuilt collection_response_values to refresh collection_fields foreign key')
  } catch (err) {
    database.exec('ROLLBACK')
    throw err
  } finally {
    database.exec('PRAGMA foreign_keys = ON')
  }
}

function rebuildCollectionTableColumns(database: AppDatabase, preserveListOptions: boolean): void {
  database.exec('PRAGMA foreign_keys = OFF')
  database.exec('BEGIN')
  try {
    database.exec('ALTER TABLE collection_table_columns RENAME TO collection_table_columns_old')
    database.exec(`
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
    database.exec(`
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
    `)
    database.exec('DROP TABLE collection_table_columns_old')
    database.exec('COMMIT')
    console.log('[db] Migration: rebuilt collection_table_columns to refresh collection_fields foreign key')
  } catch (err) {
    database.exec('ROLLBACK')
    throw err
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
        process.env.LIBSQL_AUTH_TOKEN = target.authToken
        db = new Database(target.url)
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

  db.exec('BEGIN')
  try {
    const users = db
      .prepare('SELECT id, organization, organization_id FROM users')
      .all() as unknown as Array<{ id: number; organization: string | null; organization_id: number | null }>

    for (const user of users) {
      const organizationName = user.organization?.trim() || 'TSD'
      const organizationId = user.organization_id ?? ensureOrganization(db, organizationName)
      db.prepare('UPDATE users SET organization_id = ?, organization = ? WHERE id = ?').run(
        organizationId,
        organizationName,
        user.id,
      )
    }

    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
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

  // Rebuild collection_fields if the CHECK constraint doesn't include newer field types.
  const fieldsSqlRow = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='collection_fields'`)
    .get() as unknown as { sql: string } | undefined
  if (fieldsSqlRow?.sql && (!fieldsSqlRow.sql.includes("'date'") || !fieldsSqlRow.sql.includes("'rating'") || !fieldsSqlRow.sql.includes("'comment'") || !fieldsSqlRow.sql.includes("'matrix_likert_scale'"))) {
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
      `)
      db.exec(`
        INSERT INTO collection_fields
          (id, collection_id, version_id, field_key, type, label, page_number, required, options, display_style, branch_rules, sort_order)
        SELECT
          id, collection_id, version_id, COALESCE(NULLIF(trim(field_key), ''), 'field-' || id), type, label, page_number, required, options, display_style, branch_rules, sort_order
        FROM collection_fields_old
      `)
      db.exec('DROP TABLE collection_fields_old')
      db.exec('COMMIT')
      console.log('[db] Migration: rebuilt collection_fields to support date, rating, comment, and matrix_likert_scale types')
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

  if (hasForeignKeyTarget(db, 'collection_response_values', 'collection_fields_old')) {
    rebuildCollectionResponseValues(db)
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
  const hasStaleTableColumnsFieldFk = hasForeignKeyTarget(db, 'collection_table_columns', 'collection_fields_old')

  if (!supportsListType || !hasListOptionsColumn || hasStaleTableColumnsFieldFk) {
    rebuildCollectionTableColumns(db, hasListOptionsColumn)
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

      const creator = db
        .prepare('SELECT organization_id FROM users WHERE id = ?')
        .get(col.created_by) as unknown as { organization_id: number | null } | undefined

      db
        .prepare(`UPDATE collections SET organization_id = COALESCE(organization_id, ?) WHERE id = ?`)
        .run(creator?.organization_id ?? defaultOrganizationId, col.id)
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

  if (tableExists(db, 'notifications')) {
    db.exec('BEGIN')
    try {
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

      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
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
    db.exec('BEGIN')
    try {
      db.exec('ALTER TABLE categories RENAME TO categories_old')
      db.exec(`
        CREATE TABLE categories (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          name            TEXT    NOT NULL,
          sort_order      INTEGER NOT NULL DEFAULT 0,
          organization_id INTEGER REFERENCES organizations(id),
          created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
          UNIQUE(name, organization_id)
        )
      `)
      db.exec(`
        INSERT OR IGNORE INTO categories (id, name, sort_order, organization_id, created_at)
        SELECT id, name, sort_order, organization_id, created_at FROM categories_old
      `)
      db.exec('DROP TABLE categories_old')
      db.exec('COMMIT')
      console.log('[db] Migration: rebuilt categories table with per-org unique constraint')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
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
    db.exec('BEGIN')
    try {
      db.exec('ALTER TABLE users RENAME TO users_old')
      db.exec(`
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
      `)
      db.exec(`INSERT INTO users SELECT id, name, email, role, organization, created_at, organization_id FROM users_old`)
      db.exec('DROP TABLE users_old')
      db.exec('COMMIT')
      console.log('[db] Migration: rebuilt users table to add super_admin to role CHECK constraint')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
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
}
