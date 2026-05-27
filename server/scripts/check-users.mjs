import { createClient } from '@libsql/client';
import * as dotenv from 'dotenv';
dotenv.config({ path: './.env' });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});
const result = await client.execute('SELECT id, name, organization_id, created_at FROM users');
console.log(JSON.stringify(result.rows, null, 2));

// Also check table schema
const schema = await client.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'");
console.log('\nUsers table SQL:');
console.log(schema.rows[0].sql);
client.close();
