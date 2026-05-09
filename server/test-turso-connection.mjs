import 'dotenv/config'
import { createClient } from '@libsql/client'

async function testConnection() {
  const tursoUrl = process.env.TURSO_DATABASE_URL
  const tursoToken = process.env.TURSO_AUTH_TOKEN

  console.log('Testing Turso connection...')
  console.log('URL:', tursoUrl)
  console.log('Token:', tursoToken ? `***${tursoToken.slice(-10)}` : 'NOT SET')

  if (!tursoUrl || !tursoToken) {
    console.error('❌ Missing credentials in .env file')
    process.exit(1)
  }

  try {
    const client = createClient({ url: tursoUrl, authToken: tursoToken })
    const result = await client.execute('SELECT 1 as test')
    console.log('✅ Connection successful!')
    console.log('Result:', result)
  } catch (err) {
    console.error('❌ Connection failed:')
    console.error('Error:', err.message)
    console.error('Details:', err)
    process.exit(1)
  }
}

testConnection()
