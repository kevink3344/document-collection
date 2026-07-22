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

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
const replicaPath = resolve(__dirname, '../turso-replica.db')

console.log('replicaPath', replicaPath)
console.log('exists', existsSync(replicaPath), 'size', existsSync(replicaPath) ? readFileSync(replicaPath).length : 0)

// 1) Open plain local file (no sync)
{
  const local = new Database(replicaPath)
  const t = local.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='organization_menu_labels'").get()
  console.log('[plain] table row:', t)
  try {
    local.prepare('SELECT labels FROM organization_menu_labels WHERE organization_id = ?').get(33)
    console.log('[plain] SELECT ok')
  } catch (e) {
    console.log('[plain] SELECT error:', e.message)
  }
  local.close()
}

// 2) Open with embedded replica sync
{
  const rep = new Database(replicaPath, { syncUrl: url, authToken })
  rep.sync()
  const t = rep.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='organization_menu_labels'").get()
  console.log('[sync] table row:', t)
  try {
    const row = rep.prepare('SELECT labels FROM organization_menu_labels WHERE organization_id = ?').get(33)
    console.log('[sync] SELECT ok', row)
  } catch (e) {
    console.log('[sync] SELECT error:', e.message)
  }

  // Force local CREATE then re-check plain
  console.log('[sync] running CREATE IF NOT EXISTS...')
  rep.exec(`
    CREATE TABLE IF NOT EXISTS organization_menu_labels (
      organization_id    INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
      labels             TEXT    NOT NULL DEFAULT '{}',
      updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `)
  try { rep.sync() } catch (e) { console.log('[sync] post create sync:', e.message) }
  rep.close()
}

// 3) Re-open plain after CREATE via sync handle
{
  const local = new Database(replicaPath)
  const t = local.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='organization_menu_labels'").get()
  console.log('[plain-after-create] table row:', t)
  try {
    local.prepare('SELECT labels FROM organization_menu_labels WHERE organization_id = ?').get(33)
    console.log('[plain-after-create] SELECT ok')
  } catch (e) {
    console.log('[plain-after-create] SELECT error:', e.message)
  }
  local.close()
}

// 4) Nuclear: wipe replica and full resync, then plain check
console.log('[wipe] wiping replica...')
for (const suffix of ['', '-wal', '-shm', '-info']) {
  try { unlinkSync(replicaPath + suffix) } catch { /* ok */ }
}
{
  const rep = new Database(replicaPath, { syncUrl: url, authToken })
  rep.sync()
  console.log('[wipe+sync] done')
  const t = rep.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='organization_menu_labels'").get()
  console.log('[wipe+sync] table row:', t)
  try {
    rep.prepare('SELECT labels FROM organization_menu_labels WHERE organization_id = ?').get(33)
    console.log('[wipe+sync] SELECT ok')
  } catch (e) {
    console.log('[wipe+sync] SELECT error:', e.message)
  }
  rep.close()
}
{
  const local = new Database(replicaPath)
  const t = local.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='organization_menu_labels'").get()
  console.log('[plain-after-wipe-sync] table row:', t)
  try {
    local.prepare('SELECT labels FROM organization_menu_labels WHERE organization_id = ?').get(33)
    console.log('[plain-after-wipe-sync] SELECT ok')
  } catch (e) {
    console.log('[plain-after-wipe-sync] SELECT error:', e.message)
  }
  const names = local.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name)
  console.log('[plain-after-wipe-sync] table count', names.length)
  console.log('[plain-after-wipe-sync] has menu?', names.includes('organization_menu_labels'))
  local.close()
}
