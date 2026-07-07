import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { createClient } from '@libsql/client'
import sql from 'mssql'

const DEFAULT_TABLES = [
  'organizations',
  'users',
  'gallery_assets',
  'categories',
  'collections',
  'collection_versions',
  'collection_fields',
  'collection_table_columns',
  'collection_shares',
  'collection_ticket_templates',
  'ticket_templates',
  'ticket_fields',
  'ticket_table_columns',
  'app_settings',
]

const SKIP_TABLE_PATTERNS = [
  /^sqlite_/i,
  /^collection_responses$/i,
  /^collection_response_values$/i,
  /^response_attachments$/i,
  /^submission/i,
  /^audit/i,
]

function parseArgs(argv) {
  const options = {
    dryRun: false,
    tables: [],
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--tables') {
      const value = argv[i + 1]
      if (!value) throw new Error('Missing value for --tables')
      options.tables = value.split(',').map((entry) => entry.trim()).filter(Boolean)
      i += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function printHelp() {
  console.log(`Usage: node scripts/migrate-turso-to-sqlserver.mjs [options]\n\nOptions:\n  --dry-run           Preview the migration without writing to SQL Server\n  --tables table1,table2  Override the default metadata table list\n  --help, -h          Show this help message`)
}

function qIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`
}

function quoteSqlServerIdentifier(identifier) {
  return `[${String(identifier).replaceAll(']', ']]')}]`
}

function shouldIncludeTable(tableName, explicitTables) {
  if (explicitTables.length) {
    return explicitTables.includes(tableName)
  }

  if (SKIP_TABLE_PATTERNS.some((pattern) => pattern.test(tableName))) {
    return false
  }

  return DEFAULT_TABLES.includes(tableName)
}

async function topologicalSort(tables, sourceDb) {
  const nameSet = new Set(tables.map((table) => table.name))
  const deps = new Map()

  for (const table of tables) {
    const result = await sourceDb.execute(`PRAGMA foreign_key_list(${qIdent(table.name)})`)
    const fkList = Array.isArray(result?.rows) ? result.rows : []
    deps.set(
      table.name,
      fkList
        .map((fk) => fk?.[2])
        .filter((dep) => typeof dep === 'string' && nameSet.has(dep) && dep !== table.name)
    )
  }

  const sorted = []
  const visited = new Set()

  function visit(name) {
    if (visited.has(name)) return
    visited.add(name)
    for (const dep of deps.get(name) ?? []) visit(dep)
    sorted.push(tables.find((table) => table.name === name))
  }

  for (const table of tables) visit(table.name)
  return sorted
}

function translateCreateTableSql(sqlStatement) {
  let ddl = sqlStatement.trim()
  const tableNameMatch = ddl.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"|`))?([A-Za-z_][A-Za-z0-9_]*)(?:(?:"|`))?/i)
  const tableName = tableNameMatch?.[1]

  ddl = ddl.replace(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i, 'CREATE TABLE ')
  if (tableName) {
    ddl = ddl.replace(/^CREATE\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)/i, `CREATE TABLE ${quoteSqlServerIdentifier(tableName)}`)
  }
  ddl = ddl.replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'INT IDENTITY(1,1) PRIMARY KEY')
  ddl = ddl.replace(/\bINTEGER\s+PRIMARY\s+KEY\b/gi, 'INT PRIMARY KEY')
  ddl = ddl.replace(/\bINTEGER\b/gi, 'INT')
  ddl = ddl.replace(/\bTEXT\b/gi, 'NVARCHAR(MAX)')
  ddl = ddl.replace(/\bREAL\b/gi, 'FLOAT')
  ddl = ddl.replace(/\bBLOB\b/gi, 'VARBINARY(MAX)')
  ddl = ddl.replace(/\bBOOLEAN\b/gi, 'BIT')
  ddl = ddl.replace(/\bNUMERIC\b/gi, 'DECIMAL(18,2)')
  ddl = ddl.replace(/\(datetime\('now'\)\)/gi, '(GETDATE())')
  ddl = ddl.replace(/\bCURRENT_TIMESTAMP\b/gi, 'GETDATE()')
  ddl = ddl.replace(/(^|[,(])\s*([A-Za-z_][A-Za-z0-9_]*)(?=\s+(?:INT|INTEGER|NVARCHAR|FLOAT|VARBINARY|BIT|DECIMAL|TEXT|REAL|BLOB|BOOLEAN|NUMERIC|VARCHAR|DATETIME|DATE|TIME|DEFAULT|NOT\s+NULL|PRIMARY|REFERENCES|CHECK|UNIQUE|CONSTRAINT)(?:\s|,|$))/gim, (_match, prefix, name) => `${prefix}${quoteSqlServerIdentifier(name)}`)
  ddl = ddl.replace(/;\s*$/i, '')
  return ddl
}

function toSqlServerValue(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value
  if (value instanceof Date) return value
  return String(value)
}

