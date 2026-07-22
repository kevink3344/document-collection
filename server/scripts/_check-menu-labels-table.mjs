import Database from 'libsql'

const db = new Database('turso-replica.db')
const r = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='organization_menu_labels'").get()
console.log('local replica table:', r)
const all = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x => x.name)
console.log(all.join(', '))
db.close()
