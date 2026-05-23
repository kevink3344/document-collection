import { getDb } from '../database/db'
import type { AppDatabase } from '../database/types'
import { isEmailDeliveryConfigured, sendNotificationEmail } from './notificationEmail'

export type NotificationType = 'due_soon' | 'overdue' | 'system'
export type NotificationPriority = 'low' | 'normal' | 'high'
export type NotificationTargetType = 'collection' | 'submission' | 'user' | 'organization' | 'system'
export type NotificationChannel = 'in_app' | 'email'
export type NotificationRecipientRole = 'primary' | 'cc'
export type NotificationDeliveryStatus = 'pending' | 'sent' | 'failed' | 'read' | 'dismissed'

export interface NotificationPreferences {
  inAppEnabled: boolean
  emailEnabled: boolean
  dueSoon: boolean
  overdue: boolean
  collectionUpdates: boolean
  submissionActivity: boolean
  adminEvents: boolean
}

export interface NotificationEmailCc {
  id: number
  userId: number
  email: string
  notificationTypes: NotificationType[] | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface NotificationEventInput {
  organizationId?: number | null
  type: NotificationType
  title: string
  message: string
  collectionId?: number | null
  collectionSlug?: string | null
  dueDate?: string | null
  targetType?: NotificationTargetType | null
  targetId?: number | null
  actionUrl?: string | null
  priority?: NotificationPriority
  metadata?: Record<string, unknown> | null
  dedupeKey?: string | null
  createdAt?: string
}

export interface NotificationRecipientInput {
  userId?: number | null
  email?: string | null
  channel: NotificationChannel
  role?: NotificationRecipientRole
}

export interface NotificationListItem {
  id: number
  deliveryId: number
  eventId: number
  userId: number | null
  collectionId: number | null
  collectionSlug: string | null
  type: NotificationType
  title: string
  message: string
  dueDate: string | null
  isRead: boolean
  createdAt: string
  readAt: string | null
  actionUrl: string | null
  channel: NotificationChannel
  recipientRole: NotificationRecipientRole
}

interface DbUser {
  id: number
  email: string
  organization_id: number | null
}

interface DbCollectionDue {
  id: number
  slug: string
  title: string
  date_due: string
  organization_id: number
}

interface DbNotificationListRow {
  delivery_id: number
  event_id: number
  recipient_user_id: number | null
  channel: NotificationChannel
  recipient_role: NotificationRecipientRole
  status: NotificationDeliveryStatus
  delivery_created_at: string
  read_at: string | null
  collection_id: number | null
  collection_slug: string | null
  type: NotificationType
  title: string
  message: string
  due_date: string | null
  action_url: string | null
}

interface DbNotificationPreferenceRow {
  in_app_enabled: number
  email_enabled: number
  due_soon: number
  overdue: number
  collection_updates: number
  submission_activity: number
  admin_events: number
}

interface DbNotificationEmailCcRow {
  id: number
  user_id: number
  cc_email: string
  notification_types: string | null
  is_active: number
  created_at: string
  updated_at: string
}

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  inAppEnabled: true,
  emailEnabled: false,
  dueSoon: true,
  overdue: true,
  collectionUpdates: true,
  submissionActivity: true,
  adminEvents: true,
}

const DAY_MS = 24 * 60 * 60 * 1000

function boolFromInt(value: number | null | undefined, fallback = false): boolean {
  if (value === null || value === undefined) return fallback
  return value === 1
}

function parseDueDate(raw: string): Date | null {
  const value = raw.trim()
  if (!value) return null

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
  lateOffsetDays: number,
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

function serializeMetadata(metadata?: Record<string, unknown> | null): string | null {
  if (!metadata) return null
  return JSON.stringify(metadata)
}

function normalizeNotificationTypeList(raw: string | null): NotificationType[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    const types = parsed.filter((value): value is NotificationType => (
      value === 'due_soon' || value === 'overdue' || value === 'system'
    ))
    return types.length > 0 ? types : null
  } catch {
    return null
  }
}

function matchesTypeFilter(filter: NotificationType[] | null, type: NotificationType): boolean {
  return !filter || filter.includes(type)
}

function emailLooksValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function mapPreferencesRow(row?: DbNotificationPreferenceRow): NotificationPreferences {
  if (!row) return { ...DEFAULT_NOTIFICATION_PREFERENCES }

  return {
    inAppEnabled: boolFromInt(row.in_app_enabled, true),
    emailEnabled: boolFromInt(row.email_enabled, false),
    dueSoon: boolFromInt(row.due_soon, true),
    overdue: boolFromInt(row.overdue, true),
    collectionUpdates: boolFromInt(row.collection_updates, true),
    submissionActivity: boolFromInt(row.submission_activity, true),
    adminEvents: boolFromInt(row.admin_events, true),
  }
}

function shouldSendType(preferences: NotificationPreferences, type: NotificationType): boolean {
  switch (type) {
    case 'due_soon':
      return preferences.dueSoon
    case 'overdue':
      return preferences.overdue
    case 'system':
      return preferences.adminEvents
    default:
      return false
  }
}

function toApiEmailCc(row: DbNotificationEmailCcRow): NotificationEmailCc {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.cc_email,
    notificationTypes: normalizeNotificationTypeList(row.notification_types),
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function buildDeliveryDedupeKey(
  eventId: number,
  channel: NotificationChannel,
  role: NotificationRecipientRole,
  userId?: number | null,
  email?: string | null,
): string {
  return `${eventId}:${channel}:${role}:${userId ?? 'anon'}:${email?.trim().toLowerCase() ?? 'none'}`
}

function resolveActionUrl(event: NotificationEventInput): string | null {
  if (event.actionUrl) return event.actionUrl
  if (event.collectionSlug) return `/fill/${event.collectionSlug}`
  if (event.collectionId) return `/collections/${event.collectionId}/edit`
  return null
}

function toApiNotification(row: DbNotificationListRow): NotificationListItem {
  return {
    id: row.delivery_id,
    deliveryId: row.delivery_id,
    eventId: row.event_id,
    userId: row.recipient_user_id,
    collectionId: row.collection_id,
    collectionSlug: row.collection_slug,
    type: row.type,
    title: row.title,
    message: row.message,
    dueDate: row.due_date,
    isRead: row.status === 'read',
    createdAt: row.delivery_created_at,
    readAt: row.read_at,
    actionUrl: row.action_url,
    channel: row.channel,
    recipientRole: row.recipient_role,
  }
}

export function getNotificationPreferences(userId: number, dbArg?: AppDatabase): NotificationPreferences {
  const db = dbArg ?? getDb()
  const row = db
    .prepare(
      `SELECT in_app_enabled, email_enabled, due_soon, overdue, collection_updates,
              submission_activity, admin_events
       FROM notification_preferences
       WHERE user_id = ?`,
    )
    .get(userId) as unknown as DbNotificationPreferenceRow | undefined

  return mapPreferencesRow(row)
}

export function updateNotificationPreferences(
  userId: number,
  updates: Partial<NotificationPreferences>,
  dbArg?: AppDatabase,
): NotificationPreferences {
  const db = dbArg ?? getDb()
  const current = getNotificationPreferences(userId, db)
  const next: NotificationPreferences = { ...current, ...updates }

  db.prepare(
    `INSERT INTO notification_preferences (
       user_id, in_app_enabled, email_enabled, due_soon, overdue,
       collection_updates, submission_activity, admin_events, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       in_app_enabled = excluded.in_app_enabled,
       email_enabled = excluded.email_enabled,
       due_soon = excluded.due_soon,
       overdue = excluded.overdue,
       collection_updates = excluded.collection_updates,
       submission_activity = excluded.submission_activity,
       admin_events = excluded.admin_events,
       updated_at = datetime('now')`,
  ).run(
    userId,
    next.inAppEnabled ? 1 : 0,
    next.emailEnabled ? 1 : 0,
    next.dueSoon ? 1 : 0,
    next.overdue ? 1 : 0,
    next.collectionUpdates ? 1 : 0,
    next.submissionActivity ? 1 : 0,
    next.adminEvents ? 1 : 0,
  )

  return next
}

export function listNotificationEmailCcs(userId: number, dbArg?: AppDatabase): NotificationEmailCc[] {
  const db = dbArg ?? getDb()
  const rows = db
    .prepare(
      `SELECT id, user_id, cc_email, notification_types, is_active, created_at, updated_at
       FROM notification_email_ccs
       WHERE user_id = ?
       ORDER BY updated_at DESC, id DESC`,
    )
    .all(userId) as unknown as DbNotificationEmailCcRow[]

  return rows.map(toApiEmailCc)
}

export function addNotificationEmailCc(
  userId: number,
  email: string,
  notificationTypes: NotificationType[] | null,
  dbArg?: AppDatabase,
): NotificationEmailCc {
  const db = dbArg ?? getDb()
  const normalizedEmail = email.trim().toLowerCase()
  if (!emailLooksValid(normalizedEmail)) {
    throw new Error('A valid email address is required')
  }

  const serializedTypes = notificationTypes && notificationTypes.length > 0
    ? JSON.stringify(notificationTypes)
    : null

  db.prepare(
    `INSERT INTO notification_email_ccs (user_id, cc_email, notification_types, is_active, updated_at)
     VALUES (?, ?, ?, 1, datetime('now'))
     ON CONFLICT(user_id, cc_email) DO UPDATE SET
       notification_types = excluded.notification_types,
       is_active = 1,
       updated_at = datetime('now')`,
  ).run(userId, normalizedEmail, serializedTypes)

  const row = db
    .prepare(
      `SELECT id, user_id, cc_email, notification_types, is_active, created_at, updated_at
       FROM notification_email_ccs
       WHERE user_id = ? AND cc_email = ?`,
    )
    .get(userId, normalizedEmail) as unknown as DbNotificationEmailCcRow

  return toApiEmailCc(row)
}

export function deleteNotificationEmailCc(userId: number, ccId: number, dbArg?: AppDatabase): boolean {
  const db = dbArg ?? getDb()
  const result = db
    .prepare('DELETE FROM notification_email_ccs WHERE id = ? AND user_id = ?')
    .run(ccId, userId)
  return Number(result.changes ?? 0) > 0
}

export function createNotificationEventWithDeliveries(
  event: NotificationEventInput,
  recipients: NotificationRecipientInput[],
  dbArg?: AppDatabase,
): number {
  const db = dbArg ?? getDb()
  if (recipients.length === 0) return 0

  db.exec('BEGIN')
  try {
    let eventId: number | null = null
    if (event.dedupeKey) {
      const existing = db
        .prepare('SELECT id FROM notification_events WHERE dedupe_key = ?')
        .get(event.dedupeKey) as unknown as { id: number } | undefined
      eventId = existing?.id ?? null
    }

    if (!eventId) {
      const inserted = db
        .prepare(
          `INSERT INTO notification_events (
             organization_id, type, title, message, collection_id, collection_slug,
             due_date, target_type, target_id, action_url, priority, metadata,
             dedupe_key, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
        )
        .run(
          event.organizationId ?? null,
          event.type,
          event.title,
          event.message,
          event.collectionId ?? null,
          event.collectionSlug ?? null,
          event.dueDate ?? null,
          event.targetType ?? null,
          event.targetId ?? null,
          resolveActionUrl(event),
          event.priority ?? 'normal',
          serializeMetadata(event.metadata),
          event.dedupeKey ?? null,
          event.createdAt ?? null,
        )
      eventId = Number(inserted.lastInsertRowid)
    }

    for (const recipient of recipients) {
      const role = recipient.role ?? 'primary'
      const normalizedEmail = recipient.email?.trim().toLowerCase() ?? null

      if (recipient.channel === 'in_app' && !recipient.userId) {
        continue
      }
      if (recipient.channel === 'email' && !normalizedEmail) {
        continue
      }

      const dedupeKey = buildDeliveryDedupeKey(eventId, recipient.channel, role, recipient.userId, normalizedEmail)
      const status: NotificationDeliveryStatus = recipient.channel === 'in_app' ? 'sent' : 'pending'
      const sentAt = recipient.channel === 'in_app' ? (event.createdAt ?? new Date().toISOString()) : null

      db.prepare(
        `INSERT OR IGNORE INTO notification_deliveries (
           event_id, recipient_user_id, recipient_email, channel, recipient_role,
           status, sent_at, dedupe_key, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
      ).run(
        eventId,
        recipient.userId ?? null,
        normalizedEmail,
        recipient.channel,
        role,
        status,
        sentAt,
        dedupeKey,
        event.createdAt ?? null,
      )
    }

    db.exec('COMMIT')
    return eventId
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function listInAppNotificationsForUser(
  userId: number,
  organizationId: number | null,
  isAdminUser: boolean,
  limit = 100,
  dbArg?: AppDatabase,
): NotificationListItem[] {
  const db = dbArg ?? getDb()
  const params: Array<number> = [userId]
  const scopeClause = !isAdminUser && organizationId
    ? 'AND (e.organization_id = ? OR e.organization_id IS NULL)'
    : !isAdminUser
      ? 'AND e.organization_id IS NULL'
      : ''

  if (scopeClause.includes('?')) {
    params.push(organizationId!)
  }
  params.push(limit)

  const rows = db
    .prepare(
      `SELECT
         d.id AS delivery_id,
         d.event_id,
         d.recipient_user_id,
         d.channel,
         d.recipient_role,
         d.status,
         d.created_at AS delivery_created_at,
         d.read_at,
         e.collection_id,
         e.collection_slug,
         e.type,
         e.title,
         e.message,
         e.due_date,
         e.action_url
       FROM notification_deliveries d
       JOIN notification_events e ON e.id = d.event_id
       WHERE d.channel = 'in_app'
         AND d.recipient_user_id = ?
         AND d.status != 'dismissed'
         ${scopeClause}
       ORDER BY CASE WHEN d.status = 'read' THEN 1 ELSE 0 END, d.created_at DESC
       LIMIT ?`
    )
    .all(...params) as unknown as DbNotificationListRow[]

  return rows.map(toApiNotification)
}

export function getUnreadInAppNotificationCount(
  userId: number,
  organizationId: number | null,
  isAdminUser: boolean,
  dbArg?: AppDatabase,
): number {
  const db = dbArg ?? getDb()
  const params: Array<number> = [userId]
  const scopeClause = !isAdminUser && organizationId
    ? 'AND (e.organization_id = ? OR e.organization_id IS NULL)'
    : !isAdminUser
      ? 'AND e.organization_id IS NULL'
      : ''

  if (scopeClause.includes('?')) {
    params.push(organizationId!)
  }

  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM notification_deliveries d
       JOIN notification_events e ON e.id = d.event_id
       WHERE d.channel = 'in_app'
         AND d.recipient_user_id = ?
         AND d.status = 'sent'
         ${scopeClause}`
    )
    .get(...params) as unknown as { count: number }

  return row.count
}

export function markInAppNotificationRead(
  deliveryId: number,
  userId: number,
  organizationId: number | null,
  isAdminUser: boolean,
  dbArg?: AppDatabase,
): NotificationListItem | null {
  const db = dbArg ?? getDb()
  const params: Array<number> = [deliveryId, userId]
  const scopeClause = !isAdminUser && organizationId
    ? 'AND (e.organization_id = ? OR e.organization_id IS NULL)'
    : !isAdminUser
      ? 'AND e.organization_id IS NULL'
      : ''

  if (scopeClause.includes('?')) {
    params.push(organizationId!)
  }

  const existing = db
    .prepare(
      `SELECT d.id AS delivery_id
       FROM notification_deliveries d
       JOIN notification_events e ON e.id = d.event_id
       WHERE d.id = ?
         AND d.channel = 'in_app'
         AND d.recipient_user_id = ?
         ${scopeClause}`
    )
    .get(...params) as unknown as { delivery_id: number } | undefined

  if (!existing) {
    return null
  }

  db.prepare(
    `UPDATE notification_deliveries
     SET status = 'read',
         read_at = COALESCE(read_at, datetime('now'))
     WHERE id = ? AND recipient_user_id = ?`
  ).run(deliveryId, userId)

  return listInAppNotificationsForUser(userId, organizationId, isAdminUser, 1000, db)
    .find((item) => item.id === deliveryId) ?? null
}

export function markAllInAppNotificationsRead(
  userId: number,
  organizationId: number | null,
  isAdminUser: boolean,
  dbArg?: AppDatabase,
): number {
  const db = dbArg ?? getDb()
  const params: Array<number> = [userId]
  const scopeClause = !isAdminUser && organizationId
    ? 'AND (e.organization_id = ? OR e.organization_id IS NULL)'
    : !isAdminUser
      ? 'AND e.organization_id IS NULL'
      : ''

  if (scopeClause.includes('?')) {
    params.push(organizationId!)
  }

  const ids = db
    .prepare(
      `SELECT d.id
       FROM notification_deliveries d
       JOIN notification_events e ON e.id = d.event_id
       WHERE d.channel = 'in_app'
         AND d.recipient_user_id = ?
         AND d.status = 'sent'
         ${scopeClause}`
    )
    .all(...params) as Array<{ id: number }>

  if (ids.length === 0) {
    return 0
  }

  const placeholders = ids.map(() => '?').join(',')
  const result = db
    .prepare(
      `UPDATE notification_deliveries
       SET status = 'read',
           read_at = COALESCE(read_at, datetime('now'))
       WHERE id IN (${placeholders})`
    )
    .run(...ids.map((row) => row.id))

  return Number(result.changes ?? 0)
}

export function dispatchPendingEmailNotifications(dbArg?: AppDatabase): void {
  if (!isEmailDeliveryConfigured()) {
    return
  }

  const db = dbArg ?? getDb()
  const rows = db
    .prepare(
      `SELECT d.id, d.recipient_email, d.recipient_role, e.title, e.message, e.action_url
       FROM notification_deliveries d
       JOIN notification_events e ON e.id = d.event_id
       WHERE d.channel = 'email'
         AND d.status = 'pending'
         AND d.recipient_email IS NOT NULL
       ORDER BY d.created_at ASC
       LIMIT 50`
    )
    .all() as Array<{
      id: number
      recipient_email: string
      recipient_role: NotificationRecipientRole
      title: string
      message: string
      action_url: string | null
    }>

  for (const row of rows) {
    try {
      void sendNotificationEmail({
        to: row.recipient_email,
        subject: row.recipient_role === 'cc' ? `[CC] ${row.title}` : row.title,
        text: row.action_url ? `${row.message}\n\nOpen: ${row.action_url}` : row.message,
      })

      db.prepare(
        `UPDATE notification_deliveries
         SET status = 'sent',
             sent_at = datetime('now'),
             failed_at = NULL,
             failure_reason = NULL
         WHERE id = ?`
      ).run(row.id)
    } catch (err) {
      db.prepare(
        `UPDATE notification_deliveries
         SET status = 'failed',
             failed_at = datetime('now'),
             failure_reason = ?
         WHERE id = ?`
      ).run(err instanceof Error ? err.message : 'Email delivery failed', row.id)
    }
  }
}

export function generateDueDateNotifications(dbArg?: AppDatabase): void {
  const db = dbArg ?? getDb()
  const now = new Date()
  const reminderOffsetDays = readSettingInt(db, 'notification_reminder_days', -3)
  const lateOffsetDays = readSettingInt(db, 'notification_late_days', 1)

  const users = db
    .prepare(`SELECT id, email, organization_id FROM users WHERE role = 'user'`)
    .all() as unknown as DbUser[]

  if (users.length === 0) return

  const collections = db
    .prepare(
      `SELECT id, slug, title, date_due, organization_id
       FROM collections
       WHERE status = 'published'
         AND date_due IS NOT NULL
         AND trim(date_due) <> ''`
    )
    .all() as unknown as DbCollectionDue[]

  for (const collection of collections) {
    const dueAt = parseDueDate(collection.date_due)
    if (!dueAt) continue

    const type = resolveType(dueAt, now, reminderOffsetDays, lateOffsetDays)
    if (!type) continue

    for (const user of users) {
      if (!user.organization_id || user.organization_id !== collection.organization_id) {
        continue
      }

      const preferences = getNotificationPreferences(user.id, db)
      if (!shouldSendType(preferences, type)) {
        continue
      }

      const payload = buildMessage(type, collection.title, collection.date_due)
      const recipients: NotificationRecipientInput[] = []

      if (preferences.inAppEnabled) {
        recipients.push({ userId: user.id, channel: 'in_app', role: 'primary' })
      }

      if (preferences.emailEnabled && user.email.trim()) {
        recipients.push({ userId: user.id, email: user.email.trim(), channel: 'email', role: 'primary' })
      }

      const ccRecipients = listNotificationEmailCcs(user.id, db)
        .filter((cc) => cc.isActive && matchesTypeFilter(cc.notificationTypes, type))

      for (const cc of ccRecipients) {
        recipients.push({ email: cc.email, channel: 'email', role: 'cc' })
      }

      createNotificationEventWithDeliveries(
        {
          organizationId: collection.organization_id,
          type,
          title: payload.title,
          message: payload.message,
          collectionId: collection.id,
          collectionSlug: collection.slug,
          dueDate: collection.date_due,
          targetType: 'collection',
          targetId: collection.id,
          actionUrl: `/fill/${collection.slug}`,
          priority: type === 'overdue' ? 'high' : 'normal',
          dedupeKey: `${collection.id}:${type}:${collection.date_due}`,
        },
        recipients,
        db,
      )
    }
  }

  dispatchPendingEmailNotifications(db)
}
