import Database from 'libsql'
import { existsSync, statSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function check(path) {
  console.log('\n==', path)
  console.log('exists', existsSync(path), 'size', existsSync(path) ? statSync(path).size : 0)
  if (!existsSync(path)) return
  const db = new Database(path)
  try {
    const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='organization_menu_labels'").get()
    console.log('table', t)
    if (t) {
      console.log('rows', db.prepare('SELECT * FROM organization_menu_labels').all())
    }
    const hasPresets = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='saved_export_presets'").get()
    console.log('has saved_export_presets', !!hasPresets)
  } catch (e) {
    console.log('error', e.message)
  } finally {
    db.close()
  }
}

check(resolve(__dirname, '../turso-replica.db'))
check(resolve(__dirname, '../data.db'))
check(resolve(__dirname, '../azure-data.db'))

for (const p of [resolve(__dirname, '../.db-mode'), resolve(__dirname, '../../.db-mode')]) {
  console.log('\nmode file', p, existsSync(p) ? readFileSync(p, 'utf8') : 'missing')
}
