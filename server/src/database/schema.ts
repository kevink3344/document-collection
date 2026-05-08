import { DatabaseSync } from 'node:sqlite'

export function createSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      email        TEXT    UNIQUE NOT NULL,
      role         TEXT    NOT NULL DEFAULT 'user'
                           CHECK(role IN ('administrator', 'team_manager', 'user')),
      organization TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
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
      logo_url             TEXT,
      instructions         TEXT,
      instructions_doc_url TEXT,
      active_version_id    INTEGER,
      anonymous            INTEGER NOT NULL DEFAULT 0,
      allow_submission_edits INTEGER NOT NULL DEFAULT 0,
      submission_edit_window_hours INTEGER,
      created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
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
      type          TEXT    NOT NULL CHECK(type IN (
                      'short_text','long_text','single_choice','multiple_choice',
                      'attachment','signature','confirmation','custom_table','rating'
                    )),
      label         TEXT    NOT NULL,
      page_number   INTEGER NOT NULL DEFAULT 1,
      required      INTEGER NOT NULL DEFAULT 0,
      options       TEXT,
      display_style TEXT    NOT NULL DEFAULT 'radio',
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS collection_response_values (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      response_id INTEGER NOT NULL REFERENCES collection_responses(id) ON DELETE CASCADE,
      field_id    INTEGER NOT NULL REFERENCES collection_fields(id),
      value       TEXT
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
}

export function seedData(db: DatabaseSync): void {
  const userRow = db.prepare('SELECT COUNT(*) AS n FROM users').get() as unknown as { n: number }

  if (userRow.n === 0) {
    const insertUser = db.prepare(
      'INSERT INTO users (name, email, role) VALUES (?, ?, ?)'
    )

    db.exec('BEGIN')
    try {
      insertUser.run('Jon Rivera',  'jon@datacollectionpro.com',   'administrator')
      insertUser.run('Sarah Chen',  'sarah@datacollectionpro.com', 'team_manager')
      insertUser.run('Mike Torres', 'mike@datacollectionpro.com',  'user')
      db.exec('COMMIT')
      console.log('[db] Seed users inserted')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
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
  const insertCategory = db.prepare(
    'INSERT OR IGNORE INTO categories (name, sort_order) VALUES (?, ?)'
  )

  db.exec('BEGIN')
  try {
    categories.forEach((name, index) => {
      insertCategory.run(name, index)
    })
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

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
}
