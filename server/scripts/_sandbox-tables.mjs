import sql from 'mssql'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env')
for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const cfg = {
  server: process.env.AZURE_SQL_SERVER_SANDBOX,
  database: process.env.AZURE_SQL_DATABASE_SANDBOX,
  user: process.env.AZURE_SQL_USER_SANDBOX,
  password: process.env.AZURE_SQL_PASSWORD_SANDBOX,
  options: { encrypt: true, trustServerCertificate: false },
  pool: { max: 2, min: 0, idleTimeoutMillis: 120000 },
  connectionTimeout: 30000,
}

console.log('Sandbox:', cfg.database, '@', cfg.server)
const pool = await new sql.ConnectionPool(cfg).connect()
try {
  const res = await pool.request().query(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`)
  const tables = res.recordset.map(r => r.TABLE_NAME)
  console.log('Total tables:', tables.length)
  for (const t of tables) {
    let cnt = '-'
    try {
      const c = await pool.request().query(`SELECT COUNT(*) AS cnt FROM [dbo].[${t}]`)
      cnt = c.recordset[0].cnt
    } catch (e) {
      cnt = 'ERR: ' + e.message.slice(0, 60)
    }
    console.log(`  ${t}: ${cnt}`)
  }
} finally {
  await pool.close()
}
