import { getDb } from '../database/db'
import type { AppDatabase } from '../database/types'

export type NotificationType = 'due_soon' | 'overdue'

interface DbUser {
  id: number
}

interface DbCollectionDue {
  id: number
  slug: string
  title: string
  date_due: string
}

const DAY_MS = 24 * 60 * 60 * 1000

function parseDueDate(raw: string): Date | null {
  const value = raw.trim()
  if (!value) return null

  // Treat date-only values as end of day UTC so reminders aren't triggered too early.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T23:59:59.999Z`)
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function buildMessage(type: NotificationType, title: string, dueDate: string): { title: string; message: string } {
  if (type === 'overdue') {
    return {
      title: 'Collection overdue',
      message: `"${title}" was due on ${dueDate}.`,
    }
  }

  return {
    title: 'Collection due soon',
    message: `"${title}" is due by ${dueDate}.`,
  }
}

function resolveType(
  dueAt: Date,
  now: Date,
  reminderOffsetDays: number,
  lateOffsetDays: number
): NotificationType | null {
  const reminderAt = dueAt.getTime() + reminderOffsetDays * DAY_MS
  const lateAt = dueAt.getTime() + lateOffsetDays * DAY_MS

  if (now.getTime() >= lateAt) return 'overdue'
  if (now.getTime() >= reminderAt) return 'due_soon'
  return null
}

function readSettingInt(db: AppDatabase, key: string, fallback: number): number {
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(key) as unknown as { value: string } | undefined

  if (!row) return fallback
  const value = parseInt(row.value, 10)
  return Number.isFinite(value) ? value : fallback
}

function insertNotification(db: AppDatabase, userId: number, c: DbCollectionDue, type: NotificationType): void {
  const payload = buildMessage(type, c.title, c.date_due)

  db.prepare(
    `INSERT OR IGNORE INTO notifications
      (user_id, collection_id, collection_slug, type, title, message, due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, c.id, c.slug, type, payload.title, payload.message, c.date_due)
}

export function generateDueDateNotifications(dbArg?: AppDatabase): void {
  const db = dbArg ?? getDb()
  const now = new Date()
  const reminderOffsetDays = readSettingInt(db, 'notification_reminder_days', -3)
  const lateOffsetDays = readSettingInt(db, 'notification_late_days', 1)

  const users = db
    .prepare(`SELECT id FROM users WHERE role = 'user'`)
    .all() as unknown as DbUser[]

  if (users.length === 0) return

  const collections = db
    .prepare(
      `SELECT id, slug, title, date_due
       FROM collections
       WHERE status = 'published'
         AND date_due IS NOT NULL
         AND trim(date_due) <> ''`
    )
    .all() as unknown as DbCollectionDue[]

  for (const c of collections) {
    const dueAt = parseDueDate(c.date_due)
    if (!dueAt) continue

    const type = resolveType(dueAt, now, reminderOffsetDays, lateOffsetDays)
    if (!type) continue

    for (const u of users) {
      insertNotification(db, u.id, c, type)
    }
  }
}
