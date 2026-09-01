# Plan: Send a Welcome Email to New Users via SMTP2Go

> **Status:** Planning — decisions locked
> **Goal:** When an admin/super-admin adds a new user, automatically email that user a welcome message through **SMTP2Go**. The **Email Subject** and **Email Body** are configurable in **Settings** so admins can customize the wording without touching code.
> **Scope:** Server (email trigger + settings) and client (Settings UI). Uses the **SMTP2Go REST API** (`POST https://api.smtp2go.com/v3/email/send`) — no `nodemailer`/SMTP required.
>
> **Confirmed decisions:**
> 1. `reset-password` does **NOT** trigger the welcome email.
> 2. Body is **plain text** only (no HTML).
> 3. The Email settings panel is **super-admin only**.
> 4. **New:** a Settings **toggle** enables/disables welcome emails globally. Even if the SMTP2Go API key is configured, when the toggle is OFF no email is sent.

---

## TL;DR

- We send email by calling the **SMTP2Go REST API** directly (`server/src/services/notificationEmail.ts`) — `POST https://api.smtp2go.com/v3/email/send` with the API key in the `X-Smtp2go-Api-Key` header. **No `nodemailer`/SMTP needed.**
- When a user is created in `POST /api/users` (`server/src/routes/users.ts`), after the DB transaction returns the new user's id, we fire a **welcome email**.
- A **master toggle** (`welcome_email_enabled`) controls whether welcome emails are sent at all. Even when the API key is configured, if the toggle is OFF we skip sending.
- The **Email Subject** and **Email Body** live as two new `app_settings` rows (keys `welcome_email_subject` and `welcome_email_body`), editable from a new **Email** panel in Settings.
- The body supports simple placeholders (`{name}`, `{email}`, `{organization}`, `{app_url}`) that get replaced at send time.

---

## How email works today (reuse, don't reinvent)

### `server/src/services/notificationEmail.ts`
```ts
const SMTP2GO_API_URL = 'https://api.smtp2go.com/v3/email/send'

export function isEmailDeliveryConfigured(): boolean {
  return Boolean(process.env.SMTP2GO_API_KEY?.trim() && process.env.SMTP2GO_SENDER?.trim())
}

export async function sendNotificationEmail(payload: {
  to: string
  subject: string
  text: string
}): Promise<void> {
  const apiKey = process.env.SMTP2GO_API_KEY?.trim()
  const sender = process.env.SMTP2GO_SENDER?.trim()
  if (!apiKey || !sender) throw new Error('SMTP2GO is not configured')

  const res = await fetch(SMTP2GO_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Smtp2go-Api-Key': apiKey,
    },
    body: JSON.stringify({
      sender,
      to: [payload.to],
      subject: payload.subject,
      text_body: payload.text, // 'text' → 'text_body'
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`SMTP2Go API error ${res.status}: ${body}`)
  }
}
```

- **`isEmailDeliveryConfigured()`** returns true only when `SMTP2GO_API_KEY` **and** `SMTP2GO_SENDER` are set.
- **`sendNotificationEmail({ to, subject, text })`** is the exact function to reuse. All existing callers (`auth.ts`, `collections.ts`, `users.ts`, `notifications.ts`) stay unchanged — only the transport changes.
- The request maps onto the SMTP2Go JSON API exactly (example verified in Postman):
```json
{
  "sender": "powerautomatesvc@wcpss.net",
  "to": ["key.kevin@gmail.com"],
  "subject": "Hello from Postman!",
  "text_body": "This email was sent via the SMTP2GO API using Postman."
}
```

### `server/.env.example` (replace the SMTP block with the API credentials)
```
# SMTP2Go REST API (welcome + notification emails)
SMTP2GO_API_KEY=
SMTP2GO_SENDER=
```

**Key insight:** No `nodemailer`/SMTP needed. We set:
- `SMTP2GO_API_KEY=<your SMTP2Go API key>` — sent as the `X-Smtp2go-Api-Key` header.
- `SMTP2GO_SENDER=<verified sender, e.g. powerautomatesvc@wcpss.net>` — used as the `sender` field.

Because `isEmailDeliveryConfigured()` is a cheap boolean check, the welcome email path simply says: *if email is configured, send it*. If not, skip silently.

---

## Setting up SMTP2Go credentials (env)

These are **secrets** and must never be committed. Update `server/.env` (local) and the Azure Web App **Application settings** (production). Do **not** put the API key in a new `app_settings` row or in a Settings UI field.

| Env var | Value for SMTP2Go |
|---------|-------------------|
| `SMTP2GO_API_KEY` | your SMTP2Go **API key** |
| `SMTP2GO_SENDER` | a **verified** sender, e.g. `powerautomatesvc@wcpss.net` |

