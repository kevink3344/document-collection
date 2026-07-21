import Database from 'libsql'

const url = process.env.TURSO_DATABASE_URL ?? process.env.DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN ?? process.env.DATABASE_AUTH_TOKEN

if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL/TURSO_AUTH_TOKEN or DATABASE_URL/DATABASE_AUTH_TOKEN')
  process.exit(1)
}

const db = new Database('turso-replica-migrate.db', { syncUrl: url, authToken })

db.sync()
console.log('[migrate] synced with Turso')

const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='saved_export_presets'").get()
if (exists) {
  console.log('[migrate] saved_export_presets already exists')
} else {
  db.exec(`
    CREATE TABLE saved_export_presets (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      created_by_user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      organization_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      collection_id          INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      name                   TEXT    NOT NULL,
      all_submission_columns INTEGER NOT NULL DEFAULT 1,
      submission_columns     TEXT    NOT NULL DEFAULT '[]',
      ticket_template_id     INTEGER,
      all_ticket_columns     INTEGER NOT NULL DEFAULT 1,
      ticket_columns         TEXT    NOT NULL DEFAULT '[]',
      created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at             TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(organization_id, collection_id, name)
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_saved_export_presets_collection ON saved_export_presets(organization_id, collection_id)`)
  db.sync()
  console.log('[migrate] created saved_export_presets table')
}

const verify = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='saved_export_presets'").get()
console.log('[migrate] verify:', verify)
