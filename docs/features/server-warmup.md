# Plan: Graceful Server Warmup for Serverless Azure SQL

> **Status:** Implemented — see `server/src/database/db.ts`, `server/src/routes/health.ts`, and `client/src/pages/LoginPage.tsx`
> **Date:** 2026-08-24
> **Author:** Grounded analysis of first-start `ECONNRESET` behavior
> **Goal:** Keep the backend server alive and surface a friendly "warming up" message while a **serverless Azure SQL** database wakes up, instead of crashing on the first failed connection.
> **Reusable:** This pattern is **portable to any app backed by Azure SQL Serverless free-tier** (or any cold-start DB). Only the file/function names differ.

---

## TL;DR

Azure SQL Serverless (free tier) **auto-suspends when idle**. On the first start after a suspension, the database refuses every TDS login handshake with `ECONNRESET` — raw TCP connects fine on port 1433, but the login is reset. This can continue for **several minutes** (4+ in our case) before the instance wakes.

The default boot flow (`await initDb()` → `process.exit(1)` on failure) means the server **crashes on the first cold start** and the whole app is unreachable. This plan fixes that in two parts:

1. **Make `initDb` retry with backoff** instead of failing immediately.
2. **Start the HTTP listener first**, then finish DB-dependent boot steps in the background.
3. **Expose DB readiness** through `/api/health` so the frontend can show a "warming up" banner only while the DB is actually waking.

---

## Problem signature

The key to recognizing this (vs. a firewall or auth problem):

| Signal | Meaning |
|--------|---------|
| TCP connects on `:1433` | Server reachable; **not** a network/firewall block |
| TDS login reset (`ESOCKET` / `ECONNRESET`) | Instance suspended/offline or mid-wake |
| Happens on **first start** after idle | Auto-suspend wakeup |
| Persists beyond a normal retry window | Wake can take minutes |

A normal "slow wake" resolves in seconds; Serverless free-tier can take minutes, so **do not give up after a short retry window.**

---

## Part 1 — Retry `getPool` with backoff

In the DB adapter / connection module, wrap `sql.connect` in a retry loop. Close and null the pool between attempts so `mssql` connects fresh.

**Notes / gotchas:**
- `mssql` has **no `sql.close()`** — only close the pool via `pool.close()`. (Calling `sql.close()` is a TS error.)
- Reset the cached `sqlPool` to `null` after each failure, otherwise the next attempt reuses a dead pool.
- Use a **growing** backoff (e.g. `attempt * 4000ms`) so later attempts leave more room for the DB to wake.

```ts
export const getPool = async (): Promise<sql.ConnectionPool> => {
  if (!sqlPool) {
    const { server, port, database, user, password } = serverConfig.db
    if (!server || !database) throw new Error('DB_MODE is "sqlserver" but DB_SERVER/DB_DATABASE are not configured.')
    const config: sql.config = {
      server, port, database, user, password,
      options: { encrypt: true, trustServerCertificate: false },
      pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
      connectionTimeout: 30000,
      requestTimeout: 30000,
    }
    const maxAttempts = 6
    let lastError: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const pool = await sql.connect(config)
        sqlPool = pool
        console.log('Database: connected to SQL Server')
        return sqlPool
      } catch (err) {
        lastError = err
        console.warn(
          `Database: connection attempt ${attempt}/${maxAttempts} failed: ${(err as Error).message}. ` +
            `${attempt < maxAttempts ? 'Retrying...' : 'Giving up.'}`,
        )
        if (sqlPool) { try { await sqlPool.close() } catch { /* ignore */ } sqlPool = null }
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 4000))
        }
      }
    }
    throw lastError
  }
  return sqlPool
}
```

---

## Part 2 — Listen first, then boot in the background

In the server entry point, **do not `process.exit(1)` on DB init failure.** Instead:

1. Resolve client paths + open the HTTP listener **immediately** (so the port is up and `/api/health` responds).
2. Run DB init (and dependent boot steps) in a `while`/retry loop in the background.

