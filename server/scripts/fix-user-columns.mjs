import { createClient } from '@libsql/client';
import * as dotenv from 'dotenv';
dotenv.config({ path: './.env' });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

// For users 1-3: organization_id contains the date, created_at contains the integer
// We need to swap them back
await client.batch([
  {
    sql: `UPDATE users SET organization_id = CAST(created_at AS INTEGER), created_at = organization_id WHERE id IN (1, 2, 3)`,
    args: []
  }
]);

const result = await client.execute('SELECT id, name, organization_id, created_at FROM users');
console.log('After fix:');
console.log(JSON.stringify(result.rows, null, 2));
client.close();
