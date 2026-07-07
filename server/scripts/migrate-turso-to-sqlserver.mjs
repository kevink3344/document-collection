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
  return '[' + String(identifier).replaceAll(']', ']]') + ']'
}

function getSqlServerCreateTableStatement(tableName) {
  switch (tableName) {
    case 'organizations':
      return `
        CREATE TABLE [dbo].[organizations] (
          [id] INT IDENTITY(1,1) PRIMARY KEY,
          [name] NVARCHAR(255) NOT NULL UNIQUE,
          [slug] NVARCHAR(255) NULL,
          [description] NVARCHAR(MAX) NULL,
          [is_active] INT NOT NULL CONSTRAINT [DF_organizations_is_active] DEFAULT 1,
          [created_at] DATETIME2 NOT NULL CONSTRAINT [DF_organizations_created_at] DEFAULT GETDATE(),
          [updated_at] DATETIME2 NOT NULL CONSTRAINT [DF_organizations_updated_at] DEFAULT GETDATE()
        )
      `

    case 'users':
      return `
        CREATE TABLE [dbo].[users] (
          [id] INT IDENTITY(1,1) PRIMARY KEY,
          [name] NVARCHAR(255) NOT NULL,
          [email] NVARCHAR(255) NULL,
          [role] NVARCHAR(50) NOT NULL CONSTRAINT [DF_users_role] DEFAULT 'user',
          [organization] NVARCHAR(255) NULL,
          [organization_id] INT NULL CONSTRAINT [FK_users_organization] FOREIGN KEY REFERENCES [dbo].[organizations]([id]),
          [created_at] DATETIME2 NOT NULL CONSTRAINT [DF_users_created_at] DEFAULT GETDATE()
        )
      `

    case 'gallery_assets':
      return `
        CREATE TABLE [dbo].[gallery_assets] (
          [id] INT IDENTITY(1,1) PRIMARY KEY,
          [organization_id] INT NOT NULL CONSTRAINT [FK_gallery_assets_organization] FOREIGN KEY REFERENCES [dbo].[organizations]([id]) ON DELETE CASCADE,
          [name] NVARCHAR(255) NOT NULL,
          [alt_text] NVARCHAR(MAX) NULL,
          [tags] NVARCHAR(MAX) NULL,
          [mime_type] NVARCHAR(255) NOT NULL,
          [size_bytes] INT NOT NULL CONSTRAINT [DF_gallery_assets_size_bytes] DEFAULT 0,
          [drive_file_id] NVARCHAR(255) NOT NULL UNIQUE,
          [drive_web_view_url] NVARCHAR(MAX) NULL,
          [drive_download_url] NVARCHAR(MAX) NULL,
          [file_data] NVARCHAR(MAX) NULL,
          [created_by_user_id] INT NULL CONSTRAINT [FK_gallery_assets_created_by] FOREIGN KEY REFERENCES [dbo].[users]([id]) ON DELETE SET NULL,
          [created_at] DATETIME2 NOT NULL CONSTRAINT [DF_gallery_assets_created_at] DEFAULT GETDATE(),
          [updated_at] DATETIME2 NOT NULL CONSTRAINT [DF_gallery_assets_updated_at] DEFAULT GETDATE()
        )
      `

    case 'categories':
      return `
        CREATE TABLE [dbo].[categories] (
          [id] INT IDENTITY(1,1) PRIMARY KEY,
          [name] NVARCHAR(255) NOT NULL,
          [sort_order] INT NOT NULL CONSTRAINT [DF_categories_sort_order] DEFAULT 0,
          [organization_id] INT NULL CONSTRAINT [FK_categories_organization] FOREIGN KEY REFERENCES [dbo].[organizations]([id]),
          [created_at] DATETIME2 NOT NULL CONSTRAINT [DF_categories_created_at] DEFAULT GETDATE(),
          [updated_at] DATETIME2 NOT NULL CONSTRAINT [DF_categories_updated_at] DEFAULT GETDATE()
        )
      `

    case 'collections':
      return `
        CREATE TABLE [dbo].[collections] (
          [id] INT IDENTITY(1,1) PRIMARY KEY,
          [slug] NVARCHAR(255) NOT NULL UNIQUE,
          [title] NVARCHAR(255) NOT NULL,
          [status] NVARCHAR(50) NOT NULL CONSTRAINT [DF_collections_status] DEFAULT 'draft',
          [description] NVARCHAR(MAX) NULL,
          [category] NVARCHAR(255) NULL,
          [created_by] INT NOT NULL CONSTRAINT [FK_collections_created_by] FOREIGN KEY REFERENCES [dbo].[users]([id]),
          [date_due] DATETIME2 NULL,
          [cover_photo_url] NVARCHAR(MAX) NULL,
          [cover_photo_asset_id] INT NULL CONSTRAINT [FK_collections_cover_photo_asset] FOREIGN KEY REFERENCES [dbo].[gallery_assets]([id]) ON DELETE SET NULL,
          [logo_url] NVARCHAR(MAX) NULL,
          [instructions] NVARCHAR(MAX) NULL,
          [instructions_doc_url] NVARCHAR(MAX) NULL,
          [workflow_definition] NVARCHAR(MAX) NULL,
          [source_template_collection_id] INT NULL CONSTRAINT [FK_collections_source_template] FOREIGN KEY REFERENCES [dbo].[collections]([id]) ON DELETE SET NULL,
          [organization_id] INT NOT NULL CONSTRAINT [FK_collections_organization] FOREIGN KEY REFERENCES [dbo].[organizations]([id]),
          [active_version_id] INT NULL,
          [anonymous] INT NOT NULL CONSTRAINT [DF_collections_anonymous] DEFAULT 0,
          [allow_submission_edits] INT NOT NULL CONSTRAINT [DF_collections_allow_submission_edits] DEFAULT 0,
          [submission_edit_window_hours] INT NULL,
          [created_at] DATETIME2 NOT NULL CONSTRAINT [DF_collections_created_at] DEFAULT GETDATE(),
          [updated_at] DATETIME2 NOT NULL CONSTRAINT [DF_collections_updated_at] DEFAULT GETDATE()
        )
      `

    case 'collection_versions':
      return `
        CREATE TABLE [dbo].[collection_versions] (
          [id] INT IDENTITY(1,1) PRIMARY KEY,
          [collection_id] INT NOT NULL CONSTRAINT [FK_collection_versions_collection] FOREIGN KEY REFERENCES [dbo].[collections]([id]) ON DELETE CASCADE,
          [version_number] INT NOT NULL,
          [status] NVARCHAR(50) NOT NULL CONSTRAINT [DF_collection_versions_status] DEFAULT 'draft',
          [created_by] INT NULL CONSTRAINT [FK_collection_versions_created_by] FOREIGN KEY REFERENCES [dbo].[users]([id]),
          [created_at] DATETIME2 NOT NULL CONSTRAINT [DF_collection_versions_created_at] DEFAULT GETDATE(),
          [published_at] DATETIME2 NULL,
          CONSTRAINT [UQ_collection_versions_collection_version] UNIQUE ([collection_id], [version_number])
        )
      `

    case 'collection_fields':
      return `
        CREATE TABLE [dbo].[collection_fields] (
          [id] INT IDENTITY(1,1) PRIMARY KEY,
          [collection_id] INT NOT NULL CONSTRAINT [FK_collection_fields_collection] FOREIGN KEY REFERENCES [dbo].[collections]([id]) ON DELETE CASCADE,
          [version_id] INT NULL CONSTRAINT [FK_collection_fields_version] FOREIGN KEY REFERENCES [dbo].[collection_versions]([id]) ON DELETE CASCADE,
          [field_key] NVARCHAR(255) NULL,
          [type] NVARCHAR(100) NOT NULL,
          [label] NVARCHAR(255) NOT NULL,
          [subtitle] NVARCHAR(MAX) NULL,
          [page_number] INT NOT NULL CONSTRAINT [DF_collection_fields_page_number] DEFAULT 1,
          [required] INT NOT NULL CONSTRAINT [DF_collection_fields_required] DEFAULT 0,
          [options] NVARCHAR(MAX) NULL,
          [display_style] NVARCHAR(100) NOT NULL CONSTRAINT [DF_collection_fields_display_style] DEFAULT 'radio',
          [branch_rules] NVARCHAR(MAX) NULL,
          [sort_order] INT NOT NULL CONSTRAINT [DF_collection_fields_sort_order] DEFAULT 0,
          [location_filter_enabled] INT NOT NULL CONSTRAINT [DF_collection_fields_location_filter_enabled] DEFAULT 0
        )
      `

    case 'collection_table_columns':
      return `
        CREATE TABLE [dbo].[collection_table_columns] (
          [id] INT IDENTITY(1,1) PRIMARY KEY,
          [field_id] INT NOT NULL CONSTRAINT [FK_collection_table_columns_field] FOREIGN KEY REFERENCES [dbo].[collection_fields]([id]) ON DELETE CASCADE,
          [name] NVARCHAR(255) NOT NULL,
          [col_type] NVARCHAR(50) NOT NULL CONSTRAINT [DF_collection_table_columns_col_type] DEFAULT 'text',
          [list_options] NVARCHAR(MAX) NULL,
          [sort_order] INT NOT NULL CONSTRAINT [DF_collection_table_columns_sort_order] DEFAULT 0
        )
      `

    case 'collection_shares':
      return `
        CREATE TABLE [dbo].[collection_shares] (
          [id] INT IDENTITY(1,1) PRIMARY KEY,
          [collection_id] INT NOT NULL CONSTRAINT [FK_collection_shares_collection] FOREIGN KEY REFERENCES [dbo].[collections]([id]) ON DELETE CASCADE,
          [share_type] NVARCHAR(20) NOT NULL,
          [share_target_id] INT NOT NULL,
          [granted_by] INT NULL CONSTRAINT [FK_collection_shares_granted_by] FOREIGN KEY REFERENCES [dbo].[users]([id]) ON DELETE SET NULL,
          [created_at] DATETIME2 NOT NULL CONSTRAINT [DF_collection_shares_created_at] DEFAULT GETDATE(),
          CONSTRAINT [UQ_collection_shares_collection_target] UNIQUE ([collection_id], [share_type], [share_target_id])
        )
      `

    case 'collection_ticket_templates':
      return `
        CREATE TABLE [dbo].[collection_ticket_templates] (
          [id] INT IDENTITY(1,1) PRIMARY KEY,
          [collection_id] INT NOT NULL CONSTRAINT [FK_collection_ticket_templates_collection] FOREIGN KEY REFERENCES [dbo].[collections]([id]) ON DELETE CASCADE,
          [ticket_template_id] INT NOT NULL CONSTRAINT [FK_collection_ticket_templates_template] FOREIGN KEY REFERENCES [dbo].[ticket_templates]([id]) ON DELETE CASCADE,
          [display_order] INT NOT NULL CONSTRAINT [DF_collection_ticket_templates_display_order] DEFAULT 0,
          [is_active] INT NOT NULL CONSTRAINT [DF_collection_ticket_templates_is_active] DEFAULT 1,
          [created_at] DATETIME2 NOT NULL CONSTRAINT [DF_collection_ticket_templates_created_at] DEFAULT GETDATE(),
          [updated_at] DATETIME2 NOT NULL CONSTRAINT [DF_collection_ticket_templates_updated_at] DEFAULT GETDATE(),
          CONSTRAINT [UQ_collection_ticket_templates_collection_template] UNIQUE ([collection_id], [ticket_template_id])
        )
      `

    case 'ticket_templates':
      return `
        CREATE TABLE [dbo].[ticket_templates] (
          [id] INT IDENTITY(1,1) PRIMARY KEY,
          [organization_id] INT NULL CONSTRAINT [FK_ticket_templates_organization] FOREIGN KEY REFERENCES [dbo].[organizations]([id]) ON DELETE CASCADE,
          [title] NVARCHAR(255) NOT NULL,
          [description] NVARCHAR(MAX) NULL,
          [created_by] INT NULL CONSTRAINT [FK_ticket_templates_created_by] FOREIGN KEY REFERENCES [dbo].[users]([id]) ON DELETE SET NULL,
          [is_active] INT NOT NULL CONSTRAINT [DF_ticket_templates_is_active] DEFAULT 1,
          [created_at] DATETIME2 NOT NULL CONSTRAINT [DF_ticket_templates_created_at] DEFAULT GETDATE(),
          [updated_at] DATETIME2 NOT NULL CONSTRAINT [DF_ticket_templates_updated_at] DEFAULT GETDATE()
        )
      `

    case 'ticket_fields':
      return `
        CREATE TABLE [dbo].[ticket_fields] (
          [id] INT IDENTITY(1,1) PRIMARY KEY,
          [collection_id] INT NULL CONSTRAINT [FK_ticket_fields_collection] FOREIGN KEY REFERENCES [dbo].[collections]([id]) ON DELETE CASCADE,
          [ticket_template_id] INT NULL CONSTRAINT [FK_ticket_fields_template] FOREIGN KEY REFERENCES [dbo].[ticket_templates]([id]) ON DELETE CASCADE,
          [field_key] NVARCHAR(255) NULL,
          [type] NVARCHAR(100) NOT NULL,
          [label] NVARCHAR(255) NOT NULL,
          [subtitle] NVARCHAR(MAX) NULL,
          [page_number] INT NOT NULL CONSTRAINT [DF_ticket_fields_page_number] DEFAULT 1,
          [required] INT NOT NULL CONSTRAINT [DF_ticket_fields_required] DEFAULT 0,
          [options] NVARCHAR(MAX) NULL,
          [display_style] NVARCHAR(100) NOT NULL CONSTRAINT [DF_ticket_fields_display_style] DEFAULT 'radio',
          [sort_order] INT NOT NULL CONSTRAINT [DF_ticket_fields_sort_order] DEFAULT 0
        )
      `

    case 'ticket_table_columns':
      return `
        CREATE TABLE [dbo].[ticket_table_columns] (
          [id] INT IDENTITY(1,1) PRIMARY KEY,
          [ticket_field_id] INT NOT NULL CONSTRAINT [FK_ticket_table_columns_field] FOREIGN KEY REFERENCES [dbo].[ticket_fields]([id]) ON DELETE CASCADE,
          [name] NVARCHAR(255) NOT NULL,
          [col_type] NVARCHAR(50) NOT NULL CONSTRAINT [DF_ticket_table_columns_col_type] DEFAULT 'text',
          [list_options] NVARCHAR(MAX) NULL,
          [sort_order] INT NOT NULL CONSTRAINT [DF_ticket_table_columns_sort_order] DEFAULT 0
        )
      `

    case 'app_settings':
      return `
        CREATE TABLE [dbo].[app_settings] (
          [key] NVARCHAR(255) NOT NULL PRIMARY KEY,
          [value] NVARCHAR(MAX) NOT NULL
        )
      `
  }

  throw new Error(`No SQL Server schema defined for metadata table: ${tableName}`)
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
  // Strip SQLite-specific collation modifiers — SQL Server uses database-level collation
  ddl = ddl.replace(/\s+COLLATE\s+(?:NOCASE|BINARY|RTRIM)\b/gi, '')
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
  ddl = ddl.replace(/(^|[,(])\s*([A-Za-z_][A-Za-z0-9_]*)(?=\s+(?:INT|INTEGER|NVARCHAR(?:\([^)]*\))?|FLOAT|VARBINARY(?:\([^)]*\))?|BIT|DECIMAL(?:\([^)]*\))?|TEXT|REAL|BLOB|BOOLEAN|NUMERIC|VARCHAR(?:\([^)]*\))?|DATETIME|DATE|TIME|DEFAULT|NOT\s+NULL|PRIMARY|REFERENCES|CHECK|UNIQUE|CONSTRAINT)(?:\s|,|$))/gim, (_match, prefix, name) => `${prefix}${quoteSqlServerIdentifier(name)}`)
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
    const tableName = table.name
    const createSql = getSqlServerCreateTableStatement(tableName)
    console.log(`[migrate:turso-to-sqlserver] Creating ${tableName}`)
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
