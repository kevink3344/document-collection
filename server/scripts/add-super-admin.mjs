import { createClient } from '@libsql/client'

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN

if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN env vars')
  process.exit(1)
}

async function main() {
  const turso = createClient({ url, authToken })

  // Clean up any leftover users_new from previous runs
  await turso.execute(`DROP TABLE IF EXISTS users_new`)

  // Ensure the ASD org exists
  await turso.execute(`
    INSERT OR IGNORE INTO organizations (name, slug, description, is_active)
    VALUES ('ASD', 'asd', 'Administrative', 1)
  `)
  const orgResult = await turso.execute(`SELECT id FROM organizations WHERE slug = 'asd'`)
  const orgId = orgResult.rows[0].id
  console.log(`ASD organization id: ${orgId}`)

  // Check if constraint already includes super_admin
  const tableInfo = await turso.execute(`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`)
  const currentSql = tableInfo.rows[0]?.sql ?? ''

  if (!currentSql.includes('super_admin')) {
    console.log('Recreating users table with updated CHECK constraint...')

    // PRAGMA foreign_keys = OFF via execute() persists on the same WebSocket connection
    await turso.execute(`PRAGMA foreign_keys = OFF`)

    await turso.execute(`
      CREATE TABLE users_new (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT    NOT NULL,
        email           TEXT    UNIQUE NOT NULL,
        role            TEXT    NOT NULL DEFAULT 'user'
                                CHECK(role IN ('super_admin', 'administrator', 'team_manager', 'user')),
        organization    TEXT,
        organization_id INTEGER REFERENCES organizations(id),
        created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `)
    await turso.execute(`INSERT INTO users_new SELECT * FROM users`)
    await turso.execute(`DROP TABLE users`)
    await turso.execute(`ALTER TABLE users_new RENAME TO users`)
    await turso.execute(`PRAGMA foreign_keys = ON`)

    console.log('users table schema updated.')
  } else {
    console.log('users table already includes super_admin constraint.')
  }

  // Insert super admin if not already present
  const existing = await turso.execute(`SELECT * FROM users WHERE email = 'superadmin@admin.local'`)
  if (existing.rows.length > 0) {
    console.log('Super Admin already exists:', existing.rows[0])
    return
  }

  await turso.execute({
    sql: `INSERT INTO users (name, email, role, organization, organization_id)
          VALUES (?, ?, 'super_admin', 'ASD', ?)`,
    args: ['Super Admin', 'superadmin@admin.local', orgId]
  })
  const result = await turso.execute(`SELECT * FROM users WHERE email = 'superadmin@admin.local'`)
  console.log('Super Admin created:', result.rows[0])
}

main().catch(console.error)
