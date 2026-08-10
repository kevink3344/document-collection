# Plan: Default Password & Forced Password Change for New Users

**Date:** 2026-08-10  
**Status:** Draft — awaiting review before implementation  
**Primary files:** `server/src/routes/users.ts`, `server/src/routes/auth.ts`, `client/src/App.tsx`, `server/.env`

---

## Summary

Currently, when an admin creates a user via `POST /api/users` (Settings →
User Accounts), the user is created as a "select-mode" user with **no
password**. These users log in by picking their name from a dropdown —
they never set a password.

The goal is to change this so that newly created users get a **default
password** (from `DEFAULT_USER_PASSWORD` env var) and are **forced to
change it on first login**, just like invited users today.

---

## Current State (what we're changing)

### `POST /api/users` (`server/src/routes/users.ts`, ~line 296)

```ts
const inserted = await tx.execute(
  'INSERT INTO users (name, email, role) VALUES (?, ?, ?)',
  [name.trim(), email.trim(), parsedPayload.systemRole === 'super_admin' ? 'super_admin' : 'user']
)
```

- No `password_hash` set → user is "select-mode" (no password login)
- No `must_change_password` set → defaults to `0`
- No `invite_token` set → defaults to `NULL`

### Login flow for these users

- `POST /api/auth/login` (select-mode) — pick user from dropdown, no password
- `POST /api/auth/login-with-password` (password mode) — rejects them with "This account does not have a password"

---

## Desired State

### `POST /api/users` — updated INSERT

```ts
const defaultPw = process.env.DEFAULT_USER_PASSWORD
if (!defaultPw) {
  throw new HttpError(500, 'DEFAULT_USER_PASSWORD is not set in environment variables')
}
const passwordHash = hashPassword(defaultPw)  // already exported from invitations.ts

const inserted = await tx.execute(
  `INSERT INTO users (name, email, role, password_hash, must_change_password, invite_token)
   VALUES (?, ?, ?, ?, 1, NULL)`,
  [name.trim(), email.trim(), role, passwordHash]
)
```

- `password_hash` = hash of `DEFAULT_USER_PASSWORD`
- `must_change_password = 1` (hardcoded)
- `invite_token = NULL`

### First login experience

1. User logs in with their email + `DEFAULT_USER_PASSWORD`
2. `POST /api/auth/login-with-password` returns `{ token, user: { ..., mustChangePassword: true } }`
3. `App.tsx` renders the `ChangePasswordModal` overlay (already built)
4. User sets a new password → `POST /api/auth/change-password` clears `must_change_password`
5. User proceeds normally

### Existing select-mode users

Users created before this change (no `password_hash`) will **not** be
affected. The `loadUserAccessProfile` function already guards this:

```ts
mustChangePassword: Boolean(user.must_change_password) && !!user.password_hash
```

If a user has no `password_hash`, `mustChangePassword` is `false` even if
the DB column is `1`. They can continue using select-mode login as before.

---

## Implementation Steps

### Step 1: Update `POST /api/users` in `server/src/routes/users.ts`

- Import `hashPassword` from `./invitations` (already exported)
- Read `DEFAULT_USER_PASSWORD` from env; throw 500 if missing
- Add `password_hash` and `must_change_password = 1` to the INSERT
- Set `invite_token = NULL` explicitly
- Update the response message to indicate the user must change password on first login

### Step 2: Update the response body

```ts
res.status(201).json({
  ...toApiUser(created),
  message: 'User created. They can log in with the default password and will be prompted to change it.',
})
```

### Step 3: No client-side changes needed

- `ChangePasswordModal` already exists and works
- `App.tsx` already checks `user.mustChangePassword`
- `AuthContext.clearMustChangePassword` already handles the post-change update
- Login page already supports password login mode

### Step 4: Update `.env` / `.env.example` if needed

- Ensure `DEFAULT_USER_PASSWORD` is documented as required when creating users
- Already used by the invitations flow, so it should already be present

---

## Edge Cases & Considerations

| Scenario | Handling |
|---|---|
| `DEFAULT_USER_PASSWORD` not set | Return HTTP 500 with clear error message |
| Admin creates a super_admin user | Same flow — they get a default password and must change it. Super admins are exempt from the forced-change modal in `App.tsx`, but the password is still set. |
| Existing select-mode user (no password_hash) | Unaffected — `mustChangePassword` resolves to `false` due to the `!!user.password_hash` guard |
| User already exists (re-create) | The existing duplicate-email check returns 409 before we reach the INSERT |
| Admin resets a user's password via `POST /api/users/:id/reset-password` | Already works — sets `must_change_password = 1` and default password |

---

## Files to Modify

| File | Change |
|---|---|
| `server/src/routes/users.ts` | Add `password_hash`, `must_change_password = 1`, `invite_token = NULL` to the INSERT in `POST /` |
| `server/src/routes/users.ts` | Import `hashPassword` from `./invitations` |
| `server/src/routes/users.ts` | Validate `DEFAULT_USER_PASSWORD` is set; throw 500 if missing |

No other files need changes — the forced-change modal, auth context, and login page already support this flow.
