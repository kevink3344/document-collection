# App Version and Comment on Login Page

**Created:** 2026-07-20
**Author:** Cline

---

## Executive Summary

Add a publicly visible application version and version comment to the login page. The version data will live in the existing `app_settings` table (database-only source of truth), editable from the admin Settings page, and surfaced via the existing `/api/info` endpoint. A pre-commit Git hook will prompt the agent to decide whether to increment the version (major / minor / patch / none) and enter a short comment before the commit is allowed to proceed.

---

## Scope

### Included
- Two new `app_settings` keys: `app_version` (e.g. `1.0.0`) and `version_comment` (free-text release note).
- Backend: return version + comment from `/api/info`.
- Frontend login page: display version and comment below the login form.
- Settings page: new collapsible panel for admins to edit version and comment.
- Database seed: default version/comment values.
- Pre-commit hook: interactive prompt for version bump and comment, then update `app_settings` and stage the change.
- `.clinerules` update: brief agent instruction to honor the pre-commit prompt and to offer major/minor/patch increment choices before pushing.

### Excluded
- Changing the root or workspace `package.json` versions (no package version sync).
- Back-end SQL Server specific migration scripts (uses existing `app_settings` table; inserts defaults via seed only).
- Automated GitHub Actions versioning.
- Historical version changelog / audit trail.

---

## Step-by-Step Implementation Guide

### Phase 1 — Backend: expose version & comment via `/api/info`

**File:** `server/src/routes/health.ts`

1. Import `getDbAsync`.
2. In the `/api/info` handler, query:
   ```sql
   SELECT value FROM app_settings WHERE key = 'app_version'
   ```
   and
   ```sql
   SELECT value FROM app_settings WHERE key = 'version_comment'
   ```
3. Add `version` and `versionComment` fields to the JSON response.
4. Fallback to the current `pkg.version` if `app_version` is not yet set, and empty string if `version_comment` is missing.

> Note: keep `pkg.version` fallback so the login page never breaks while the setting is absent.

### Phase 2 — Database defaults

**File:** `server/src/database/schema.ts`

In `seedData()`, after the existing `app_settings` inserts, add:

```ts
db.prepare(
  `INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`
).run('app_version', '1.0.0')

db.prepare(
  `INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`
).run('version_comment', 'Initial release.')
```

This only affects SQLite/Turso dev mode. For SQL Server production, an admin must enter the values via Settings once; the login page fallback covers the gap.

### Phase 3 — Frontend login page

**File:** `client/src/pages/LoginPage.tsx`

1. Update `appInfo` state type to include `versionComment?: string`.
2. In the `/api/info` fetch, destructure and set both fields.
3. Render the version and comment near the bottom of the right-hand panel (subtle, small text) or inside the left panel under the stats, e.g.:
   ```tsx
   {appInfo?.version && (
     <div className="mt-6 text-[10px] text-[#64748B] dark:text-[#475569]">
       <span className="font-medium">{appInfo.version}</span>
       {appInfo.versionComment && (
         <span className="ml-2">— {appInfo.versionComment}</span>
       )}
     </div>
   )}
   ```

### Phase 4 — Frontend Settings page

**File:** `client/src/pages/SettingsPage.tsx`

1. Add a new panel id `version` to `PanelId`, `PANEL_LABELS`, and `DEFAULT_PANEL_LAYOUT` (place under `other` tab or `general` — recommended `other`).
2. Add component state:
   - `appVersion`, `appVersionDraft`
   - `versionComment`, `versionCommentDraft`
   - loading/saving/error/saved flags
3. In the mount `useEffect`, call:
   ```ts
   getPublicSetting('app_version')
   getPublicSetting('version_comment')
   ```
4. Add a `VersionPanel` component (inside the same file or as a local helper) with two inputs and a Save button.
5. On save, call:
   ```ts
   await updateSetting('app_version', appVersionDraft.trim())
   await updateSetting('version_comment', versionCommentDraft.trim())
   ```
6. Restrict to administrators / super admins (existing auth checks on `updateSetting` already enforce this).

### Phase 5 — Settings route allow-list

**File:** `server/src/routes/settings.ts`

Add `app_version` and `version_comment` to:
- `ALLOWED_KEYS`
- Swagger `enum` arrays for both GET and PUT endpoints.

Add light validation for `app_version` PUT:
- Optional semver-ish regex: `/^\d+\.\d+\.\d+$/`.
- If invalid, return `400` with `"app_version must be in X.Y.Z format"`.
- `version_comment` can be any string (allow empty).

### Phase 6 — Pre-commit hook

Git hooks are currently located at `.git/hooks/` and use the default directory (no custom `core.hooksPath`).

**File:** `.git/hooks/pre-commit` (new executable file)

Create a POSIX shell script:

