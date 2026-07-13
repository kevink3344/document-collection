import './env'
import 'express-async-errors'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { setupDatabase, resetDbIfStreamError, getDbAsync, runSqlServerSeedFile, getConfiguredDatabaseMode } from './database/db'
import { setupSwagger } from './swagger/swagger'
import authRouter from './routes/auth'
import usersRouter from './routes/users'
import categoriesRouter from './routes/categories'
import collectionsRouter from './routes/collections'
import organizationsRouter from './routes/organizations'
import settingsRouter from './routes/settings'
import preferencesRouter from './routes/preferences'
import notificationsRouter from './routes/notifications'
import statsRouter from './routes/stats'
import mySubmissionsRouter from './routes/my-submissions'
import healthRouter from './routes/health'
import invitationsRouter from './routes/invitations'
import locationsRouter from './routes/locations'
import galleryAssetsRouter from './routes/gallery-assets'
import ticketTemplatesRouter from './routes/ticket-templates'
import approvalsRouter from './routes/approvals'
import groupsRouter from './routes/groups'
import signupSlotsRouter from './routes/signup-slots'
import { dispatchPendingEmailNotifications, generateDueDateNotifications } from './services/notifications'
import { processWorkflowEscalations } from './services/approvalWorkflows'

const app = express()
const PORT = process.env.PORT ?? 4000
const IS_PROD = process.env.NODE_ENV === 'production'

// ── Env validation ───────────────────────────────────────────
const REQUIRED_ENV = ['JWT_SECRET'] as const
const GROQ_ENV = ['GROQ_API_URL', 'GROQ_API_KEY', 'GROQ_MODEL'] as const

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    if (IS_PROD) {
      const fallbackSecret = crypto.randomBytes(32).toString('hex')
      process.env.JWT_SECRET = fallbackSecret
      console.warn(`[server] WARNING: env var "${key}" is not set. Using generated fallback secret for this process.`)
    } else {
      console.warn(
        `[server] WARNING: env var "${key}" is not set. Using development fallback secret.`,
      )
    }
  }
}

const missingGroq = GROQ_ENV.filter((k) => !process.env[k])
if (missingGroq.length > 0) {
  console.warn(
    `[server] WARNING: Groq AI features are disabled. Missing env vars: ${missingGroq.join(', ')}.`,
  )
}
const NOTIFICATION_SWEEP_INTERVAL_MS = 60 * 60 * 1000

// ── Middleware ───────────────────────────────────────────────
if (!IS_PROD) {
  app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'], credentials: true }))
}
app.use(cookieParser())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// ── Database ─────────────────────────────────────────────────
setupDatabase()

// ── Super Admin bootstrap ────────────────────────────────────
async function syncSuperAdmin() {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim()
  const password = process.env.SUPER_ADMIN_PASSWORD?.trim()
  if (!email || !password) return
  try {
    const salt = crypto.randomBytes(16).toString('hex')
    const derived = crypto.scryptSync(password, salt, 32).toString('hex')
    const hash = `${salt}:${derived}`
    const db = await getDbAsync()
    // Upsert: if user exists update their hash; if not, insert as super_admin
    const existing = await db.queryOne<{ id: number }>('SELECT id FROM users WHERE lower(email) = lower(?)', [email])
    if (existing) {
      await db.execute('UPDATE users SET password_hash = ?, invite_token = NULL WHERE lower(email) = lower(?)', [hash, email])
    } else {
      await db.execute(
        `INSERT INTO users (name, email, role, password_hash, invite_token) VALUES (?, ?, 'super_admin', ?, NULL)`,
        ['Super Admin', email, hash]
      )
    }
    console.log(`[server] Super admin synced: ${email}`)
  } catch (err) {
    console.warn('[server] Could not sync super admin:', (err as Error).message)
  }
}
void syncSuperAdmin()

