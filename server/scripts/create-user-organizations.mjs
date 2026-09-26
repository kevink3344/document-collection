/**
 * Create user_organizations in PRODUCTION (wcpss-data-collection) and seed it
 * from the existing users.organization_id + users.role values.
 *
 * Why this is needed:
 *   - user_organizations was never created in SQL Server. It backs:
 *       * GET /api/auth/organizations  (login org picker, INNER JOIN user_organizations)
 *       * loadUserAccessProfile -> loadMemberships (resolves active org + role, drives
 *         dashboard scope, stat cards, org switching)
 *       * GET /api/organizations       (admin org list, JOIN user_organizations for non-super-admin)
 *     Without it the login picker returns NO orgs and the dashboard stat cards stay empty.
 *
 * Seed source:
 *   - Each user's users.organization_id maps to a membership row (is_default = 1).
 *   - super_admin maps to role 'administrator' in memberships (matches sqlite migration).
 *   - Rows are only inserted when they DON'T already exist (idempotent).
 *
 * Usage (run from server/):
 *   node scripts/create-user-organizations.mjs
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
  server: process.env.AZURE_SQL_SERVER,
  database: process.env.AZURE_SQL_DATABASE,
  user: process.env.AZURE_SQL_USER,
  password: process.env.AZURE_SQL_PASSWORD,
  options: { encrypt: true, trustServerCertificate: false },
  pool: { max: 2, min: 0, idleTimeoutMillis: 120000 },
  connectionTimeout: 30000,
  requestTimeout: 30000,
}

console.log(`Target: ${cfg.database} @ ${cfg.server}`)

// Serverless Azure SQL (and elastic-pool DBs) can auto-suspend when idle; the
// first login after a cold start often drops with ETIMEOUT. Retry with backoff.
async function connectWithRetry(attempts = 5, delayMs = 5000) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const p = await new sql.ConnectionPool(cfg).connect()
      console.log(`  Connected (attempt ${i})`)
      return p
    } catch (err) {
      const msg = err?.message ?? String(err)
      console.log(`  Attempt ${i}/${attempts} failed: ${msg}`)
      if (i === attempts) throw err
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw new Error('unreachable')
}

const pool = await connectWithRetry()
try {
  // ---- 1. Create table if missing ----
  const exists = await pool
    .request()
    .query(`SELECT 1 AS c FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='user_organizations'`)
  let created = false
  if (exists.recordset.length === 0) {
    await pool.request().query(`
      CREATE TABLE [dbo].[user_organizations] (
        [user_id]         BIGINT NOT NULL,
        [organization_id] BIGINT NOT NULL,
        [role]            NVARCHAR(MAX) NOT NULL
                          CONSTRAINT [CK_user_organizations_role] CHECK (role IN ('administrator', 'team_manager', 'reviewer', 'user')),
        [is_default]      BIGINT NOT NULL CONSTRAINT [DF_user_organizations_is_default] DEFAULT 0,
        [created_at]      NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_user_organizations_created_at] DEFAULT GETDATE(),
        [updated_at]      NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_user_organizations_updated_at] DEFAULT GETDATE(),
        CONSTRAINT [PK_user_organizations] PRIMARY KEY (user_id, organization_id),
        CONSTRAINT [FK_user_organizations_user_id] FOREIGN KEY (user_id) REFERENCES [dbo].[users]([id]),
        CONSTRAINT [FK_user_organizations_organization_id] FOREIGN KEY (organization_id) REFERENCES [dbo].[organizations]([id])
      )
    `)
    created = true
    console.log('  CREATED table user_organizations')
  } else {
    console.log('  Table already exists (skipped create)')
  }

  // ---- 2. Seed from users.organization_id (idempotent) ----
  const seeded = await pool.request().query(`
    INSERT INTO [dbo].[user_organizations] (user_id, organization_id, role, is_default)
    SELECT u.id,
           u.organization_id,
           CASE WHEN u.role = 'super_admin' THEN 'administrator' ELSE u.role END,
           1
    FROM [dbo].[users] u
    WHERE u.organization_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM [dbo].[user_organizations] uo
        WHERE uo.user_id = u.id AND uo.organization_id = u.organization_id
      )
  `)
  console.log(`  Seeded ${seeded.rowsAffected?.[0] ?? 0} membership row(s) from users`)

  // ---- 3. Verify ----
  const counts = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[user_organizations]) AS membership_count,
      (SELECT COUNT(DISTINCT user_id) FROM [dbo].[user_organizations]) AS distinct_users,
      (SELECT COUNT(DISTINCT organization_id) FROM [dbo].[user_organizations]) AS distinct_orgs
  `)
  const c = counts.recordset[0]
  console.log(`  Membership rows: ${c.membership_count} | distinct users: ${c.distinct_users} | distinct orgs: ${c.distinct_orgs}`)

  // ---- 4. Show derived login-picker orgs (mirror of /api/auth/organizations + ORG_LIST) ----
  const orgRows = await pool.request().query(`
    SELECT DISTINCT o.id, o.name, o.slug, o.description
    FROM [dbo].[organizations] o
    INNER JOIN [dbo].[user_organizations] uo ON uo.organization_id = o.id
    ORDER BY o.name
  `)
  console.log('  Orgs visible to login picker (INNER JOIN user_organizations):')
  for (const r of orgRows.recordset) console.log(`    ${r.id}. ${r.name} (slug=${r.slug})`)

  console.log(created ? '\nDone. Created + seeded user_organizations.' : '\nDone. user_organizations present (no create, seed only).')
} finally {
  await pool.close()
}
