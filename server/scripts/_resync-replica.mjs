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

const replicaPath = resolve(__dirname, '../turso-replica.db')
// Wipe local replica so it fully re-syncs schema from primary
for (const suffix of ['', '-wal', '-shm', '-info']) {
  try { unlinkSync(replicaPath + suffix) } catch { /* ok */ }
}
console.log('[resync] wiped local replica files')

const db = new Database(replicaPath, { syncUrl: url, authToken })
db.sync()
console.log('[resync] synced from Turso')

const r = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='organization_menu_labels'").get()
console.log('[resync] organization_menu_labels:', r)
db.close()
