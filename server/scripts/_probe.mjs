const base = 'http://localhost:4000'

async function probe(path) {
  try {
    const res = await fetch(base + path)
    const body = await res.text()
    console.log(`[${res.status}] ${path}`)
    if (body) console.log('  body:', body.slice(0, 500))
  } catch (e) {
    console.log(`[ERR] ${path}`, e.message)
  }
}

async function main() {
  await probe('/api/stats/public-summary')
  await probe('/api/auth/organizations')
  // Also probe login-required endpoint with no auth to see the code path
  await probe('/api/stats')
}

main()