```sh
#!/bin/sh
# Prompt for version bump and comment, then update app_settings in the local DB.
# This hook runs before every commit.

DB_PATH="${DATABASE_PATH:-server/data.db}"

# Only run when app_settings table exists in the configured SQLite path.
if [ ! -f "$DB_PATH" ]; then
  exit 0
fi

HAS_TABLE=$(sqlite3 "$DB_PATH" "SELECT 1 FROM sqlite_master WHERE type='table' AND name='app_settings' LIMIT 1;")
if [ "$HAS_TABLE" != "1" ]; then
  exit 0
fi

CURRENT=$(sqlite3 "$DB_PATH" "SELECT value FROM app_settings WHERE key='app_version' LIMIT 1;" || echo "1.0.0")
COMMENT=$(sqlite3 "$DB_PATH" "SELECT value FROM app_settings WHERE key='version_comment' LIMIT 1;" || echo "")

echo ""
echo "Current app version: $CURRENT"
echo "Current version comment: $COMMENT"
echo ""

printf "Bump version? [major/minor/patch/none]: "
read BUMP

if [ "$BUMP" = "none" ] || [ -z "$BUMP" ]; then
  echo "Skipping version bump."
  exit 0
fi

if [ "$BUMP" != "major" ] && [ "$BUMP" != "minor" ] && [ "$BUMP" != "patch" ]; then
  echo "Invalid choice: $BUMP. Commit aborted."
  exit 1
fi

printf "Version comment: "
read NEW_COMMENT

# Semver bump
MAJOR=$(echo "$CURRENT" | cut -d. -f1)
MINOR=$(echo "$CURRENT" | cut -d. -f2)
PATCH=$(echo "$CURRENT" | cut -d. -f3)

case "$BUMP" in
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  patch)
    PATCH=$((PATCH + 1))
    ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"

sqlite3 "$DB_PATH" "INSERT INTO app_settings (key, value) VALUES ('app_version', '$NEW_VERSION') ON CONFLICT(key) DO UPDATE SET value=excluded.value;"
sqlite3 "$DB_PATH" "INSERT INTO app_settings (key, value) VALUES ('version_comment', '$NEW_COMMENT') ON CONFLICT(key) DO UPDATE SET value=excluded.value;"

# Stage the DB file so the version change is part of the commit.
git add "$DB_PATH"

echo "Updated app version to $NEW_VERSION ($NEW_COMMENT)"
exit 0
```

**Important:**
- The hook assumes `sqlite3` CLI is installed and available on `PATH`.
- `server/data.db` is currently gitignored; verify whether the dev DB should be committed. If the DB is not committed, the version change will stay local and be overwritten on fresh clones. Alternatives:
  - Commit a small SQLite seed file instead and apply the version during `setupDatabase()`.
  - Use an `.env` or a committed JSON file for version.
  - Keep the prompt but store the result in a committed JSON file rather than the DB.

Because the user requested the value "might be stored in a database," and the chosen option is **database-only**, the plan keeps the DB as the source of truth but documents this caveat. If the dev DB is gitignored, the team should either (a) stop gitignoring the dev DB, or (b) accept that production versions are set manually via Settings.

### Phase 7 — `.clinerules` agent instruction

**File:** `.clinerules`

Append a short instruction block:

```markdown
## Pre-Commit Version Reminder

Before committing code, check whether the change is user-facing. If so, prompt the user:
- "Should I increment the app version? (major / minor / patch / none)"
- "What is the version comment for this release?"

Update `app_version` and `version_comment` in `app_settings` accordingly.
```

---

## Impacted Files

| File | Change |
|------|--------|
| `server/src/routes/health.ts` | Read version/comment from DB; include in `/api/info` response |
| `server/src/database/schema.ts` | Seed default `app_version` and `version_comment` |
| `server/src/routes/settings.ts` | Allow-list and validate new setting keys |
| `client/src/pages/LoginPage.tsx` | Display version + comment |
| `client/src/pages/SettingsPage.tsx` | New admin panel to edit version and comment |
| `.git/hooks/pre-commit` | New hook to prompt for bump + comment |
| `.clinerules` | Agent instruction to prompt before committing |

## New Files

- `.git/hooks/pre-commit`

---

## Rollback / Verification Plan

### Verification
1. Start the dev server (`npm run dev`).
2. Open `/login` and confirm the version/comment appears (fallback `1.0.0` if DB is empty).
3. Log in as admin, open **Settings → Version**, edit version and comment, save.
4. Refresh `/login` and confirm the updated values appear.
5. Run `npm --prefix server run build` and `npm --prefix client run build` to ensure TypeScript compiles.
6. Test the pre-commit hook manually:
   ```sh
   .git/hooks/pre-commit
   ```
   Verify it prompts for bump/comment and updates the DB.

### Rollback
1. Remove `.git/hooks/pre-commit` to disable prompts.
2. Revert the seven impacted files to their pre-change state.
3. Delete or reset `app_version` / `version_comment` rows from `app_settings` if needed.

---

## Open Questions / Notes

- The local dev database (`server/data.db` or `data.db`) is likely gitignored. If the team wants version bumps to survive fresh clones, consider committing a small version JSON file as the source of truth instead, or stop ignoring the dev DB.
- For SQL Server production, admins must set the initial `app_version` and `version_comment` through the Settings UI; the login page will fall back to `package.json` version until they do.