> 💡 The user has an **SMTP2Go API key**. It is sent as the `X-Smtp2go-Api-Key` header on every request. Confirm you have a verified *Sender* (sender/domain) in the SMTP2Go dashboard — `SMTP2GO_SENDER` must match a verified sender or delivery will be rejected.

---

## New settings keys (Enable toggle + Email Subject & Body)

Add three keys to the `ALLOWED_KEYS` set in `server/src/routes/settings.ts`:

```ts
'welcome_email_enabled',
'welcome_email_subject',
'welcome_email_body',
```

They get persisted through the **existing** `GET /api/settings/:key` / `PUT /api/settings/:key` routes — no new route needed. The PUT handler already supports arbitrary string values and upserts into `app_settings`.

### Default values
In `GET /api/settings/:key`, the handler returns a default for keys not yet persisted. Add defaults:
```ts
const defaults: Record<string, string> = {
  login_mode: 'select',
  ticket_activity_enabled: 'true',
  welcome_email_enabled: 'true',
  welcome_email_subject: 'Welcome to Data Collection Pro',
  welcome_email_body: 'Hi {name},\n\nYour account has been created. Your username is {email}.\n\nPlease log in and change your password.\n\nThanks,\nThe Admin Team',
}
```

> **`welcome_email_enabled`** is a string `'true'` / `'false'` (matching how the existing `submission_confirmation_emails` / `ticket_activity_enabled` / `qr_code_enabled` toggles are stored). Default is `'true'` so the feature works out-of-the-box once `SMTP2GO_API_KEY` is configured; an admin can flip it OFF to silence all welcome emails.

### Send gate (toggle AND config)
The welcome email is sent **only** when BOTH conditions hold:
```ts
isEmailDeliveryConfigured() && welcomeEmailEnabled === 'true'
```
Where `welcomeEmailEnabled` is the `welcome_email_enabled` setting (default `'true'`). If either is false, skip silently.

### Placeholders supported in the body
| Placeholder | Substituted value |
|-------------|-------------------|
| `{name}` | New user's name |
| `{email}` | New user's email (log-in username) |
| `{organization}` | The new user's primary organization name (or first membership's org) |
| `{app_url}` | `process.env.APP_URL` (for building login links) |

---

## Sending the welcome email (trigger)

### File: `server/src/routes/users.ts`
Inside the **POST `/`** handler, **after** the `db.transaction(...)` returns `createdUserId` and *before* (or in parallel with) the `res.status(201)` response.

Add a **local** helper (or a small function in `notificationEmail.ts`) that:
1. Reads `welcome_email_enabled`, `welcome_email_subject`, and `welcome_email_body` from `app_settings` (via `db.queryOne`).
2. Bails early if the toggle is OFF.
3. Substitutes placeholders.
4. Calls `sendNotificationEmail({ to, subject, text })`.

```ts
// inside POST '/' after `createdUserId` is obtained
const welcomeEnabled = (await db.queryOne<{ value: string }>(
  "SELECT value FROM app_settings WHERE key = 'welcome_email_enabled'"))?.value ?? 'true'

if (isEmailDeliveryConfigured() && welcomeEnabled === 'true') {
  const subject = (await db.queryOne<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'welcome_email_subject'"))?.value
    ?? 'Welcome to Data Collection Pro'
  const bodyTemplate = (await db.queryOne<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'welcome_email_body'"))?.value
    ?? 'Hi {name},\n\nYour account has been created.'

  const orgName = ... // from the created user's first membership

  void sendNotificationEmail({
    to: email.trim(),
    subject,
    text: bodyTemplate
      .replace(/\{name\}/g, name.trim())
      .replace(/\{email\}/g, email.trim())
      .replace(/\{organization\}/g, orgName ?? '')
      .replace(/\{app_url\}/g, (process.env.APP_URL ?? '').replace(/\/$/, '')),
  }).catch(err => console.error('[users] welcome email failed:', (err as Error).message))
}
```

> ⚠️ **Do not `await` the email** before responding, or a slow outbound HTTP call (especially on the cold-starting SQL Serverless DB) would delay the `201`. Use `void sendNotificationEmail(...)` and log failures so the user-creation response stays fast and reliable. The welcome email is best-effort.

### Behavioral rules (confirmed)
- **Toggle ON and email configured?** Send it. **Toggle OFF** or **not configured?** Skip silently (no error to the admin).
- **Send failure?** Do **not** fail the user creation. Log `console.error` and let the response succeed.
- **New user creation** is the **only** trigger. Editing an existing user (`PATCH /:id`) and `reset-password` do **not** re-send the welcome email.

---

## Settings UI (client)

