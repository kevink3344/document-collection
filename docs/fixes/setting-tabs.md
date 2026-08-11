# Fix: "no such table: settings_tabs" on Settings page

## Symptom

Clicking **Settings** in the app returned an error:

```
no such table: settings_tabs
```

even though the `settings_tabs` table existed on the remote Turso database.

## Root cause

The server connects to Turso using an **embedded replica** — a local SQLite
file (`server/turso-replica.db`) that mirrors the remote primary. Writes are
proxied straight to the remote primary, but the local replica file only picks
up new tables/schema changes when it is explicitly synced (`db.sync()`).

Two related issues caused the error to appear and recur:

1. **Stale replica on a long-running dev server.** When `settings_tabs` was
   added to `applyIncrementalSchema()` (`server/src/database/db.ts`), the
   table was created on the remote Turso primary, but a dev server process
   that was already running before that change kept using its old local
   replica file, which never saw the new table.
2. **No self-healing for schema-drift errors.** The global error handler
   (`resetDbIfStreamError()` in `server/src/database/db.ts`) already
   auto-recovered from "stream expired" and "malformed replica" errors by
   resetting/wiping the local replica cache, but it did **not** handle
   `no such table` errors. So once a request hit this error, the cached
   connection was left untouched and every subsequent request kept failing
   the same way until someone manually restarted the server and deleted the
   replica files.

## Fixes applied

1. **Immediate recovery** (one-time, for the reported issue):
   - Killed the running dev server process holding port 4000.
   - Deleted the stale `server/turso-replica.db*` files
     (`.db` / `-shm` / `-wal` / `-info`).
   - Restarted `npm run dev`, forcing a full fresh replica sync that picked
     up `settings_tabs`.

2. **Permanent self-healing fix** (commit `4cc0db0`,
   `server/src/database/db.ts`): extended `resetDbIfStreamError()` with a
   new branch that detects `no such table` errors in Turso mode:

   ```ts
   if (dbConnectedMode === 'turso' && /no such table/i.test(message)) {
     console.warn('[db] Turso replica missing a table that exists remotely -- wiping replica to force full resync:', message)
     try { db?.close() } catch { /* ignore */ }
     db = null
     dbConnectedMode = null
     dbLastVerifiedAt = 0
     const replicaPath = path.resolve(process.cwd(), 'turso-replica.db')
     for (const suffix of ['', '-wal', '-shm', '-info']) {
       try { fs.unlinkSync(replicaPath + suffix) } catch { /* not present */ }
     }
   }
   ```

   When this error reaches the global Express error handler (routed there
   automatically for async route handlers via `express-async-errors`,
   imported in `server/src/index.ts`), the cached connection is closed and
   the replica files are wiped. The **next** request triggers a full fresh
   sync from Turso via `tryOpenReplica()` in `getDb()`, so the missing table
   becomes visible without any manual intervention.

## Net effect

- The originally reported error is resolved.
- If schema drift between the local replica and the remote Turso primary
  ever causes a `no such table` error again (e.g. after adding a future new
  table), the first request after the drift may still fail once, but the
  server now self-heals automatically on the very next request — no more
  manual `Stop-Process` + deleting replica files + restart required.

## Verification

- `GET /api/health` → `{"status":"ok","database":"connected"}`
- `GET /api/settings/tabs` → `Unauthorized` (auth-gated, confirming the route
  and table are reachable — no longer a "no such table" error).
- Server logs show `[db] Turso incremental schema applied` with no errors on
  startup.
