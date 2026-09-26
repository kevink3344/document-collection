/**
 * Create the missing notification + approval-workflow tables in PRODUCTION
 * (wcpss-data-collection) with EMPTY schemas, matching the sandbox
 * (wcpss-test-db) DDL exactly.
 *
 * Why empty:
 *   - These tables hold transient runtime state (events, deliveries, workflow
 *     stage instances, history). They regenerate naturally as the app runs.
 *   - Copying rows from the sandbox is unsafe: `collections` / `collection_responses`
 *     IDs do NOT align between sandbox and production, so FK inserts would fail.
 *   - Creating empty tables touches ZERO existing rows (no data overwritten).
 *
 * Idempotent: each table is guarded with IF OBJECT_ID(...) IS NULL so it only
 * runs once when missing and never drops/alters existing data.
 *
 * FK-safe creation order (parents before children):
 *   1. notification_events            (FK -> collections, organizations)
 *   2. notification_deliveries        (FK -> notification_events, users)
 *   3. notification_preferences       (FK -> users)
 *   4. notifications                  (FK -> collections, users)
 *   5. notification_email_ccs         (FK -> users)
 *   6. collection_responses           (FK -> collections, locations)
 *      NOTE: collection_version_id column is preserved but its FK to the
 *      (currently absent) `collection_versions` table is omitted so this table
 *      can be created independently.
 *   7. approval_workflow_instances    (FK -> collections, collection_responses)
 *   8. approval_workflow_stage_instances (FK -> approval_workflow_instances, users)
 *   9. approval_workflow_approver_instances (FK -> stage_instances, users)
 *  10. approval_workflow_history      (FK -> instances, stage_instances, approver_instances, users)
 *
 * Usage (run from server/):
 *   node scripts/create-missing-schema-tables.mjs
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

const prodCfg = {
  server: process.env.AZURE_SQL_SERVER,
  database: process.env.AZURE_SQL_DATABASE,
  user: process.env.AZURE_SQL_USER,
  password: process.env.AZURE_SQL_PASSWORD,
  options: { encrypt: true, trustServerCertificate: false },
  pool: { max: 2, min: 0, idleTimeoutMillis: 120000 },
}

const TABLES = [
  {
    name: 'notification_events',
    ddl: `
      CREATE TABLE [dbo].[notification_events] (
        [id]              BIGINT IDENTITY(1,1) PRIMARY KEY,
        [organization_id] BIGINT NULL CONSTRAINT [FK_notification_events_organization_id] FOREIGN KEY REFERENCES [dbo].[organizations]([id]),
        [type]            NVARCHAR(MAX) NOT NULL,
        [title]           NVARCHAR(MAX) NOT NULL,
        [message]         NVARCHAR(MAX) NOT NULL,
        [collection_id]   BIGINT NULL CONSTRAINT [FK_notification_events_collection_id] FOREIGN KEY REFERENCES [dbo].[collections]([id]),
        [collection_slug] NVARCHAR(MAX) NULL,
        [due_date]        NVARCHAR(MAX) NULL,
        [target_type]     NVARCHAR(MAX) NULL,
        [target_id]       BIGINT NULL,
        [action_url]      NVARCHAR(MAX) NULL,
        [priority]        NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_notification_events_priority] DEFAULT 'normal',
        [metadata]        NVARCHAR(MAX) NULL,
        [dedupe_key]      NVARCHAR(MAX) NULL,
        [created_at]      NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_notification_events_created_at] DEFAULT GETDATE()
      )
    `,
  },
  {
    name: 'notification_deliveries',
    ddl: `
      CREATE TABLE [dbo].[notification_deliveries] (
        [id]                BIGINT IDENTITY(1,1) PRIMARY KEY,
        [event_id]          BIGINT NOT NULL CONSTRAINT [FK_notification_deliveries_event_id] FOREIGN KEY REFERENCES [dbo].[notification_events]([id]),
        [recipient_user_id] BIGINT NULL CONSTRAINT [FK_notification_deliveries_recipient_user_id] FOREIGN KEY REFERENCES [dbo].[users]([id]),
        [recipient_email]   NVARCHAR(MAX) NULL,
        [channel]           NVARCHAR(MAX) NOT NULL,
        [recipient_role]    NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_notification_deliveries_recipient_role] DEFAULT 'primary',
        [status]            NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_notification_deliveries_status] DEFAULT 'pending',
        [sent_at]           NVARCHAR(MAX) NULL,
        [read_at]           NVARCHAR(MAX) NULL,
        [failed_at]         NVARCHAR(MAX) NULL,
        [failure_reason]    NVARCHAR(MAX) NULL,
        [dedupe_key]        NVARCHAR(MAX) NULL,
        [created_at]        NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_notification_deliveries_created_at] DEFAULT GETDATE()
      )
    `,
  },
  {
    name: 'notification_preferences',
    ddl: `
      CREATE TABLE [dbo].[notification_preferences] (
        -- user_id is a plain PK/FK, NOT IDENTITY: the app inserts an explicit
        -- user_id (see services/notifications.ts updateNotificationPreferences).
        [user_id]             BIGINT NOT NULL PRIMARY KEY CONSTRAINT [FK_notification_preferences_user_id] FOREIGN KEY REFERENCES [dbo].[users]([id]),
        [in_app_enabled]      BIGINT NOT NULL CONSTRAINT [DF_notification_preferences_in_app] DEFAULT 1,
        [email_enabled]       BIGINT NOT NULL CONSTRAINT [DF_notification_preferences_email] DEFAULT 0,
        [due_soon]            BIGINT NOT NULL CONSTRAINT [DF_notification_preferences_due_soon] DEFAULT 1,
        [overdue]             BIGINT NOT NULL CONSTRAINT [DF_notification_preferences_overdue] DEFAULT 1,
        [collection_updates]  BIGINT NOT NULL CONSTRAINT [DF_notification_preferences_collection_updates] DEFAULT 1,
        [submission_activity] BIGINT NOT NULL CONSTRAINT [DF_notification_preferences_submission_activity] DEFAULT 1,
        [admin_events]        BIGINT NOT NULL CONSTRAINT [DF_notification_preferences_admin_events] DEFAULT 1,
        [updated_at]          NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_notification_preferences_updated_at] DEFAULT GETDATE()
      )
    `,
  },
  {
    name: 'notifications',
    ddl: `
      CREATE TABLE [dbo].[notifications] (
        [id]              BIGINT IDENTITY(1,1) PRIMARY KEY,
        [user_id]         BIGINT NOT NULL CONSTRAINT [FK_notifications_user_id] FOREIGN KEY REFERENCES [dbo].[users]([id]),
        [collection_id]   BIGINT NOT NULL CONSTRAINT [FK_notifications_collection_id] FOREIGN KEY REFERENCES [dbo].[collections]([id]),
        [collection_slug] NVARCHAR(MAX) NOT NULL,
        [type]            NVARCHAR(MAX) NOT NULL,
        [title]           NVARCHAR(MAX) NOT NULL,
        [message]         NVARCHAR(MAX) NOT NULL,
        [due_date]        NVARCHAR(MAX) NOT NULL,
        [is_read]         BIGINT NOT NULL CONSTRAINT [DF_notifications_is_read] DEFAULT 0,
        [created_at]      NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_notifications_created_at] DEFAULT GETDATE(),
        [read_at]         NVARCHAR(MAX) NULL
      )
    `,
  },
  {
    name: 'notification_email_ccs',
    ddl: `
      CREATE TABLE [dbo].[notification_email_ccs] (
        [id]                 BIGINT IDENTITY(1,1) PRIMARY KEY,
        [user_id]            BIGINT NOT NULL CONSTRAINT [FK_notification_email_ccs_user_id] FOREIGN KEY REFERENCES [dbo].[users]([id]),
        [cc_email]           NVARCHAR(MAX) NOT NULL,
        [notification_types] NVARCHAR(MAX) NULL,
        [is_active]          BIGINT NOT NULL CONSTRAINT [DF_notification_email_ccs_is_active] DEFAULT 1,
        [created_at]         NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_notification_email_ccs_created_at] DEFAULT GETDATE(),
        [updated_at]         NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_notification_email_ccs_updated_at] DEFAULT GETDATE()
      )
    `,
  },
  {
    name: 'collection_responses',
    ddl: `
      CREATE TABLE [dbo].[collection_responses] (
        [id]                   BIGINT IDENTITY(1,1) PRIMARY KEY,
        [collection_id]        BIGINT NOT NULL CONSTRAINT [FK_collection_responses_collection_id] FOREIGN KEY REFERENCES [dbo].[collections]([id]),
        [collection_version_id] BIGINT NULL,
        [respondent_name]      NVARCHAR(MAX) NULL,
        [respondent_email]     NVARCHAR(MAX) NULL,
        [editable_until]       NVARCHAR(MAX) NULL,
        [last_edited_at]       NVARCHAR(MAX) NULL,
        [submitted_at]         NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_collection_responses_submitted_at] DEFAULT GETDATE(),
        [location_id]          BIGINT NULL CONSTRAINT [FK_collection_responses_location_id] FOREIGN KEY REFERENCES [dbo].[locations]([id])
      )
    `,
  },
  {
    name: 'approval_workflow_instances',
    ddl: `
      CREATE TABLE [dbo].[approval_workflow_instances] (
        [id]                  BIGINT IDENTITY(1,1) PRIMARY KEY,
        [collection_id]       BIGINT NOT NULL CONSTRAINT [FK_approval_workflow_instances_collection_id] FOREIGN KEY REFERENCES [dbo].[collections]([id]),
        [response_id]         BIGINT NOT NULL CONSTRAINT [FK_approval_workflow_instances_response_id] FOREIGN KEY REFERENCES [dbo].[collection_responses]([id]),
        [status]              NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_approval_workflow_instances_status] DEFAULT 'not_started',
        [active_stage_order]  BIGINT NULL,
        [active_stage_name]   NVARCHAR(MAX) NULL,
        [started_at]          NVARCHAR(MAX) NULL,
        [completed_at]        NVARCHAR(MAX) NULL,
        [last_reminder_at]    NVARCHAR(MAX) NULL,
        [last_escalated_at]   NVARCHAR(MAX) NULL,
        [created_at]          NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_approval_workflow_instances_created_at] DEFAULT GETDATE(),
        [updated_at]          NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_approval_workflow_instances_updated_at] DEFAULT GETDATE()
      )
    `,
  },
  {
    name: 'approval_workflow_stage_instances',
    ddl: `
      CREATE TABLE [dbo].[approval_workflow_stage_instances] (
        [id]                    BIGINT IDENTITY(1,1) PRIMARY KEY,
        [workflow_instance_id]  BIGINT NOT NULL CONSTRAINT [FK_approval_workflow_stage_instances_workflow_instance_id] FOREIGN KEY REFERENCES [dbo].[approval_workflow_instances]([id]),
        [stage_id]              NVARCHAR(MAX) NOT NULL,
        [stage_name]            NVARCHAR(MAX) NOT NULL,
        [stage_order]           BIGINT NOT NULL,
        [approval_mode]         NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_approval_workflow_stage_instances_approval_mode] DEFAULT 'all',
        [status]                NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_approval_workflow_stage_instances_status] DEFAULT 'pending',
        [conditions_json]       NVARCHAR(MAX) NULL,
        [reminder_after_hours]  BIGINT NULL,
        [escalation_after_hours] BIGINT NULL,
        [started_at]            NVARCHAR(MAX) NULL,
        [due_at]                NVARCHAR(MAX) NULL,
        [reminded_at]           NVARCHAR(MAX) NULL,
        [escalated_at]          NVARCHAR(MAX) NULL,
        [acted_at]              NVARCHAR(MAX) NULL,
        [acted_by]              BIGINT NULL CONSTRAINT [FK_approval_workflow_stage_instances_acted_by] FOREIGN KEY REFERENCES [dbo].[users]([id]),
        [action_comment]        NVARCHAR(MAX) NULL,
        [created_at]            NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_approval_workflow_stage_instances_created_at] DEFAULT GETDATE(),
        [updated_at]            NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_approval_workflow_stage_instances_updated_at] DEFAULT GETDATE()
      )
    `,
  },
  {
    name: 'approval_workflow_approver_instances',
    ddl: `
      CREATE TABLE [dbo].[approval_workflow_approver_instances] (
        [id]                BIGINT IDENTITY(1,1) PRIMARY KEY,
        [stage_instance_id] BIGINT NOT NULL CONSTRAINT [FK_approval_workflow_approver_instances_stage_instance_id] FOREIGN KEY REFERENCES [dbo].[approval_workflow_stage_instances]([id]),
        [assignment_type]   NVARCHAR(MAX) NOT NULL,
        [assignment_value]  NVARCHAR(MAX) NOT NULL,
        [user_id]           BIGINT NULL CONSTRAINT [FK_approval_workflow_approver_instances_user_id] FOREIGN KEY REFERENCES [dbo].[users]([id]),
        [status]            NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_approval_workflow_approver_instances_status] DEFAULT 'pending',
        [notified_at]       NVARCHAR(MAX) NULL,
        [acted_at]          NVARCHAR(MAX) NULL,
        [acted_by]          BIGINT NULL CONSTRAINT [FK_approval_workflow_approver_instances_acted_by] FOREIGN KEY REFERENCES [dbo].[users]([id]),
        [action_comment]    NVARCHAR(MAX) NULL,
        [created_at]        NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_approval_workflow_approver_instances_created_at] DEFAULT GETDATE(),
        [updated_at]        NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_approval_workflow_approver_instances_updated_at] DEFAULT GETDATE()
      )
    `,
  },
  {
    name: 'approval_workflow_history',
    ddl: `
      CREATE TABLE [dbo].[approval_workflow_history] (
        [id]                   BIGINT IDENTITY(1,1) PRIMARY KEY,
        [workflow_instance_id] BIGINT NOT NULL CONSTRAINT [FK_approval_workflow_history_workflow_instance_id] FOREIGN KEY REFERENCES [dbo].[approval_workflow_instances]([id]),
        [stage_instance_id]    BIGINT NULL CONSTRAINT [FK_approval_workflow_history_stage_instance_id] FOREIGN KEY REFERENCES [dbo].[approval_workflow_stage_instances]([id]),
        [approver_instance_id] BIGINT NULL CONSTRAINT [FK_approval_workflow_history_approver_instance_id] FOREIGN KEY REFERENCES [dbo].[approval_workflow_approver_instances]([id]),
        [event_type]           NVARCHAR(MAX) NOT NULL,
        [actor_user_id]        BIGINT NULL CONSTRAINT [FK_approval_workflow_history_actor_user_id] FOREIGN KEY REFERENCES [dbo].[users]([id]),
        [actor_name]           NVARCHAR(MAX) NULL,
        [message]              NVARCHAR(MAX) NULL,
        [metadata]             NVARCHAR(MAX) NULL,
        [created_at]           NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_approval_workflow_history_created_at] DEFAULT GETDATE()
      )
    `,
  },
]

const pool = await new sql.ConnectionPool(prodCfg).connect()
try {
  console.log('Target:', pool.config.database, '@', pool.config.server)
  let created = 0
  let skipped = 0
  for (const table of TABLES) {
    const exists = await pool.request()
      .input('name', sql.NVarChar(255), table.name)
      .query('SELECT 1 AS x FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=\'dbo\' AND TABLE_NAME=@name')
    if (exists.recordset.length) {
      console.log(`  SKIP  ${table.name} (already exists)`)
      skipped += 1
      continue
    }
    // Null out the constraint name on the placeholder? No — ddl is a complete
    // CREATE TABLE statement. Run directly.
    await pool.request().query(table.ddl)
    created += 1
    console.log(`  OK    ${table.name} created`)
  }
  console.log(`\nDone. Created ${created}, skipped ${skipped}.`)
} catch (err) {
  console.error('Failed:', err?.message ?? err)
  const detail = err?.['number'] ? ` (SQL error ${err['number']})` : ''
  console.error('SQL detail:', detail, err?.message)
  process.exitCode = 1
} finally {
  await pool.close()
}
