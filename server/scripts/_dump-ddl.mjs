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

const sandboxCfg = {
  server: process.env.AZURE_SQL_SERVER_SANDBOX,
  database: process.env.AZURE_SQL_DATABASE_SANDBOX,
  user: process.env.AZURE_SQL_USER_SANDBOX,
  password: process.env.AZURE_SQL_PASSWORD_SANDBOX,
  options: { encrypt: true, trustServerCertificate: false },
  pool: { max: 2, min: 0, idleTimeoutMillis: 120000 },
}

const tables = [
  'collection_responses',
  'notification_events',
  'notification_deliveries',
  'notification_preferences',
  'notifications',
  'notification_email_ccs',
  'approval_workflow_instances',
  'approval_workflow_stage_instances',
  'approval_workflow_approver_instances',
  'approval_workflow_history',
]

const pool = await new sql.ConnectionPool(sandboxCfg).connect()
try {
  for (const t of tables) {
    console.log(`\n\n========== [${t}] ==========`)

    // Columns
    const colsRes = await pool.request().query(`
      SELECT
        c.name AS col,
        ty.name AS type_name,
        c.max_length,
        c.precision,
        c.scale,
        c.is_nullable,
        c.is_identity,
        dc.definition AS default_def,
        c.column_id
      FROM sys.columns c
      JOIN sys.types ty ON ty.user_type_id = c.user_type_id
      LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
      WHERE c.object_id = OBJECT_ID('dbo.[${t}]')
      ORDER BY c.column_id
    `)
    for (const c of colsRes.recordset) {
      console.log(`COL ${c.col}: ${c.type_name}` +
        (c.max_length === -1 ? '(max)' :
          c.type_name === 'nvarchar' ? `(${c.max_length / 2})` :
          c.type_name === 'varchar' ? `(${c.max_length})` :
          c.type_name === 'decimal' ? `(${c.precision},${c.scale})` :
          c.type_name === 'datetime2' ? `(${c.scale})` : '') +
        (c.is_identity ? ' IDENTITY' : '') +
        (c.is_nullable ? ' NULL' : ' NOT NULL') +
        (c.default_def ? ` DEFAULT ${c.default_def}` : ''))
    }

    // Primary key
    const pkRes = await pool.request().query(`
      SELECT c.name AS col
      FROM sys.indexes i
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE i.object_id = OBJECT_ID('dbo.[${t}]') AND i.is_primary_key = 1
      ORDER BY ic.key_ordinal
    `)
    if (pkRes.recordset.length) {
      console.log(`PK: ${pkRes.recordset.map((r) => r.col).join(', ')}`)
    }

    // Unique constraints
    const uqRes = await pool.request().query(`
      SELECT i.name AS idx, c.name AS col
      FROM sys.indexes i
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE i.object_id = OBJECT_ID('dbo.[${t}]') AND i.is_unique = 1 AND i.is_primary_key = 0
      ORDER BY i.name, ic.key_ordinal
    `)
    if (uqRes.recordset.length) {
      const grouped = {}
      for (const r of uqRes.recordset) (grouped[r.idx] ??= []).push(r.col)
      for (const [idx, cols] of Object.entries(grouped)) {
        console.log(`UNIQUE ${idx}: ${cols.join(', ')}`)
      }
    }

    // Foreign keys
    const fkRes = await pool.request().query(`
      SELECT fk.name AS fk_name, par.name AS parent_table,
             pc.name AS parent_col, rc.name AS ref_col, fk.delete_referential_action_desc AS del
      FROM sys.foreign_keys fk
      JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
      JOIN sys.tables par ON par.object_id = fk.parent_object_id
      JOIN sys.tables ref ON ref.object_id = fk.referenced_object_id
      JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
      LEFT JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
      WHERE par.object_id = OBJECT_ID('dbo.[${t}]')
      ORDER BY fk.name
    `)
    for (const fk of fkRes.recordset) {
      console.log(`FK ${fk.fk_name}: ${fk.parent_table}.${fk.parent_col} -> ${fk.ref_col} (del=${fk.del})`)
    }
  }
} finally {
  await pool.close()
}
