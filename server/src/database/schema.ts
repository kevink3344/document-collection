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
