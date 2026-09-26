/**
 * Verify the generated script has the three fixes:
 *   1. DROP section drops existing FKs first (cursor)
 *   2. No INSERT exceeds 1000 row-value tuples (error 10738)
 *   3. FK adds are idempotent (IF NOT EXISTS)
 * Run from server/: node scripts/_check-schema-structure.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// NOTE: collection-schema.sql was quarantined on 2026-09-25 (42 DROP TABLE stmts).
  const t = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', '_quarantine_DO_NOT_RUN', 'collection-schema.sql.quarantined'), 'utf-8')

// 1. DROP FK cursor
const hasDropCursor = /DECLARE cur CURSOR FOR/.test(t) && /DROP CONSTRAINT/.test(t)
console.log('DROP section drops existing FKs first:', hasDropCursor)

// 2. Count tuples per INSERT (semicolon-aware, depth-aware)
let maxRows = 0
let maxTable = ''
const chunksByTable = {}
for (let pos = 0; pos < t.length; ) {
  const idx = t.indexOf('INSERT INTO [dbo].[', pos)
  if (idx === -1) break
  const afterBracket = t.slice(idx + 'INSERT INTO [dbo].['.length)
  const closeBracket = afterBracket.indexOf(']')
  const table = afterBracket.slice(1, closeBracket) // strip leading '['
  const valuesPos = t.indexOf('VALUES\n', idx)
  let depth = 0
  let inStr = false
  let tuples = 0
  let pending = false
  let end = valuesPos + 'VALUES\n'.length
  for (let i = end; i < t.length; i++) {
    const c = t[i]
    if (inStr) {
      if (c === "'") { if (t[i + 1] === "'") { i++ } else { inStr = false } }
      continue
    }
    if (c === "'") { inStr = true; continue }
    if (c === '(') { depth++; if (depth === 1) pending = true }
    else if (c === ')') { depth--; if (depth === 0 && pending) { tuples++; pending = false } }
    else if (c === ';' && depth === 0) { end = i; break }
  }
  if (tuples > maxRows) { maxRows = tuples; maxTable = table }
  chunksByTable[table] = (chunksByTable[table] || 0) + 1
  pos = end + 1
}
console.log('Max tuples in a single INSERT:', maxRows, '(table:', maxTable + ')')
console.log('Over 1000:', maxRows > 1000 ? 'FAIL' : 'OK (none exceed 1000)')
const multiChunk = Object.entries(chunksByTable).filter(([k, v]) => v > 1)
console.log('Tables chunked into multiple INSERTs:', multiChunk.length === 0 ? 'none' : multiChunk.map(([k, v]) => `${k}=${v}`).join(', '))

// 3. FK idempotency
const fkAdds = (t.match(/ALTER TABLE \[dbo\]\.[a-zA-Z_]+ WITH CHECK ADD CONSTRAINT \[FK_/g) || []).length
const fkGuards = (t.match(/IF NOT EXISTS \(SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_/g) || []).length
console.log('FK ADD statements:', fkAdds, '| idempotent guards:', fkGuards, '| balanced:', fkAdds === fkGuards ? 'OK' : 'CHECK')

// Count CREATE TABLE + DROP TABLE
const creates = (t.match(/CREATE TABLE \[dbo\]\./g) || []).length
const drops = (t.match(/IF OBJECT_ID\('dbo\.\[.+\]', 'U'\) IS NOT NULL DROP TABLE/g) || []).length
console.log('CREATE TABLE:', creates, '| DROP TABLE:', drops)
