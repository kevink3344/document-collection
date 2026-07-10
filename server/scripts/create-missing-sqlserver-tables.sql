-- ============================================================
-- Missing tables for Azure SQL Server
-- Run this in Azure Data Studio or SSMS against your database.
-- All statements are idempotent (IF NOT EXISTS checks).
-- ============================================================

-- ---------------------------------------------------------------
-- FIX: Ensure categories.id has IDENTITY (auto-increment).
-- If the column was created without IDENTITY, recreate the table.
-- ---------------------------------------------------------------
IF EXISTS (
  SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'categories') AND type = 'U'
) AND NOT EXISTS (
  SELECT 1 FROM sys.identity_columns
  WHERE object_id = OBJECT_ID(N'categories') AND name = 'id'
)
BEGIN
  -- Rename existing table, recreate with IDENTITY, copy data, drop old.
  EXEC sp_rename 'categories', 'categories_old';

  CREATE TABLE [dbo].[categories] (
    [id]              INT IDENTITY(1,1) PRIMARY KEY,
    [name]            NVARCHAR(255) NOT NULL,
    [sort_order]      INT NOT NULL DEFAULT 0,
    [organization_id] BIGINT NULL REFERENCES [dbo].[organizations]([id]),
    [created_at]      DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    [updated_at]      DATETIME2 NOT NULL DEFAULT GETUTCDATE()
  );

  SET IDENTITY_INSERT [dbo].[categories] ON;
  INSERT INTO [dbo].[categories] (id, name, sort_order, organization_id, created_at, updated_at)
  SELECT id, name, sort_order, organization_id,
    ISNULL(TRY_CAST(created_at AS DATETIME2), GETUTCDATE()),
    GETUTCDATE()
  FROM [dbo].[categories_old];
  SET IDENTITY_INSERT [dbo].[categories] OFF;

  DROP TABLE [dbo].[categories_old];
END
GO

-- Ensure table exists at all (first-time setup)
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'categories') AND type = 'U')
CREATE TABLE [dbo].[categories] (
  [id]              INT IDENTITY(1,1) PRIMARY KEY,
  [name]            NVARCHAR(255) NOT NULL,
  [sort_order]      INT NOT NULL DEFAULT 0,
  [organization_id] BIGINT NULL REFERENCES [dbo].[organizations]([id]),
  [created_at]      DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
  [updated_at]      DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);
GO

-- ---------------------------------------------------------------
-- FIX: Ensure locations.id has IDENTITY (auto-increment).
-- ---------------------------------------------------------------
IF EXISTS (
  SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'locations') AND type = 'U'
) AND NOT EXISTS (
  SELECT 1 FROM sys.identity_columns
  WHERE object_id = OBJECT_ID(N'locations') AND name = 'id'
)
BEGIN
  -- Drop dependent tables that FK-reference locations so we can swap the table.
  IF OBJECT_ID(N'dbo.user_locations', 'U') IS NOT NULL
    DROP TABLE [dbo].[user_locations];

  EXEC sp_rename 'locations', 'locations_old';

  CREATE TABLE [dbo].[locations] (
    [id]              BIGINT IDENTITY(1,1) PRIMARY KEY,
    [name]            NVARCHAR(255) NOT NULL,
    [organization_id] BIGINT NOT NULL REFERENCES [dbo].[organizations]([id]) ON DELETE CASCADE,
    [created_at]      NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120)),
    CONSTRAINT uq_locations_name_org UNIQUE ([name], [organization_id])
  );

  SET IDENTITY_INSERT [dbo].[locations] ON;
  INSERT INTO [dbo].[locations] (id, name, organization_id, created_at)
  SELECT id, name, organization_id,
    ISNULL(TRY_CAST(created_at AS NVARCHAR(MAX)), CONVERT(NVARCHAR, GETUTCDATE(), 120))
  FROM [dbo].[locations_old];
  SET IDENTITY_INSERT [dbo].[locations] OFF;

  DROP TABLE [dbo].[locations_old];

  -- Recreate user_locations referencing the new locations table.
  CREATE TABLE [dbo].[user_locations] (
    [user_id]     BIGINT NOT NULL REFERENCES [dbo].[users]([id]) ON DELETE CASCADE,
    [location_id] BIGINT NOT NULL REFERENCES [dbo].[locations]([id]) ON DELETE CASCADE,
    CONSTRAINT pk_user_locations PRIMARY KEY ([user_id], [location_id])
  );
