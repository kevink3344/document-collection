import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import { setupDatabase } from './database/db'
import { setupSwagger } from './swagger/swagger'
import authRouter from './routes/auth'
import usersRouter from './routes/users'
import categoriesRouter from './routes/categories'
import collectionsRouter from './routes/collections'
import settingsRouter from './routes/settings'
import notificationsRouter from './routes/notifications'
import { generateDueDateNotifications } from './services/notifications'

const app = express()
const PORT = process.env.PORT ?? 4000
const IS_PROD = process.env.NODE_ENV === 'production'
const NOTIFICATION_SWEEP_INTERVAL_MS = 60 * 60 * 1000

// ── Middleware ───────────────────────────────────────────────
if (!IS_PROD) {
  app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }))
}
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// ── Database ─────────────────────────────────────────────────
setupDatabase()
generateDueDateNotifications()
setInterval(() => {
  generateDueDateNotifications()
}, NOTIFICATION_SWEEP_INTERVAL_MS)

// ── Swagger ──────────────────────────────────────────────────
setupSwagger(app)

// ── Routes ───────────────────────────────────────────────────
app.use('/api/auth', authRouter)
app.use('/api/users', usersRouter)
app.use('/api/categories', categoriesRouter)
app.use('/api/collections', collectionsRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/notifications', notificationsRouter)

// Health checks for API clients and platform probes
const healthHandler = (_req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
}
app.get('/api/health', healthHandler)
app.get('/health', healthHandler)

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
