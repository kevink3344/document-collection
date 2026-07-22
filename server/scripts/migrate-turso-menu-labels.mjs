import { createClient } from '@libsql/client'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load env from server/.env if present
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
  console.error('Missing TURSO_DATABASE_URL/TURSO_AUTH_TOKEN or DATABASE_URL/DATABASE_AUTH_TOKEN')
  process.exit(1)
}

// Prefer HTTPS for remote HTTP API stability
const remoteUrl = url.startsWith('libsql://') ? url.replace(/^libsql:\/\//, 'https://') : url

const client = createClient({ url: remoteUrl, authToken })

console.log('[migrate] connecting to', remoteUrl)

const existing = await client.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='organization_menu_labels'"
)

if (existing.rows.length > 0) {
  console.log('[migrate] organization_menu_labels already exists')
} else {
  await client.execute(`
    CREATE TABLE organization_menu_labels (
      organization_id    INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
      labels             TEXT    NOT NULL DEFAULT '{}',
      updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `)
  console.log('[migrate] created organization_menu_labels table')
}

const verify = await client.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='organization_menu_labels'"
)
console.log('[migrate] verify:', verify.rows)

client.close()