END
GO

-- Ensure locations table exists at all (first-time setup)
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'locations') AND type = 'U')
CREATE TABLE [dbo].[locations] (
  [id]              BIGINT IDENTITY(1,1) PRIMARY KEY,
  [name]            NVARCHAR(255) NOT NULL,
  [organization_id] BIGINT NOT NULL REFERENCES [dbo].[organizations]([id]) ON DELETE CASCADE,
  [created_at]      NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120)),
  CONSTRAINT uq_locations_name_org UNIQUE ([name], [organization_id])
);
GO

-- collection_fields (may be missing if migration failed for this table)
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'collection_fields') AND type = 'U')
CREATE TABLE collection_fields (
  id            BIGINT IDENTITY(1,1) PRIMARY KEY,
  collection_id BIGINT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  version_id    BIGINT REFERENCES collection_versions(id) ON DELETE NO ACTION,
  field_key     NVARCHAR(MAX),
  [type]        NVARCHAR(100) NOT NULL,
  label         NVARCHAR(MAX) NOT NULL,
  subtitle      NVARCHAR(MAX),
  page_number   INT NOT NULL DEFAULT 1,
  required      INT NOT NULL DEFAULT 0,
  options       NVARCHAR(MAX),
  display_style NVARCHAR(100) NOT NULL DEFAULT 'radio',
  branch_rules  NVARCHAR(MAX),
  staff_only    INT NOT NULL DEFAULT 0,
  sort_order    INT NOT NULL DEFAULT 0,
  location_filter_enabled INT NOT NULL DEFAULT 0
);
GO


IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'collection_responses') AND type = 'U')
CREATE TABLE collection_responses (
  id                    BIGINT IDENTITY(1,1) PRIMARY KEY,
  collection_id         BIGINT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  collection_version_id BIGINT REFERENCES collection_versions(id) ON DELETE SET NULL,
  respondent_name       NVARCHAR(MAX),
  respondent_email      NVARCHAR(MAX),
  editable_until        NVARCHAR(MAX),
  last_edited_at        NVARCHAR(MAX),
  submitted_at          NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120))
);
GO

-- collection_response_values
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'collection_response_values') AND type = 'U')
CREATE TABLE collection_response_values (
  id                    BIGINT IDENTITY(1,1) PRIMARY KEY,
  response_id           BIGINT NOT NULL REFERENCES collection_responses(id) ON DELETE CASCADE,
  field_id              BIGINT NOT NULL,
  value                 NVARCHAR(MAX),
  staff_updated_by_name NVARCHAR(MAX),
  staff_updated_at      NVARCHAR(MAX)
);
GO

-- response_attachments
IF OBJECT_ID(N'uq_response_attachments_drive_file_id', 'UQ') IS NOT NULL
  ALTER TABLE response_attachments DROP CONSTRAINT uq_response_attachments_drive_file_id;
GO
IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'response_attachments') AND type = 'U')
  DROP TABLE response_attachments;
GO
CREATE TABLE response_attachments (
  id                  BIGINT IDENTITY(1,1) PRIMARY KEY,
  collection_id       BIGINT NOT NULL REFERENCES collections(id) ON DELETE NO ACTION,
  response_id         BIGINT REFERENCES collection_responses(id) ON DELETE NO ACTION,
  field_id            BIGINT NOT NULL,
  uploaded_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  temp_upload_token   NVARCHAR(MAX),
  file_name           NVARCHAR(MAX) NOT NULL,
  mime_type           NVARCHAR(MAX) NOT NULL,
  size_bytes          BIGINT NOT NULL DEFAULT 0,
  drive_file_id       NVARCHAR(500) NOT NULL,
  drive_web_view_url  NVARCHAR(MAX),
  drive_download_url  NVARCHAR(MAX),
  file_data           NVARCHAR(MAX),
  status              NVARCHAR(50) NOT NULL DEFAULT 'uploaded'
                        CHECK(status IN ('uploaded', 'linked', 'deleted')),
  created_at          NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120)),
  deleted_at          NVARCHAR(MAX)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_response_attachments_drive_file_id')
  ALTER TABLE response_attachments ADD CONSTRAINT uq_response_attachments_drive_file_id UNIQUE (drive_file_id);