### File: `client/src/pages/SettingsPage.tsx` + `client/src/api/settings.ts`
Add an **Email** settings panel (or an "Email" tab), super-admin only, with three fields:
- **Enable Welcome Email** — a toggle (checkbox). Mirrors the existing `submission_confirmation_emails` / `qr_code_enabled` toggle pattern (switches `'true'` / `'false'`).
- **Welcome Email Subject** — single-line text input.
- **Welcome Email Body** — a multi-line `<textarea>`.

Optionally disable/grey out the Subject and Body inputs when the toggle is OFF (nice-to-have — helps the admin see the feature is disabled).

Wire to the existing API client functions:
```ts
import { getPublicSetting, updateSetting } from '../api/settings'
```

On load, fetch all three keys via `getPublicSetting('welcome_email_enabled')` / `getPublicSetting('welcome_email_subject')` / `getPublicSetting('welcome_email_body')` (the same pattern used for `notification_reminder_days` around lines 629/660). On save, call `updateSetting(...)`.

Follow the existing panel conventions in `SettingsPage.tsx` — the file already has `updateSetting` calls for `login_message`, `about_message`, `submission_confirmation_emails`, etc., so a new panel slots in with the same state/handler pattern.

---

## Files to change (implementation checklist)

| File | Change |
|------|--------|
| `server/src/routes/settings.ts` | Add `welcome_email_enabled`, `welcome_email_subject`, `welcome_email_body` to `ALLOWED_KEYS`; add defaults in the GET handler. Optionally add to Swagger `enum` lists. |
| `server/src/routes/users.ts` | In POST `/`, after `createdUserId`, fire welcome email with placeholder substitution (guarded by `isEmailDeliveryConfigured()` **AND** `welcome_email_enabled === 'true'`). |
| `server/src/services/notificationEmail.ts` | Rewrite `sendNotificationEmail` to call `POST https://api.smtp2go.com/v3/email/send` with the `X-Smtp2go-Api-Key` header, mapping `text` → `text_body`. Update `isEmailDeliveryConfigured()` to check `SMTP2GO_API_KEY` + `SMTP2GO_SENDER`. (Optional) add a `sendWelcomeEmail({ to, name, email, organization, appUrl })` helper that reads settings + substitutes + calls `sendNotificationEmail`. Keeps `users.ts` clean. `nodemailer` can be removed from server deps. |
| `client/src/pages/SettingsPage.tsx` | Add Email panel / tab (super-admin only); Enable toggle + Subject text input + Body textarea; load + save via existing API client. |
| `client/src/api/settings.ts` | No change required (uses existing `getPublicSetting`/`updateSetting`). |
| `server/.env` / Azure App Settings | Add `SMTP2GO_API_KEY` and `SMTP2GO_SENDER` (never commit secrets). |

---

## Edge cases & notes

- **SQLite/Turso vs SQL Server**: The settings upsert `INSERT ... ON CONFLICT(key) DO UPDATE` is translated by the `MssqlAdapter` (it already handles SQLite UPSERT → SQL Server). No schema change needed.
- **`app_settings` schema**: The `app_settings` table is used for key/value settings (confirmed in `settings.ts`). We only add *rows*, not columns.
- **Cold start of SQL Serverless**: The email is sent via `void` (fire-and-forget), so even a slow outbound HTTP call won't block the `201` response.
- **The API key**: Stored only in `SMTP2GO_API_KEY` env / Azure App Settings. Sent as the `X-Smtp2go-Api-Key` header. Never surfaced in the UI or stored in `app_settings`. No plaintext in git.
- **Default password**: New users are created with `DEFAULT_USER_PASSWORD` and `must_change_password = 1`. The welcome email should mention that the login is their email and that they'll be prompted to change the password.

---

## Review decision points (resolved)

1. **Should `reset-password` also trigger it?** ✅ **No** — confirmed. The welcome email fires only on new-user creation. `auth.ts` already sends its own reset email.
2. **HTML or plain text body?** ✅ **Plain text** — confirmed. `sendNotificationEmail` sends `text` only, mapped to the API's `text_body`; no HTML. (SMTP2Go also supports `html_body` if we ever need rich emails.)
3. **Who can edit the Email settings?** ✅ **Super-admins only** — confirmed. This matches `database_mode` / `document_storage_mode` access, so the Settings UI panel must be gated to `super_admin`.
4. **Should the toggle (re)use the existing toggle pattern?** ✅ Yes — `welcome_email_enabled` is stored as `'true'`/`'false'`, same as `submission_confirmation_emails`. Default `'true'` so it works once `SMTP2GO_API_KEY` is configured. It does **not** replace the SMTP2Go credentials — the toggle only gates *sending*, and is the **last** check before the email is sent.
