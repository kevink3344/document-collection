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
    CREATE TABLE IF NOT EXISTS collections (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      slug                 TEXT    UNIQUE NOT NULL,
      title                TEXT    NOT NULL,
      description          TEXT,
      category             TEXT,
      created_by           INTEGER NOT NULL REFERENCES users(id),
      date_due             TEXT,
      cover_photo_url      TEXT,
      instructions         TEXT,
      instructions_doc_url TEXT,
      anonymous            INTEGER NOT NULL DEFAULT 0,
      created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS collection_fields (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      type          TEXT    NOT NULL CHECK(type IN (
                      'short_text','long_text','single_choice','multiple_choice',
                      'attachment','signature','confirmation','custom_table'
                    )),
      label         TEXT    NOT NULL,
      page_number   INTEGER NOT NULL DEFAULT 1,
      required      INTEGER NOT NULL DEFAULT 0,
      options       TEXT,
      sort_order    INTEGER NOT NULL DEFAULT 0
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS collection_table_columns (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      field_id   INTEGER NOT NULL REFERENCES collection_fields(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      col_type   TEXT    NOT NULL DEFAULT 'text'
                         CHECK(col_type IN ('text','number','date','checkbox')),
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS collection_responses (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id    INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      respondent_name  TEXT,
      respondent_email TEXT,
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
}

export function seedData(db: DatabaseSync): void {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get() as unknown as { n: number }
  if (row.n > 0) return

  const insert = db.prepare(
    'INSERT INTO users (name, email, role) VALUES (?, ?, ?)'
  )

  db.exec('BEGIN')
  try {
    insert.run('Jon Rivera',  'jon@datacollectionpro.com',   'administrator')
    insert.run('Sarah Chen',  'sarah@datacollectionpro.com', 'team_manager')
    insert.run('Mike Torres', 'mike@datacollectionpro.com',  'user')
    db.exec('COMMIT')
    console.log('[db] Seed users inserted')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
