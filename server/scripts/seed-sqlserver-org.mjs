/**
 * Seed initial organization and super-admin user into Azure SQL Server.
 *
 * Usage (run from the server/ directory):
 *   DB_MODE=sqlserver \
 *   AZURE_SQL_SERVER=your-server.database.windows.net \
 *   AZURE_SQL_DATABASE=your-db \
 *   AZURE_SQL_USER=your-user \
 *   AZURE_SQL_PASSWORD=your-password \
 *   node scripts/seed-sqlserver-org.mjs [--org-name "Org Name"] [--org-slug "slug"] [--email "admin@example.com"] [--password "secret"]
 *
 * All four AZURE_SQL_* env vars are required.
 * Defaults: org name = "Admin", slug = "admin", email = "superadmin@admin.local", password = "Admin@1234"
 */

import sql from 'mssql'
import crypto from 'crypto'

// ── parse CLI args ────────────────────────────────────────────────────────────
function arg(flag, defaultValue) {
  const i = process.argv.indexOf(flag)
  return i !== -1 ? process.argv[i + 1] : defaultValue
}

const ORG_NAME  = arg('--org-name', 'Admin')
const ORG_SLUG  = arg('--org-slug',  'admin')
const ADMIN_EMAIL    = arg('--email',    'superadmin@admin.local')
const ADMIN_PASSWORD = arg('--password', 'Admin@1234')
const ADMIN_NAME     = arg('--name',     'Super Admin')

// ── password hashing (mirrors server/src/routes/invitations.ts) ──────────────
function hashPassword(plain) {
  const salt    = crypto.randomBytes(16).toString('hex')
  const derived = crypto.scryptSync(plain, salt, 32).toString('hex')
  return `${salt}:${derived}`
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const server   = process.env.AZURE_SQL_SERVER?.trim()
  const database = process.env.AZURE_SQL_DATABASE?.trim()
  const user     = process.env.AZURE_SQL_USER?.trim()
  const password = process.env.AZURE_SQL_PASSWORD?.trim()

  if (!server || !database || !user || !password) {
    console.error('Missing required env vars: AZURE_SQL_SERVER, AZURE_SQL_DATABASE, AZURE_SQL_USER, AZURE_SQL_PASSWORD')
    process.exit(1)
  }

  const pool = await new sql.ConnectionPool({
    server,
    database,
    user,
    password,
    options: { encrypt: true, trustServerCertificate: false },
  }).connect()

  console.log(`Connected to ${server} / ${database}`)

  try {
    // ── 1. Ensure organization exists ─────────────────────────────────────────
    let orgRow = await pool.request()
      .input('slug', sql.NVarChar, ORG_SLUG)
      .query(`SELECT id FROM organizations WHERE slug = @slug`)

    let orgId

    if (orgRow.recordset.length === 0) {
      const ins = await pool.request()
        .input('name', sql.NVarChar, ORG_NAME)
        .input('slug', sql.NVarChar, ORG_SLUG)
        .input('desc', sql.NVarChar, 'Initial organization')
        .query(`
          INSERT INTO organizations (name, slug, description, is_active)
          VALUES (@name, @slug, @desc, 1);
          SELECT SCOPE_IDENTITY() AS id;
        `)
      orgId = ins.recordset[0].id
      console.log(`Created organization "${ORG_NAME}" (id=${orgId})`)
    } else {
      orgId = orgRow.recordset[0].id
      console.log(`Organization "${ORG_NAME}" already exists (id=${orgId})`)
    }

    // ── 2. Ensure super-admin user exists ─────────────────────────────────────
    const userRow = await pool.request()
      .input('email', sql.NVarChar, ADMIN_EMAIL)
      .query(`SELECT id FROM users WHERE LOWER(email) = LOWER(@email)`)

    let userId

    if (userRow.recordset.length === 0) {
      const passwordHash = hashPassword(ADMIN_PASSWORD)
      const ins = await pool.request()
        .input('name',          sql.NVarChar, ADMIN_NAME)
        .input('email',         sql.NVarChar, ADMIN_EMAIL)
        .input('role',          sql.NVarChar, 'super_admin')
        .input('orgId',         sql.BigInt,   orgId)
        .input('passwordHash',  sql.NVarChar, passwordHash)
        .query(`
          INSERT INTO users (name, email, role, organization_id, password_hash)
          VALUES (@name, @email, @role, @orgId, @passwordHash);
          SELECT SCOPE_IDENTITY() AS id;
        `)
      userId = ins.recordset[0].id
      console.log(`Created super-admin user "${ADMIN_NAME}" (id=${userId}, email=${ADMIN_EMAIL})`)
    } else {
      userId = userRow.recordset[0].id
      console.log(`User "${ADMIN_EMAIL}" already exists (id=${userId})`)
    }

    // ── 3. Ensure user_organizations membership exists ────────────────────────
    const memRow = await pool.request()
      .input('userId', sql.BigInt, userId)
      .input('orgId',  sql.BigInt, orgId)
      .query(`
        SELECT 1 AS found FROM user_organizations
        WHERE user_id = @userId AND organization_id = @orgId
      `)

    if (memRow.recordset.length === 0) {
      await pool.request()
        .input('userId', sql.BigInt, userId)
        .input('orgId',  sql.BigInt, orgId)
        .query(`
          INSERT INTO user_organizations (user_id, organization_id, role, is_default)
          VALUES (@userId, @orgId, 'administrator', 1)
        `)
      console.log(`Linked user to organization with role=administrator`)
    } else {
      console.log(`user_organizations membership already exists`)
    }

    console.log('\nDone. You can now log in with:')
    console.log(`  Email:    ${ADMIN_EMAIL}`)
    console.log(`  Password: ${ADMIN_PASSWORD}`)
  } finally {
    await pool.close()
  }
}

main().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
