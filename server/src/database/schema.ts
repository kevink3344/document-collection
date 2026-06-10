import type { AppDatabase } from './types'

function tableHasColumn(db: AppDatabase, tableName: string, columnName: string): boolean {
  try {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>
    return columns.some(column => column.name === columnName)
  } catch {
    return false
  }
}

export function createSchema(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      slug        TEXT    UNIQUE,
      description TEXT,
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      email        TEXT    UNIQUE NOT NULL,
      role         TEXT    NOT NULL DEFAULT 'user'
                           CHECK(role IN ('super_admin', 'administrator', 'team_manager', 'reviewer', 'user')),
      organization TEXT,
      organization_id INTEGER REFERENCES organizations(id),
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_organizations (
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      role            TEXT    NOT NULL CHECK(role IN ('administrator', 'team_manager', 'reviewer', 'user')),
      is_default      INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, organization_id)
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS locations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(name, organization_id)
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_locations (
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, location_id)
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      organization_id INTEGER REFERENCES organizations(id),
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(name, organization_id)
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      slug                 TEXT    UNIQUE NOT NULL,
      title                TEXT    NOT NULL,
      status               TEXT    NOT NULL DEFAULT 'draft'
                           CHECK(status IN ('draft', 'published')),
      description          TEXT,
      category             TEXT,
      created_by           INTEGER NOT NULL REFERENCES users(id),
      date_due             TEXT,
      cover_photo_url      TEXT,
      cover_photo_asset_id INTEGER REFERENCES gallery_assets(id) ON DELETE SET NULL,
      logo_url             TEXT,
      instructions         TEXT,
      instructions_doc_url TEXT,
      workflow_definition  TEXT,
      source_template_collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
      organization_id      INTEGER NOT NULL REFERENCES organizations(id),
      active_version_id    INTEGER,
      anonymous            INTEGER NOT NULL DEFAULT 0,
      allow_submission_edits INTEGER NOT NULL DEFAULT 0,
      submission_edit_window_hours INTEGER,
      created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS gallery_assets (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name                  TEXT    NOT NULL,
      alt_text              TEXT,
      tags                  TEXT,
      mime_type             TEXT    NOT NULL,
      size_bytes            INTEGER NOT NULL DEFAULT 0,
      drive_file_id         TEXT    NOT NULL UNIQUE,
      drive_web_view_url    TEXT,
      drive_download_url    TEXT,
      file_data             TEXT,
      created_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS collection_versions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id  INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      status         TEXT    NOT NULL DEFAULT 'draft'
                             CHECK(status IN ('draft', 'published')),
      created_by     INTEGER NOT NULL REFERENCES users(id),
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      published_at   TEXT,
      UNIQUE(collection_id, version_number)
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS collection_fields (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      version_id    INTEGER REFERENCES collection_versions(id) ON DELETE CASCADE,
      field_key     TEXT,
      type          TEXT    NOT NULL CHECK(type IN (
                      'short_text','date','long_text','single_choice','multiple_choice',
                      'document','attachment','signature','confirmation','custom_table','rating','comment','matrix_likert_scale',
                      'location'
                    )),
      label         TEXT    NOT NULL,
      subtitle      TEXT,
      page_number   INTEGER NOT NULL DEFAULT 1,
      required      INTEGER NOT NULL DEFAULT 0,
      options       TEXT,
      display_style TEXT    NOT NULL DEFAULT 'radio',
      branch_rules  TEXT,
      sort_order    INTEGER NOT NULL DEFAULT 0
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS collection_table_columns (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      field_id   INTEGER NOT NULL REFERENCES collection_fields(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      col_type   TEXT    NOT NULL DEFAULT 'text'
                         CHECK(col_type IN ('text','number','date','checkbox','list')),
      list_options TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS collection_responses (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id    INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      collection_version_id INTEGER REFERENCES collection_versions(id) ON DELETE SET NULL,
      respondent_name  TEXT,
      respondent_email TEXT,
      editable_until   TEXT,
      last_edited_at   TEXT,
      submitted_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)

  if (!tableHasColumn(db, 'collections', 'workflow_definition')) {
    db.exec(`ALTER TABLE collections ADD COLUMN workflow_definition TEXT`)
  }

  if (!tableHasColumn(db, 'collection_fields', 'location_filter_enabled')) {
    db.exec(`ALTER TABLE collection_fields ADD COLUMN location_filter_enabled INTEGER NOT NULL DEFAULT 0`)
  }

  if (!tableHasColumn(db, 'collections', 'source_template_collection_id')) {
    db.exec(`ALTER TABLE collections ADD COLUMN source_template_collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL`)
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS collection_response_values (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      response_id             INTEGER NOT NULL REFERENCES collection_responses(id) ON DELETE CASCADE,
      field_id                INTEGER NOT NULL REFERENCES collection_fields(id),
      value                   TEXT,
      staff_updated_by_name   TEXT,
      staff_updated_at        TEXT
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS response_attachments (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id         INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      response_id           INTEGER REFERENCES collection_responses(id) ON DELETE CASCADE,
      field_id              INTEGER NOT NULL REFERENCES collection_fields(id),
      uploaded_by_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      temp_upload_token     TEXT,
      file_name             TEXT    NOT NULL,
      mime_type             TEXT    NOT NULL,
      size_bytes            INTEGER NOT NULL DEFAULT 0,
      drive_file_id         TEXT    NOT NULL UNIQUE,
      drive_web_view_url    TEXT,
      drive_download_url    TEXT,
      status                TEXT    NOT NULL DEFAULT 'uploaded'
                                     CHECK(status IN ('uploaded', 'linked', 'deleted')),
      created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
      deleted_at            TEXT
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      collection_id   INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      collection_slug TEXT    NOT NULL,
      type            TEXT    NOT NULL CHECK(type IN ('due_soon', 'overdue')),
      title           TEXT    NOT NULL,
      message         TEXT    NOT NULL,
      due_date        TEXT    NOT NULL,
      is_read         INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      read_at         TEXT,
      UNIQUE(user_id, collection_id, type, due_date)
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_events (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
      type            TEXT    NOT NULL CHECK(type IN ('due_soon', 'overdue', 'system')),
      title           TEXT    NOT NULL,
      message         TEXT    NOT NULL,
      collection_id   INTEGER REFERENCES collections(id) ON DELETE CASCADE,
      collection_slug TEXT,
      due_date        TEXT,
      target_type     TEXT    CHECK(target_type IN ('collection', 'submission', 'user', 'organization', 'system')),
      target_id       INTEGER,
      action_url      TEXT,
      priority        TEXT    NOT NULL DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high')),
      metadata        TEXT,
      dedupe_key      TEXT    UNIQUE,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id          INTEGER NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
      recipient_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      recipient_email   TEXT,
      channel           TEXT    NOT NULL CHECK(channel IN ('in_app', 'email')),
      recipient_role    TEXT    NOT NULL DEFAULT 'primary' CHECK(recipient_role IN ('primary', 'cc')),
      status            TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed', 'read', 'dismissed')),
      sent_at           TEXT,
      read_at           TEXT,
      failed_at         TEXT,
      failure_reason    TEXT,
      dedupe_key        TEXT    UNIQUE,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id              INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      in_app_enabled       INTEGER NOT NULL DEFAULT 1,
      email_enabled        INTEGER NOT NULL DEFAULT 0,
      due_soon             INTEGER NOT NULL DEFAULT 1,
      overdue              INTEGER NOT NULL DEFAULT 1,
      collection_updates   INTEGER NOT NULL DEFAULT 1,
      submission_activity  INTEGER NOT NULL DEFAULT 1,
      admin_events         INTEGER NOT NULL DEFAULT 1,
      updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_email_ccs (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cc_email           TEXT    NOT NULL,
      notification_types TEXT,
      is_active          INTEGER NOT NULL DEFAULT 1,
      created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, cc_email)
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key        TEXT    NOT NULL,
      value      TEXT    NOT NULL,
      updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, key)
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS submission_comments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      response_id INTEGER NOT NULL REFERENCES collection_responses(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_name   TEXT    NOT NULL,
      body        TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_templates (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
      title           TEXT    NOT NULL,
      description     TEXT,
      created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      is_active       INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS collection_ticket_templates (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id      INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      ticket_template_id INTEGER NOT NULL REFERENCES ticket_templates(id) ON DELETE CASCADE,
      display_order      INTEGER NOT NULL DEFAULT 0,
      is_active          INTEGER NOT NULL DEFAULT 1,
      created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(collection_id, ticket_template_id)
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_fields (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
      ticket_template_id INTEGER REFERENCES ticket_templates(id) ON DELETE CASCADE,
      field_key     TEXT,
      type          TEXT    NOT NULL CHECK(type IN (
                      'short_text','date','long_text','single_choice','multiple_choice',
                      'attachment','signature','confirmation','custom_table','rating','comment','matrix_likert_scale',
                      'location'
                    )),
      label         TEXT    NOT NULL,
      subtitle      TEXT,
      page_number   INTEGER NOT NULL DEFAULT 1,
      required      INTEGER NOT NULL DEFAULT 0,
      options       TEXT,
      display_style TEXT    NOT NULL DEFAULT 'radio',
      sort_order    INTEGER NOT NULL DEFAULT 0
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_table_columns (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_field_id INTEGER NOT NULL REFERENCES ticket_fields(id) ON DELETE CASCADE,
      name            TEXT    NOT NULL,
      col_type        TEXT    NOT NULL DEFAULT 'text'
                               CHECK(col_type IN ('text','number','date','checkbox','list')),
      list_options    TEXT,
      sort_order      INTEGER NOT NULL DEFAULT 0
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_responses (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_response_id INTEGER NOT NULL REFERENCES collection_responses(id) ON DELETE CASCADE,
      collection_id          INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      ticket_template_id     INTEGER REFERENCES ticket_templates(id) ON DELETE CASCADE,
      filled_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
      filled_at              TEXT,
      finalized              INTEGER NOT NULL DEFAULT 0,
      finalized_at           TEXT,
      finalized_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at             TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)

  if (tableHasColumn(db, 'ticket_responses', 'ticket_template_id')) {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_responses_response_template
        ON ticket_responses(collection_response_id, ticket_template_id);
    `)
  }

  if (tableHasColumn(db, 'ticket_fields', 'ticket_template_id')) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ticket_fields_template
        ON ticket_fields(ticket_template_id, sort_order, id);
    `)
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_collection_ticket_templates_collection
      ON collection_ticket_templates(collection_id, display_order, id);
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_collections_source_template
      ON collections(source_template_collection_id);
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_response_values (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_response_id INTEGER NOT NULL REFERENCES ticket_responses(id) ON DELETE CASCADE,
      ticket_field_id    INTEGER NOT NULL REFERENCES ticket_fields(id),
      value              TEXT,
      UNIQUE(ticket_response_id, ticket_field_id)
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_history (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_response_id   INTEGER NOT NULL REFERENCES ticket_responses(id) ON DELETE CASCADE,
      ticket_field_id      INTEGER,
      ticket_field_key     TEXT,
      field_label_snapshot TEXT,
      field_type_snapshot  TEXT,
      event_type           TEXT NOT NULL CHECK(event_type IN ('field_changed', 'ticket_closed', 'ticket_reopened')),
      old_value            TEXT,
      new_value            TEXT,
      changed_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
      changed_by_name      TEXT,
      changed_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_workflow_instances (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id         INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      response_id           INTEGER NOT NULL REFERENCES collection_responses(id) ON DELETE CASCADE,
      status                TEXT    NOT NULL DEFAULT 'not_started'
                                   CHECK(status IN ('not_started', 'pending', 'approved', 'rejected', 'cancelled', 'escalated')),
      active_stage_order    INTEGER,
      active_stage_name     TEXT,
      started_at            TEXT,
      completed_at          TEXT,
      last_reminder_at      TEXT,
      last_escalated_at     TEXT,
      created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at            TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(response_id)
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_workflow_stage_instances (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_instance_id  INTEGER NOT NULL REFERENCES approval_workflow_instances(id) ON DELETE CASCADE,
      stage_id              TEXT    NOT NULL,
      stage_name            TEXT    NOT NULL,
      stage_order           INTEGER NOT NULL,
      approval_mode         TEXT    NOT NULL DEFAULT 'all'
                                   CHECK(approval_mode IN ('all', 'any')),
      status                TEXT    NOT NULL DEFAULT 'pending'
                                   CHECK(status IN ('pending', 'approved', 'rejected', 'skipped', 'escalated')),
      conditions_json       TEXT,
      reminder_after_hours  INTEGER,
      escalation_after_hours INTEGER,
      started_at            TEXT,
      due_at                TEXT,
      reminded_at           TEXT,
      escalated_at          TEXT,
      acted_at              TEXT,
      acted_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action_comment        TEXT,
      created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at            TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(workflow_instance_id, stage_order)
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_workflow_approver_instances (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      stage_instance_id     INTEGER NOT NULL REFERENCES approval_workflow_stage_instances(id) ON DELETE CASCADE,
      assignment_type       TEXT    NOT NULL CHECK(assignment_type IN ('user', 'role')),
      assignment_value      TEXT    NOT NULL,
      user_id               INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status                TEXT    NOT NULL DEFAULT 'pending'
                                   CHECK(status IN ('pending', 'approved', 'rejected', 'skipped', 'escalated')),
      notified_at           TEXT,
      acted_at              TEXT,
      acted_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action_comment        TEXT,
      created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_workflow_history (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_instance_id  INTEGER NOT NULL REFERENCES approval_workflow_instances(id) ON DELETE CASCADE,
      stage_instance_id     INTEGER REFERENCES approval_workflow_stage_instances(id) ON DELETE SET NULL,
      approver_instance_id  INTEGER REFERENCES approval_workflow_approver_instances(id) ON DELETE SET NULL,
      event_type            TEXT    NOT NULL CHECK(event_type IN ('workflow_started', 'stage_started', 'approved', 'rejected', 'reminder_sent', 'escalated', 'workflow_completed', 'workflow_cancelled')),
      actor_user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_name            TEXT,
      message               TEXT,
      metadata              TEXT,
      created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_approval_workflow_instances_response
      ON approval_workflow_instances(response_id);
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_approval_workflow_stage_instances_active
      ON approval_workflow_stage_instances(status, due_at, started_at);
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_approval_workflow_approver_instances_stage
      ON approval_workflow_approver_instances(stage_instance_id, status);
  `)

  // ── Groups & Collection Shares ─────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name            TEXT    NOT NULL,
      description     TEXT,
      created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(organization_id, name)
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS group_members (
      group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (group_id, user_id)
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS collection_shares (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id  INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      share_type     TEXT    NOT NULL CHECK(share_type IN ('user', 'group')),
      share_target_id INTEGER NOT NULL,
      granted_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(collection_id, share_type, share_target_id)
    );
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_collection_shares_collection
      ON collection_shares(collection_id);
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_group_members_user
      ON group_members(user_id);
  `)
}

export function seedData(db: AppDatabase): void {
  db.prepare(
    `INSERT OR IGNORE INTO organizations (name, slug, description)
     VALUES (?, ?, ?)`
  ).run('TSD', 'tsd', 'Default organization')

  const defaultOrganization = db
    .prepare('SELECT id FROM organizations WHERE lower(name) = lower(?)')
    .get('TSD') as unknown as { id: number }

  const userRow = db.prepare('SELECT COUNT(*) AS n FROM users').get() as unknown as { n: number }

  if (userRow.n === 0) {
    const insertUser = db.prepare(
      'INSERT INTO users (name, email, role, organization_id, organization) VALUES (?, ?, ?, ?, ?)'
    )

    db.transaction(() => {
      insertUser.run('Jon Rivera',  'jon@datacollectionpro.com',   'administrator', defaultOrganization.id, 'TSD')
      insertUser.run('Sarah Chen',  'sarah@datacollectionpro.com', 'team_manager', defaultOrganization.id, 'TSD')
      insertUser.run('Alex Kim',    'alex@datacollectionpro.com',  'reviewer', defaultOrganization.id, 'TSD')
      insertUser.run('Mike Torres', 'mike@datacollectionpro.com',  'user', defaultOrganization.id, 'TSD')
    })()
    console.log('[db] Seed users inserted')
  }

  const categories = [
    'General',
    'Budget',
    'Finance',
    'Safety',
    'Security',
    'Health',
    'HR',
    'Operations',
  ]
  const firstOrgId = (db
    .prepare('SELECT MIN(id) AS id FROM organizations')
    .get() as unknown as { id: number | null })?.id ?? null

  const insertCategory = db.prepare(
    'INSERT OR IGNORE INTO categories (name, sort_order, organization_id) VALUES (?, ?, ?)'
  )

  categories.forEach((name, index) => {
    insertCategory.run(name, index, firstOrgId)
  })

  // Seed default app settings
  db.prepare(
    `INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`
  ).run(
    'login_message',
    'Choose an existing user profile or register a new account to enter the data workspace.'
  )

  db.prepare(
    `INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`
  ).run('login_subtitle', 'Enterprise Staff Support')

  db.prepare(
    `INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`
  ).run('notification_reminder_days', '-3')

  db.prepare(
    `INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`
  ).run('notification_late_days', '1')

  db.prepare(
    `INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`
  ).run('submission_confirmation_emails', 'false')

  db.prepare(
    `INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`
  ).run(
    'copy_answers_disclaimer',
    'For privacy your email will not be saved by the system. It will only be used for this purpose.'
  )

  db.prepare(
    `INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`
  ).run('ai_summary_enabled', 'true')
}
