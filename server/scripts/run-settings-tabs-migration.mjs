import 'dotenv/config'
import Database from 'libsql'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const url = process.env.TURSO_DATABASE_URL ?? process.env.DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN ?? process.env.DATABASE_AUTH_TOKEN

if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL/TURSO_AUTH_TOKEN or DATABASE_URL/DATABASE_AUTH_TOKEN')
  process.exit(1)
}

const replicaPath = path.resolve(__dirname, '..', 'turso-replica-migrate-settings.db')

// Remove any stale replica files
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(replicaPath + suffix) } catch { /* ignore */ }
}

const db = new Database(replicaPath, { syncUrl: url, authToken })

db.sync()
console.log('[migrate] Synced with Turso')

// Create the settings_tabs table
db.exec(`
  CREATE TABLE IF NOT EXISTS settings_tabs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    slug        TEXT    NOT NULL UNIQUE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    visible_to  TEXT    NOT NULL DEFAULT 'all'
                        CHECK(visible_to IN ('all', 'super_admin_only')),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`)

db.exec(`CREATE INDEX IF NOT EXISTS idx_settings_tabs_sort ON settings_tabs(sort_order);`)
db.sync()
console.log('[migrate] settings_tabs table ready')

// Seed default tabs if empty
const row = db.prepare('SELECT COUNT(*) AS n FROM settings_tabs').get()
if (row.n === 0) {
  db.exec(`
    INSERT INTO settings_tabs (name, slug, sort_order, visible_to)
    VALUES ('General', 'general', 0, 'all'),
           ('Other', 'other', 1, 'all');
  `)
  db.sync()
  console.log('[migrate] Seeded default tabs: General, Other')
} else {
  console.log('[migrate] Tabs already exist, skipping seed')
}

db.close()

// Clean up replica files
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(replicaPath + suffix) } catch { /* ignore */ }
}

console.log('[migrate] Migration complete')