```ts
const initDbWithRetry = async (maxAttempts = 30): Promise<void> => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await initDb()
      return
    } catch (error) {
      console.warn(
        `[server] Database init attempt ${attempt}/${maxAttempts} failed: ${(error as Error).message}. ` +
          (attempt < maxAttempts ? 'Will retry in 10s...' : 'Exhausted retries.'),
      )
      if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, 10000))
    }
  }
}

const startServer = async () => {
  console.log(`Client build root resolved to: ${clientDistPath}`)
  console.log(`Client index found: ${hasClientBuild}`)

  app.listen(serverConfig.serverPort, () => {
    console.log(`TeamSupportPro server listening on port ${serverConfig.serverPort}`)
  })

  await initDbWithRetry()

  try { await runStartupSeed() } catch (error) { console.error('Startup seed failed.', error) }
  try { await ensureBootstrapAdmin() } catch (error) { console.error('Bootstrap admin setup failed.', error) }
}
```

This keeps the server process alive. Any DB-backed route still **fails/timeouts during warmup** (that's expected and is handled by Part 3).

---

## Part 3 — Expose DB readiness and show a "warming up" banner

### Server: report readiness from `/api/health`

Add a module-level readiness flag set when `initDb` succeeds, exposed via a getter:

```ts
// db.ts
let dbReady = false
export const isDbReady = (): boolean => dbReady
```

Set `dbReady = true` at the **end of `initDb`** (every return path — the `sqlserver` early-return AND the general Turso/SQLite path).

```ts
// index.ts
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, dbReady: isDbReady() })
})
```

Now the health endpoint distinguishes three states:
- `{ ok: true, dbReady: true }` — fully ready.
- `{ ok: true, dbReady: false }` — server up, DB still warming (**show the banner**).
- request fails / `ok: false` — server offline.

### Frontend: poll health and render the banner

Add a `backendDbReady` state, read `dbReady` from the health response, and **poll every ~3s** while warming (so the banner disappears automatically once ready).

```ts
const [backendDbReady, setBackendDbReady] = useState<boolean | null>(null)

const checkBackend = async () => {
  try {
    const response = await fetch(apiUrl('/api/health'))
    setBackendAvailable(response.ok)
    if (response.ok) {
      const payload = (await response.json()) as { dbReady?: boolean }
      setBackendDbReady(Boolean(payload.dbReady))
    }
  } catch {
    setBackendAvailable(false)
    setBackendDbReady(false)
  }
}
// Poll while warming up; clear interval on unmount.
const warmup = window.setInterval(checkBackend, 3000)
```

Render a banner on the sign-in / status page **only** when `backendAvailable === true && backendDbReady === false`:

```tsx
{backendAvailable === true && backendDbReady === false && (
  <div className="rounded-[2px] border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">
    <div className="mb-1 flex items-center gap-2 font-semibold">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-500" aria-hidden="true" />
      Application is warming up, please wait...
    </div>
    <div className="whitespace-pre-wrap">
      The database is being woken up. This usually happens on first start and can take a moment.
    </div>
  </div>
)}
```

---

## Behavior matrix

| Health state | UI |
|---|----|
| Server offline (request fails) | Existing "backend auth server is offline" error |
| `ok:true`, `dbReady:false` | **"Application is warming up, please wait..."** banner |
| `ok:true`, `dbReady:true` | Normal sign-in; banner gone |

---

## Verification checklist

1. `tsc --noEmit` passes for server config (`tsconfig.server.json`) and client config (`tsconfig.app.json`).
2. Start the server against a suspended DB → it **listens on the port immediately** and logs `connection attempt N/M failed ... Retrying...`.
3. `GET /api/health` returns `{ "ok": true, "dbReady": false }` during warmup, then flips to `true` once the DB wakes.
4. The sign-in page shows the "warming up" banner while `dbReady:false`, and it **disappears on its own** once ready.
5. Once ready, DB-backed routes (e.g. `/api/public/auth-settings`) succeed instead of timing out.

---

## Related

- Azure SQL Serverless auto-suspend behavior (Microsoft docs)
- `docs/migration/migration_guide.md` — SQL Server deploy path
- `/memories/debugging.md` — recorded Azure SQL Serverless warmup pattern