GO

-- submission_comments
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'submission_comments') AND type = 'U')
CREATE TABLE submission_comments (
  id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  response_id BIGINT NOT NULL REFERENCES collection_responses(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  user_name   NVARCHAR(MAX) NOT NULL,
  body        NVARCHAR(MAX) NOT NULL,
  created_at  NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120))
);
GO

-- ticket_responses
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'ticket_responses') AND type = 'U')
CREATE TABLE ticket_responses (
  id                     BIGINT IDENTITY(1,1) PRIMARY KEY,
  collection_response_id BIGINT NOT NULL REFERENCES collection_responses(id) ON DELETE CASCADE,
  collection_id          BIGINT NOT NULL REFERENCES collections(id) ON DELETE NO ACTION,
  ticket_template_id     BIGINT REFERENCES ticket_templates(id) ON DELETE NO ACTION,
  filled_by              BIGINT REFERENCES users(id) ON DELETE SET NULL,
  filled_at              NVARCHAR(MAX),
  finalized              INT NOT NULL DEFAULT 0,
  finalized_at           NVARCHAR(MAX),
  finalized_by           BIGINT REFERENCES users(id) ON DELETE NO ACTION,
  created_at             NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120)),
  updated_at             NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120))
);
GO

-- ticket_response_values
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'ticket_response_values') AND type = 'U')
CREATE TABLE ticket_response_values (
  id                 BIGINT IDENTITY(1,1) PRIMARY KEY,
  ticket_response_id BIGINT NOT NULL REFERENCES ticket_responses(id) ON DELETE CASCADE,
  ticket_field_id    BIGINT NOT NULL REFERENCES ticket_fields(id) ON DELETE NO ACTION,
  value              NVARCHAR(MAX),
  CONSTRAINT uq_ticket_response_values UNIQUE(ticket_response_id, ticket_field_id)
);
GO

-- ticket_history
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'ticket_history') AND type = 'U')
CREATE TABLE ticket_history (
  id                   BIGINT IDENTITY(1,1) PRIMARY KEY,
  ticket_response_id   BIGINT NOT NULL REFERENCES ticket_responses(id) ON DELETE CASCADE,
  ticket_field_id      BIGINT,
  ticket_field_key     NVARCHAR(MAX),
  field_label_snapshot NVARCHAR(MAX),
  field_type_snapshot  NVARCHAR(MAX),
  event_type           NVARCHAR(50) NOT NULL CHECK(event_type IN ('field_changed','ticket_closed','ticket_reopened')),
  old_value            NVARCHAR(MAX),
  new_value            NVARCHAR(MAX),
  changed_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  changed_by_name      NVARCHAR(MAX),
  changed_at           NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120))
);
GO

-- approval_workflow_instances
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'approval_workflow_instances') AND type = 'U')
CREATE TABLE approval_workflow_instances (
  id                 BIGINT IDENTITY(1,1) PRIMARY KEY,
  collection_id      BIGINT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  response_id        BIGINT NOT NULL REFERENCES collection_responses(id) ON DELETE NO ACTION,
  status             NVARCHAR(50) NOT NULL DEFAULT 'not_started'
                       CHECK(status IN ('not_started','pending','approved','rejected','cancelled','escalated')),
  active_stage_order INT,
  active_stage_name  NVARCHAR(MAX),
  started_at         NVARCHAR(MAX),
  completed_at       NVARCHAR(MAX),
  last_reminder_at   NVARCHAR(MAX),
  last_escalated_at  NVARCHAR(MAX),
  created_at         NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120)),
  updated_at         NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120)),
  CONSTRAINT uq_approval_workflow_instances_response UNIQUE(response_id)
);
GO