function inferMssqlType(value) {
  if (value === null || value === undefined) return sql.NVarChar(sql.MAX)
  if (typeof value === 'number') {
    return Number.isInteger(value) ? sql.Int : sql.Decimal(18, 2)
  }
  if (typeof value === 'boolean') return sql.Bit
  if (value instanceof Date) return sql.DateTime
  return sql.NVarChar(sql.MAX)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  const tursoUrl = process.env.TURSO_DATABASE_URL
  const tursoToken = process.env.TURSO_AUTH_TOKEN
  const sqlServer = process.env.AZURE_SQL_SERVER
  const sqlDatabase = process.env.AZURE_SQL_DATABASE
  const sqlUser = process.env.AZURE_SQL_USER
  const sqlPassword = process.env.AZURE_SQL_PASSWORD

  if (!tursoUrl || !tursoToken) {
    throw new Error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in environment')
  }

  if (!sqlServer || !sqlDatabase || !sqlUser || !sqlPassword) {
    throw new Error('Missing Azure SQL environment variables: AZURE_SQL_SERVER, AZURE_SQL_DATABASE, AZURE_SQL_USER, AZURE_SQL_PASSWORD')
  }

  console.log('[migrate:turso-to-sqlserver] Source Turso:', tursoUrl)
  console.log('[migrate:turso-to-sqlserver] Target SQL Server:', `${sqlServer}/${sqlDatabase}`)

  const sourceDb = createClient({ url: tursoUrl, authToken: tursoToken })
  const pool = await sql.connect({
    server: sqlServer,
    database: sqlDatabase,
    user: sqlUser,
    password: sqlPassword,
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
  })

  const sqliteTables = await sourceDb.execute(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `)

  const tables = sqliteTables.rows
    .map((row) => ({ name: row[0], sql: row[1] }))
    .filter((table) => shouldIncludeTable(table.name, options.tables))

  if (!tables.length) {
    console.log('[migrate:turso-to-sqlserver] No metadata tables matched the selection. Nothing to migrate.')
    return
  }

  console.log(`[migrate:turso-to-sqlserver] Selected tables: ${tables.map((table) => table.name).join(', ')}`)

  const orderedLocalTables = await topologicalSort(tables.map((table) => ({ ...table })), sourceDb)

  if (options.dryRun) {
    console.log('[migrate:turso-to-sqlserver] Dry run complete. No data was written.')
    await pool.close()
    return
  }

  for (const table of [...orderedLocalTables].reverse()) {
    try {
      await pool.request().query(`IF OBJECT_ID(N'[dbo].[${table.name}]', N'U') IS NOT NULL DROP TABLE [dbo].[${table.name}]`)
    } catch (error) {
      console.warn(`[migrate:turso-to-sqlserver] Warning while dropping ${table.name}:`, error.message)
    }
  }

  for (const table of orderedLocalTables) {
    const createSql = translateCreateTableSql(table.sql)
    console.log(`[migrate:turso-to-sqlserver] Creating ${table.name}`)
    await pool.request().query(createSql)
  }

  for (const table of orderedLocalTables) {
    const rowsResult = await sourceDb.execute(`SELECT * FROM ${qIdent(table.name)}`)
    const rows = rowsResult.rows
    if (!rows.length) {
      console.log(`[migrate:turso-to-sqlserver] ${table.name}: 0 rows`)
      continue
    }

    const columns = rowsResult.columns?.map((column) => column.name) ?? []
    if (!columns.length) {
      console.log(`[migrate:turso-to-sqlserver] ${table.name}: 0 columns, skipping`)
      continue
    }

    const hasIdentity = /IDENTITY\s*\(/i.test(table.sql)
    if (hasIdentity) {
      await pool.request().query(`SET IDENTITY_INSERT [dbo].[${table.name}] ON`)
    }

    try {
      const insertSql = `INSERT INTO [dbo].[${table.name}] (${columns.map((column) => quoteSqlServerIdentifier(column)).join(', ')}) VALUES (${columns.map((_, index) => `@p${index}`).join(', ')})`
      for (const row of rows) {
        const request = pool.request()
        columns.forEach((column, index) => {
          const rawValue = row[index]
          const value = toSqlServerValue(rawValue)
          request.input(`p${index}`, inferMssqlType(value), value)
        })
        await request.query(insertSql)
      }
    } finally {
      if (hasIdentity) {
        await pool.request().query(`SET IDENTITY_INSERT [dbo].[${table.name}] OFF`)
      }
    }

    console.log(`[migrate:turso-to-sqlserver] ${table.name}: ${rows.length} rows`)
  }

  console.log('[migrate:turso-to-sqlserver] Migration completed successfully.')
  await pool.close()
}

main().catch((error) => {
  console.error('[migrate:turso-to-sqlserver] Failed:', error?.message ?? error)
  process.exit(1)
})
