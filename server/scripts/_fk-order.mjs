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

const pool = await new sql.ConnectionPool(cfg).connect()
try {
  // FK dependency map: child -> parent tables
  const fkRes = await pool.request().query(`
    SELECT
      OBJECT_NAME(fk.parent_object_id) AS child_table,
      OBJECT_NAME(fk.referenced_object_id) AS parent_table
    FROM sys.foreign_keys fk
    WHERE OBJECT_SCHEMA_NAME(fk.parent_object_id) = 'dbo'
  `)
  const childrenParent = {}
  const parentsOf = {} // parent -> Set(children)
  for (const r of fkRes.recordset) {
    (childrenParent[r.child_table] ??= new Set()).add(r.parent_table)
    ;(parentsOf[r.parent_table] ??= new Set()).add(r.child_table)
  }

  // Topological sort: a table can be emitted only after all its parents
  const allTables = (await pool.request().query(`SELECT name FROM sys.tables WHERE schema_id = SCHEMA_ID('dbo') ORDER BY name`))
    .recordset.map(r => r.name)

  const emitted = new Set()
  const order = []
  let changed = true
  while (order.length < allTables.length && changed) {
    changed = false
    for (const t of allTables) {
      if (emitted.has(t)) continue
      const parents = childrenParent[t] ?? new Set()
      const parentsEmitted = [...parents].every(p => emitted.has(p))
      if (parentsEmitted) {
        order.push(t)
        emitted.add(t)
        changed = true
      }
    }
  }
  // Any remaining (cycles) appended
  for (const t of allTables) if (!emitted.has(t)) order.push(t)

  console.log('=== FK creation order (parents first) ===')
  order.forEach((t, i) => console.log(`  ${i + 1}. ${t}`))

  console.log('\n=== FK edges ===')
  for (const [child, parents] of Object.entries(childrenParent)) {
    console.log(`  ${child} -> ${[...parents].join(', ')}`)
  }

  // Write order to a cache file for reuse by the generator
  fs.writeFileSync(path.join(__dirname, '_fk-order.json'), JSON.stringify({ order }, null, 2))
  console.log('\nWrote _fk-order.json')
} finally {
  await pool.close()
}
