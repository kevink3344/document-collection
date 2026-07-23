import Database from 'libsql'

const url = process.env.TURSO_DATABASE_URL ?? process.env.DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN ?? process.env.DATABASE_AUTH_TOKEN

if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL/TURSO_AUTH_TOKEN or DATABASE_URL/DATABASE_AUTH_TOKEN')
  process.exit(1)
}

const db = new Database('turso-replica-migrate-settings-tabs.db', { syncUrl: url, authToken })

db.sync()
console.log('[migrate-settings-tabs] synced with Turso')

// ── 1. Create the settings_tabs table if it doesn't exist ──────────────────
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
console.log('[migrate-settings-tabs] settings_tabs table ready')

// ── 2. Seed default tabs if the table is empty ─────────────────────────────
const existingCount = db.prepare('SELECT COUNT(*) AS n FROM settings_tabs').get()
if (existingCount.n === 0) {
  db.exec(`
    INSERT INTO settings_tabs (name, slug, sort_order, visible_to)
    VALUES ('General', 'general', 0, 'all'),
           ('Other', 'other', 1, 'all');
  `)
  db.sync()
  console.log('[migrate-settings-tabs] Seeded default tabs: General, Other')
} else {
  console.log('[migrate-settings-tabs] Tabs already exist, skipping seed')
}

// ── 3. Clean up temp replica ──────────────────────────────────────────────
db.close()
try {
  const fs = await import('fs')
  const path = await import('path')
  const dir = path.dirname(new URL(import.meta.url).pathname)
  const replicaPath = path.resolve(dir, '..', 'turso-replica-migrate-settings-tabs.db')
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(replicaPath + suffix) } catch { /* ignore */ }
  }
} catch {
  // cleanup is best-effort
}

console.log('[migrate-settings-tabs] Migration complete')