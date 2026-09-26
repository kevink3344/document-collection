/**
 * TEMP diagnostic: count rows in the 9 existing tables and confirm the DB state.
 */
import sql from 'mssql'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

const tables = [
  'app_settings', 'collections', 'gallery_assets', 'locations',
  'organization_menu_labels', 'organizations', 'saved_export_presets',
  'settings_tabs', 'users',
]

async function main() {
  const server = process.env.AZURE_SQL_SERVER?.trim()
  const database = process.env.AZURE_SQL_DATABASE?.trim()
  const user = process.env.AZURE_SQL_USER?.trim()
  const password = process.env.AZURE_SQL_PASSWORD?.trim()
  const pool = await new sql.ConnectionPool({
    server, database, user, password,
    options: { encrypt: true, trustServerCertificate: false },
    pool: { max: 2, min: 0, idleTimeoutMillis: 60000 },
  }).connect()
  try {
    for (const t of tables) {
      try {
        const r = await pool.request().query(`SELECT COUNT(*) AS n FROM [dbo].[${t}]`)
        console.log(`${t}: ${r.recordset[0].n} rows`)
      } catch (e) {
        console.log(`${t}: ERROR ${e.message}`)
      }
    }
  } finally {
    await pool.close()
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
