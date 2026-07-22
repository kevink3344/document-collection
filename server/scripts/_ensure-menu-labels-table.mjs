import Database from 'libsql'
import { readFileSync, existsSync, unlinkSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

const url = process.env.TURSO_DATABASE_URL ?? process.env.DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN ?? process.env.DATABASE_AUTH_TOKEN
if (!url || !authToken) {
  console.error('Missing Turso credentials')
  process.exit(1)
}

// Match server getDb(): replica lives next to process.cwd when npm --prefix server runs,
// which is server/turso-replica.db
const replicaPath = resolve(__dirname, '../turso-replica.db')
console.log('[ensure] replica path:', replicaPath)
console.log('[ensure] sync url:', url)

// Also clean a mistaken root-level replica if present
const rootReplica = resolve(__dirname, '../../turso-replica.db')
for (const base of [rootReplica]) {
  for (const suffix of ['', '-wal', '-shm', '-info']) {
    try { unlinkSync(base + suffix); console.log('[ensure] removed stale', base + suffix) } catch { /* ok */ }
  }
}

const db = new Database(replicaPath, { syncUrl: url, authToken })
db.sync()
console.log('[ensure] synced')

let row = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='organization_menu_labels'"
).get()
console.log('[ensure] before create:', row)

if (!row) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organization_menu_labels (
      organization_id    INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
      labels             TEXT    NOT NULL DEFAULT '{}',
      updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `)
  try { db.sync() } catch (e) { console.warn('[ensure] post-create sync warning:', e.message) }
  row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='organization_menu_labels'"
  ).get()
  console.log('[ensure] created table:', row)
} else {
  console.log('[ensure] table already present')
}

// Smoke-test the exact query the route uses
try {
  const sample = db.prepare(
    'SELECT labels FROM organization_menu_labels WHERE organization_id = ?'
  ).get(33)
  console.log('[ensure] sample query ok, row:', sample ?? null)
} catch (e) {
  console.error('[ensure] sample query FAILED:', e.message)
  process.exitCode = 1
}

db.close()
console.log('[ensure] done')