-- approval_workflow_stage_instances
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'approval_workflow_stage_instances') AND type = 'U')
CREATE TABLE approval_workflow_stage_instances (
  id                     BIGINT IDENTITY(1,1) PRIMARY KEY,
  workflow_instance_id   BIGINT NOT NULL REFERENCES approval_workflow_instances(id) ON DELETE CASCADE,
  stage_id               NVARCHAR(MAX) NOT NULL,
  stage_name             NVARCHAR(MAX) NOT NULL,
  stage_order            INT NOT NULL,
  approval_mode          NVARCHAR(50) NOT NULL DEFAULT 'all' CHECK(approval_mode IN ('all','any')),
  status                 NVARCHAR(50) NOT NULL DEFAULT 'pending'
                           CHECK(status IN ('pending','approved','rejected','skipped','escalated')),
  conditions_json        NVARCHAR(MAX),
  reminder_after_hours   INT,
  escalation_after_hours INT,
  started_at             NVARCHAR(MAX),
  due_at                 NVARCHAR(MAX),
  reminded_at            NVARCHAR(MAX),
  escalated_at           NVARCHAR(MAX),
  acted_at               NVARCHAR(MAX),
  acted_by               BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action_comment         NVARCHAR(MAX),
  created_at             NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120)),
  updated_at             NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120)),
  CONSTRAINT uq_workflow_stage UNIQUE(workflow_instance_id, stage_order)
);
GO

-- approval_workflow_approver_instances
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'approval_workflow_approver_instances') AND type = 'U')
CREATE TABLE approval_workflow_approver_instances (
  id                BIGINT IDENTITY(1,1) PRIMARY KEY,
  stage_instance_id BIGINT NOT NULL REFERENCES approval_workflow_stage_instances(id) ON DELETE CASCADE,
  assignment_type   NVARCHAR(50) NOT NULL CHECK(assignment_type IN ('user','role')),
  assignment_value  NVARCHAR(MAX) NOT NULL,
  user_id           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  status            NVARCHAR(50) NOT NULL DEFAULT 'pending'
                      CHECK(status IN ('pending','approved','rejected','skipped','escalated')),
  notified_at       NVARCHAR(MAX),
  acted_at          NVARCHAR(MAX),
  acted_by          BIGINT REFERENCES users(id) ON DELETE NO ACTION,
  action_comment    NVARCHAR(MAX),
  created_at        NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120)),
  updated_at        NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120))
);
GO

-- approval_workflow_history
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'approval_workflow_history') AND type = 'U')
CREATE TABLE approval_workflow_history (
  id                   BIGINT IDENTITY(1,1) PRIMARY KEY,
  workflow_instance_id BIGINT NOT NULL REFERENCES approval_workflow_instances(id) ON DELETE CASCADE,
  stage_instance_id    BIGINT REFERENCES approval_workflow_stage_instances(id) ON DELETE NO ACTION,
  approver_instance_id BIGINT REFERENCES approval_workflow_approver_instances(id) ON DELETE NO ACTION,
  event_type           NVARCHAR(100) NOT NULL
                         CHECK(event_type IN ('workflow_started','stage_started','approved','rejected','reminder_sent','escalated','workflow_completed','workflow_cancelled')),
  actor_user_id        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  actor_name           NVARCHAR(MAX),
  message              NVARCHAR(MAX),
  metadata             NVARCHAR(MAX),
  created_at           NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120))
);
GO

-- signup_slots
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'signup_slots') AND type = 'U')
CREATE TABLE signup_slots (
  id            BIGINT IDENTITY(1,1) PRIMARY KEY,
  collection_id BIGINT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  slot_date     NVARCHAR(MAX) NOT NULL,
  start_time    NVARCHAR(MAX) NOT NULL,
  end_time      NVARCHAR(MAX) NOT NULL,
  label         NVARCHAR(MAX) NOT NULL DEFAULT 'Available Slot',
  max_capacity  INT NOT NULL DEFAULT 1,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120))
);
GO

-- signup_registrations
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'signup_registrations') AND type = 'U')
CREATE TABLE signup_registrations (
  id               BIGINT IDENTITY(1,1) PRIMARY KEY,
  slot_id          BIGINT NOT NULL REFERENCES signup_slots(id) ON DELETE CASCADE,
  respondent_name  NVARCHAR(MAX) NOT NULL,
  respondent_email NVARCHAR(MAX) NOT NULL,
  note             NVARCHAR(MAX),
  created_at       NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120))
);
GO

-- notification_events (drop notification_deliveries first — it has a FK dependency)
IF OBJECT_ID(N'uq_notification_deliveries_dedupe_key', 'UQ') IS NOT NULL
  ALTER TABLE notification_deliveries DROP CONSTRAINT uq_notification_deliveries_dedupe_key;
GO
IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'notification_deliveries') AND type = 'U')
  DROP TABLE notification_deliveries;
