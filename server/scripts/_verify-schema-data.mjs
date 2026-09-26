/**
 * Verify that docs/data/collection-schema.sql contains the same data as the
 * SANDBOX. Reads each table's row count from the generated file (counting the
 * parenthesized tuples in the multi-row INSERT) and compares it against the
 * live sandbox row count.
 *
 * Run from server/:
 *   node scripts/_verify-schema-data.mjs
 */
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
  pool: { max: 1, min: 0, idleTimeoutMillis: 120000 },
  connectionTimeout: 30000,
}

// NOTE: collection-schema.sql was quarantined on 2026-09-25 (it contains 42
// DROP TABLE statements). The read-only analyzer points at the quarantined copy.
const SQL_FILE = path.join(__dirname, '..', '..', 'scripts', '_quarantine_DO_NOT_RUN', 'collection-schema.sql.quarantined')
const fileText = fs.readFileSync(SQL_FILE, 'utf-8')

// Count top-level tuples in one INSERT block. A tuple is counted when its
// outermost ')' brings paren depth back to 0. Tolerates semicolons & parens
// inside string literals.
function countTuplesInBlock(block) {
  let depth = 0
  let inStr = false
  let tuples = 0
  let pending = false
  for (let i = 0; i < block.length; i++) {
    const c = block[i]
    if (inStr) {
      if (c === "'") {
        if (block[i + 1] === "'") {
          i++
        } else {
          inStr = false
        }
      }
      continue
    }
    if (c === "'") {
      inStr = true
      continue
    }
    if (c === '(') {
      depth++
      if (depth === 1) pending = true
    } else if (c === ')') {
      depth--
      if (depth === 0 && pending) {
        tuples++
        pending = false
      }
    }
  }
  return tuples
}

// Sum tuples across ALL INSERT statements for a table (large tables are
// chunked into multiple <=1000-row INSERTs).
function countTableRows(table) {
  const re = new RegExp(
    `INSERT INTO \\[dbo\\]\\.\\[${table.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\] .*? VALUES\\n`,
    'g',
  )
  let total = 0
  let m
  while ((m = re.exec(fileText))) {
    const start = m.index + m[0].length
    let depth = 0
    let inStr = false
    let end = start
    for (let i = start; i < fileText.length; i++) {
      const c = fileText[i]
      if (inStr) {
        if (c === "'") {
          if (fileText[i + 1] === "'") {
            i++
          } else {
            inStr = false
          }
        }
        continue
      }
      if (c === "'") {
        inStr = true
        continue
      }
      if (c === '(') depth++
      else if (c === ')') depth--
      else if (c === ';' && depth === 0) {
        end = i
        break
      }
    }
    total += countTuplesInBlock(fileText.slice(start, end))
    re.lastIndex = end + 1
  }
  return total
}

const pool = await new sql.ConnectionPool(cfg).connect()
try {
  const tables = await pool.request().query(
    `SELECT t.name FROM sys.tables t ORDER BY t.name`,
  )
  let mismatch = 0
  for (const row of tables.recordset) {
    const t = row.name
    const res = await pool.request().query(
      `SELECT COUNT(*) AS c FROM [dbo].[${t}]`,
    )
    const sandboxCount = res.recordset[0].c
    const fileCount = countTableRows(t)
    const ok = sandboxCount === fileCount
    if (!ok) {
      mismatch++
      console.log(`MISMATCH ${t}: sandbox=${sandboxCount} file=${fileCount}`)
    } else if (sandboxCount > 0) {
      console.log(`OK ${t}: ${sandboxCount}`)
    }
  }
  console.log(`\nChecked ${tables.recordset.length} tables. Mismatches: ${mismatch}`)
} finally {
  await pool.close()
}