// ── SQL Server data seed ─────────────────────────────────────
async function runStartupSeed() {
  if (process.env.SEED_SQL_ON_START !== 'true') return
  if (getConfiguredDatabaseMode() !== 'sqlserver') return

  // Check if this seed file has already been applied successfully.
  // Default to SKIPPING — only seed if we can positively confirm the flag is absent.
  try {
    const db = await getDbAsync()
    const flag = await db.queryOne<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'seed_completed_version'`)
    const seedFile = 'data-export-v1.sql'
    if (flag?.value === seedFile) {
      console.log(`[server] Seed already applied (${seedFile}) — skipping.`)
      return
    }
    // Flag absent — fall through to seed
  } catch (err) {
    const msg = (err as Error).message ?? ''
    const tableNotFound = /no such table|Invalid object name/i.test(msg)
    if (!tableNotFound) {
      console.warn('[server] Could not check seed flag, skipping seed to be safe:', msg)
      return
    }
  }

  const seedPath = path.join(__dirname, '../../scripts/data-export-v1.sql')
  if (!fs.existsSync(seedPath)) {
    console.log('[server] Seed file not found — skipping seed.')
    return
  }
  try {
    await runSqlServerSeedFile(seedPath)
    try {
      const db = await getDbAsync()
      await db.execute(
        `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        ['seed_completed_version', 'data-export-v1.sql']
      )
      console.log('[server] Seed completion flag saved.')
    } catch {
      console.warn('[server] Could not save seed completion flag.')
    }
    // Sync super admin AFTER seed so the users table is in its final state
    await syncSuperAdmin()
  } catch (err) {
    console.error('[server] Startup seed failed:', (err as Error).message)
  }
}
void runStartupSeed()

async function runNotificationSweep() {
  try {
    await generateDueDateNotifications()
  } catch (err) {
    console.error('[notifications] generateDueDateNotifications failed:', (err as Error).message)
  }
  try {
    await processWorkflowEscalations()
  } catch (err) {
    console.error('[workflows] processWorkflowEscalations failed:', (err as Error).message)
  }
  try {
    await dispatchPendingEmailNotifications()
  } catch (err) {
    console.error('[notifications] dispatchPendingEmailNotifications failed:', (err as Error).message)
  }
}

void runNotificationSweep()
setInterval(() => { void runNotificationSweep() }, NOTIFICATION_SWEEP_INTERVAL_MS)

// ── Swagger ──────────────────────────────────────────────────
setupSwagger(app)

// ── Routes ───────────────────────────────────────────────────
app.use('/api/auth', authRouter)
app.use('/api/users', usersRouter)
app.use('/api/organizations', organizationsRouter)
app.use('/api/categories', categoriesRouter)
app.use('/api/collections', collectionsRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/preferences', preferencesRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/stats', statsRouter)
app.use('/api/my-submissions', mySubmissionsRouter)
app.use('/api/invitations', invitationsRouter)
app.use('/api/locations', locationsRouter)
app.use('/api/gallery-assets', galleryAssetsRouter)
app.use('/api/ticket-templates', ticketTemplatesRouter)
app.use('/api/approvals', approvalsRouter)
app.use('/api/groups', groupsRouter)
app.use('/api/signup-slots', signupSlotsRouter)
app.use('/api', healthRouter)

// Health check for platform probes (non-API path)
app.get('/health', (_req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ── Global error handler: resets Turso connection on stream expiry ──────────
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  resetDbIfStreamError(err)
  const status = typeof (err as { status?: unknown }).status === 'number'
    ? (err as { status: number }).status
    : 500
  const message = err instanceof Error ? err.message : 'Internal server error'
  res.status(status).json({ error: message })
})

// ── Static client (when available) ─────────────────────────
const clientDist = path.join(__dirname, '../public')
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist))
  // SPA fallback — all non-API routes serve index.html
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}`)
  console.log(`[server] Swagger → http://localhost:${PORT}/api-docs`)
})
