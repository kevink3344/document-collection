/**
 * TEMP diagnostic: list all tables in the configured SQL Server DB and check
 * whether the notification/approval-workflow tables exist.
 *
 * Usage (run from server/):
 *   node scripts/_list-sqlserver-tables.mjs
 */
import sql from 'mssql'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load the repo-root .env (server/.env is at server/; repo root is one up)
const envPath = path.join(__dirname, '..', '.env')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/)
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
}

async function main() {
  const server   = process.env.AZURE_SQL_SERVER?.trim()
  const database = process.env.AZURE_SQL_DATABASE?.trim()
  const user     = process.env.AZURE_SQL_USER?.trim()
  const password = process.env.AZURE_SQL_PASSWORD?.trim()

  if (!server || !database || !user || !password) {
    console.error('Missing env vars') 
    process.exit(1)
  }

  const pool = await new sql.ConnectionPool({
    server, database, user, password,
    options: { encrypt: true, trustServerCertificate: false },
    pool: { max: 2, min: 0, idleTimeoutMillis: 60000 },
  }).connect()

  try {
    const res = await pool.request().query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`,
    )
    const tables = res.recordset.map((r) => r.TABLE_NAME)
    console.log(`Database: ${database} @ ${server}`)
    console.log(`Total tables: ${tables.length}`)
    console.log('Tables:')
    for (const t of tables) console.log('  -', t)

    const wanted = [
      'notification_deliveries', 'notification_events',
      'approval_workflow_stage_instances',
      'approval_workflow_instances',
      'approval_workflow_approver_instances',
      'approval_workflow_history',
    ]
    console.log('\nWanted table presence:')
    for (const w of wanted) {
      console.log(`  ${tables.includes(w) ? 'OK ' : 'MISSING'} ${w}`)
    }
  } finally {
    await pool.close()
  }
}

main().catch((e) => {
  console.error('Error:', e)
  process.exit(1)
})