GO
IF OBJECT_ID(N'uq_notification_events_dedupe_key', 'UQ') IS NOT NULL
  ALTER TABLE notification_events DROP CONSTRAINT uq_notification_events_dedupe_key;
GO
IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'notification_events') AND type = 'U')
  DROP TABLE notification_events;
GO
CREATE TABLE notification_events (
  id              BIGINT IDENTITY(1,1) PRIMARY KEY,
  organization_id BIGINT REFERENCES organizations(id) ON DELETE SET NULL,
  type            NVARCHAR(50) NOT NULL CHECK(type IN ('due_soon','overdue','system')),
  title           NVARCHAR(MAX) NOT NULL,
  message         NVARCHAR(MAX) NOT NULL,
  collection_id   BIGINT REFERENCES collections(id) ON DELETE CASCADE,
  collection_slug NVARCHAR(MAX),
  due_date        NVARCHAR(MAX),
  target_type     NVARCHAR(50) CHECK(target_type IN ('collection','submission','user','organization','system')),
  target_id       BIGINT,
  action_url      NVARCHAR(MAX),
  priority        NVARCHAR(50) NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
  metadata        NVARCHAR(MAX),
  dedupe_key      NVARCHAR(500),
  created_at      NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_notification_events_dedupe_key')
  ALTER TABLE notification_events ADD CONSTRAINT uq_notification_events_dedupe_key UNIQUE (dedupe_key);
GO

-- notification_deliveries
IF OBJECT_ID(N'uq_notification_deliveries_dedupe_key', 'UQ') IS NOT NULL
  ALTER TABLE notification_deliveries DROP CONSTRAINT uq_notification_deliveries_dedupe_key;
GO
IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'notification_deliveries') AND type = 'U')
  DROP TABLE notification_deliveries;
GO
CREATE TABLE notification_deliveries (
  id                BIGINT IDENTITY(1,1) PRIMARY KEY,
  event_id          BIGINT NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  recipient_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  recipient_email   NVARCHAR(MAX),
  channel           NVARCHAR(50) NOT NULL CHECK(channel IN ('in_app','email')),
  recipient_role    NVARCHAR(50) NOT NULL DEFAULT 'primary' CHECK(recipient_role IN ('primary','cc')),
  status            NVARCHAR(50) NOT NULL DEFAULT 'pending'
                      CHECK(status IN ('pending','sent','failed','read','dismissed')),
  sent_at           NVARCHAR(MAX),
  read_at           NVARCHAR(MAX),
  failed_at         NVARCHAR(MAX),
  failure_reason    NVARCHAR(MAX),
  dedupe_key        NVARCHAR(500),
  created_at        NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_notification_deliveries_dedupe_key')
  ALTER TABLE notification_deliveries ADD CONSTRAINT uq_notification_deliveries_dedupe_key UNIQUE (dedupe_key);
GO

-- notification_preferences
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'notification_preferences') AND type = 'U')
CREATE TABLE notification_preferences (
  user_id             BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  in_app_enabled      INT NOT NULL DEFAULT 1,
  email_enabled       INT NOT NULL DEFAULT 0,
  due_soon            INT NOT NULL DEFAULT 1,
  overdue             INT NOT NULL DEFAULT 1,
  collection_updates  INT NOT NULL DEFAULT 1,
  submission_activity INT NOT NULL DEFAULT 1,
  admin_events        INT NOT NULL DEFAULT 1,
  updated_at          NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120))
);
GO

-- notification_email_ccs
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'notification_email_ccs') AND type = 'U')
CREATE TABLE notification_email_ccs (
  id                 BIGINT IDENTITY(1,1) PRIMARY KEY,
  user_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cc_email           NVARCHAR(MAX) NOT NULL,
  notification_types NVARCHAR(MAX),
  is_active          INT NOT NULL DEFAULT 1,
  created_at         NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120)),
  updated_at         NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120))
);
GO

-- user_preferences
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'user_preferences') AND type = 'U')
CREATE TABLE user_preferences (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  [key]      NVARCHAR(500) NOT NULL,
  value      NVARCHAR(MAX) NOT NULL,
  updated_at NVARCHAR(MAX) NOT NULL DEFAULT (CONVERT(NVARCHAR, GETUTCDATE(), 120)),
  CONSTRAINT pk_user_preferences PRIMARY KEY (user_id, [key])
);
GO

PRINT 'All missing tables created successfully.';
