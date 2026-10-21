#!/usr/bin/env node
/**
 * Apply the webhooks schema to Azure SQL.
 *
 *   cd server
 *   node scripts/apply-webhooks-sqlserver.mjs
 *
 * Reads AZURE_SQL_SERVER / AZURE_SQL_DATABASE / AZURE_SQL_USER /
 * AZURE_SQL_PASSWORD from server/.env. Safe to re-run — every statement
 * in webhooks-sqlserver.sql is guarded.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import sql from 'mssql'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(here, '..', '.env') })

const server = process.env.AZURE_SQL_SERVER?.trim()
const database = process.env.AZURE_SQL_DATABASE?.trim()
const user = process.env.AZURE_SQL_USER?.trim()
const password = process.env.AZURE_SQL_PASSWORD?.trim()

if (!server || !database || !user || !password) {
  console.error('Missing AZURE_SQL_SERVER / AZURE_SQL_DATABASE / AZURE_SQL_USER / AZURE_SQL_PASSWORD in server/.env')
  process.exit(1)
}

const sqlPath = path.join(here, 'webhooks-sqlserver.sql')
const script = fs.readFileSync(sqlPath, 'utf8')

// Split on GO batch separators (not inside a string literal — this script has none).
const batches = script
  .split(/^\s*GO\s*$/im)
  .map(b => b.trim())
  .filter(Boolean)

const config = {
  server,
  database,
  user,
  password,
  options: { encrypt: true, trustServerCertificate: false },
  requestTimeout: 120000,
  connectionTimeout: 120000,
}

console.log(`[webhooks] Connecting to ${server} / ${database} …`)

let pool
for (let attempt = 1; attempt <= 10; attempt++) {
  try {
    pool = await new sql.ConnectionPool(config).connect()
    break
  } catch (err) {
    console.warn(`[webhooks] connect attempt ${attempt}/10 failed: ${err.message}`)
    if (attempt === 10) {
      console.error('[webhooks] giving up — is the serverless database awake?')
      process.exit(1)
    }
    await new Promise(r => setTimeout(r, 5000))
  }
}

try {
  for (const [i, batch] of batches.entries()) {
    await pool.request().batch(batch)
    console.log(`[webhooks] batch ${i + 1}/${batches.length} ok`)
  }

  const check = await pool.request().query(`
    SELECT name FROM sys.tables
     WHERE name IN ('webhooks', 'webhook_deliveries', 'webhook_field_bindings')
     ORDER BY name
  `)
  const found = check.recordset.map(r => r.name)
  console.log(`[webhooks] tables present: ${found.join(', ') || '(none)'}`)
  if (found.length !== 3) {
    console.error('[webhooks] expected 3 tables — check the output above')
    process.exitCode = 1
  } else {
    console.log('[webhooks] done')
  }
} catch (err) {
  console.error('[webhooks] failed:', err.message)
  process.exitCode = 1
} finally {
  await pool.close()
}
