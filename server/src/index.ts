import './env'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import path from 'path'
import fs from 'fs'
import { setupDatabase, resetDbIfStreamError } from './database/db'
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
      console.error(`[server] FATAL: required env var "${key}" is not set. Exiting.`)
      process.exit(1)
    }
    console.warn(
      `[server] WARNING: env var "${key}" is not set. Using development fallback secret.`,
    )
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

function runNotificationSweep() {
  try {
    generateDueDateNotifications()
  } catch (err) {
    console.error('[notifications] generateDueDateNotifications failed:', (err as Error).message)
  }
  try {
    processWorkflowEscalations()
  } catch (err) {
    console.error('[workflows] processWorkflowEscalations failed:', (err as Error).message)
  }
  try {
    dispatchPendingEmailNotifications()
  } catch (err) {
    console.error('[notifications] dispatchPendingEmailNotifications failed:', (err as Error).message)
  }
}

runNotificationSweep()
setInterval(runNotificationSweep, NOTIFICATION_SWEEP_INTERVAL_MS)

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
