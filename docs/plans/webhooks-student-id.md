# Webhooks — "Student ID" Field Validation + Submission Forwarding

**Date:** 2026-10-20
**Status:** Approved — Ready for Implementation
**Decisions:** All 6 open questions resolved 2026-10-20 (see [Resolved Decisions](#resolved-decisions))
**Related:** [organizing-settings.md](./organizing-settings.md), [hidden-id.md](../features/hidden-id.md), [location-sharing.md](../features/location-sharing.md)

---

## Executive Summary

Add a first-class **webhook** capability to the platform, used in two places:

1. **`webhook-1` (validation)** — a new collection field type, **Student ID**, validates its value against an admin-defined HTTP endpoint on **blur**. `true` → the field is considered valid and the form submits normally. `false` → an inline error is shown ("Please enter a valid student id") and submission is blocked until the value is corrected.
2. **`webhook-2` (submission forwarding)** — when a response is submitted, the server POSTs the full submission (respondent + labelled field values) to an admin-defined endpoint. Delivery is best-effort, logged, and **never** blocks or fails the user's submission.

Admins configure both endpoints from a new **Webhooks** panel on the Settings page (Super Admin / Administrator only). Webhooks are **organization-scoped**, matching the existing `locations` / `categories` model, so each organization can point at its own systems.

---

## Scope

### Included

- New `webhooks` table (organization-scoped, keyed by `webhook-1` / `webhook-2`).
- New **Student ID** field type, implemented as `type = 'short_text'` + `display_style = 'student_id'` — **no `collection_fields` rebuild** (see Step 2).
- The field-to-webhook binding is stored in the webhook's own table, so `collection_fields` is never altered.
- Admin **Webhooks** settings panel: list, create/edit, enable/disable, delete, and **Test** each webhook.
- Public validation endpoint `POST /api/collections/public/:slug/validate-field` — the server proxies the outbound call so URL + secret never reach the browser and CORS is never an issue.
- Client-side on-blur validation in `CollectionFillPage`, with inline error text and submit-time gate.
- Server-side re-validation of Student ID fields at submission time (defence in depth).
- Submission forwarding hook in `POST /api/collections/public/:slug/responses` with delivery logging.
- Admin UI to attach a webhook to a Student ID field in the Collection Builder.
- Documentation in `docs/APPLICATION_GUIDE.md`.

### Excluded

- Retries / dead-letter queue for `webhook-2` (logged as failed; manual resend is a future improvement).
- Inbound webhooks (external systems calling us) and signing of *outbound* payloads beyond an optional shared secret header.
- Per-collection or per-field webhook-2 overrides (one submission webhook per organization for v1).
- Webhook support in Signup Sheet forms.
- Editing an existing submission re-triggering `webhook-2` (fires on **create** only — see Resolved Decisions #1).

---

## Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Server proxies both calls.** The browser never calls the admin's URL directly. | Avoids CORS failures, keeps URLs/secrets out of the client, and lets us enforce timeouts + logging. |
| D2 | Validation is **advisory on the client, authoritative on the server.** | The on-blur check gives instant feedback; the submit-time check prevents a crafted payload from bypassing it. |
| D3 | "Valid" is parsed using an **admin-configurable response shape** (`json_boolean` / `json_string` / `plain_text`) plus a configurable key, defaulting to `{ "valid": true }`. | The endpoint's contract may change — including switching from a boolean to a string — so the shape is stored data, not code. No redeploy to adapt. |
| D4 | `webhook-2` is **fire-and-forget** after the response is committed. | A slow/broken webhook must never make the form appear to fail. |
| D5 | Webhooks are **organization-scoped**, and there is exactly **one `webhook-1` and one `webhook-2` per organization**. | Matches `locations`/`categories`; the `UNIQUE(organization_id, key)` constraint enforces one-per-org at the database level. |
| D6 | Validation checks are **skipped in preview mode**. | The builder's test mode should not hit live systems. |
| D7 | Field-level binding is **optional**, and **one webhook-1 per form**. | A Student ID field with no webhook bound behaves like a plain short-text field (useful while an admin is still wiring things up). If a form has more than one Student ID field, the builder binds the same `webhook-1` to all of them — the binding is stored per field, but the UI enforces one selection per form. |
| D8 | **No `collection_fields` rebuild.** Student ID is `type='short_text'` + `display_style='student_id'`; the binding lives in a new `webhook_field_bindings` table. | The repo already rebuilds this table three times; a fourth rename/copy/drop with live FKs is the riskiest change in the plan. This approach touches **zero existing tables and zero existing rows**. |

### Webhook-1 (validation) contract

**We send** — `POST <url>` with `Content-Type: application/json`:

```json
{
  "value": "A12345678",
  "fieldKey": "field-42",
  "fieldLabel": "Student Id",
  "collectionSlug": "enrollment-form",
  "organizationId": 1
}
```

The `X-Webhook-Secret` header is **optional** — it is sent only when a secret is configured on the webhook, and omitted entirely otherwise. This keeps the integration drop-in compatible with endpoints that don't check headers (e.g. a Power Automate "When an HTTP request is received" trigger, which authenticates via its own signature-bearing URL).

**We expect** — HTTP 2xx and a body that **you configure**, not one we hard-code. Each webhook stores a *response shape*:

| Shape | Meaning | Example body |
|-------|---------|--------------|
| `json_boolean` *(default)* | A boolean under a configurable key | `{ "valid": true }` |
| `json_string` | A string under a configurable key, parsed as a boolean | `{ "valid": "true" }` |
| `plain_text` | The whole body is the literal string | `true` / `false` |

The **key** is admin-editable (default `valid`) so you can point at `isValid`, `result`, `status`, etc. without a code change. If the shape later needs to change — or your endpoint starts returning a string instead of a boolean — you edit it in Settings → Webhooks; **no redeploy required**.

**Accepted truthy/falsy values** (case-insensitive, trimmed):

- Truthy: `true`, `"true"`, `1`, `"1"`, `"yes"`, `"y"`, `"valid"`
- Falsy: `false`, `"false"`, `0`, `"0"`, `"no"`, `"n"`, `"invalid"`
- Anything else → treated as **invalid**, with the raw body stored in the delivery log so you can see exactly what came back.

A non-2xx response, timeout, or unparseable body is treated as a failed validation — with one exception: a **network/timeout error** shows a distinct "could not verify" message (see UX below) so a broken webhook isn't silently blamed on the student.

### Webhook-2 (submission) contract

**We send** — `POST <url>` with `Content-Type: application/json`:

```json
{
  "event": "submission.created",
  "responseId": 1234,
  "collectionId": 12,
  "collectionSlug": "enrollment-form",
  "collectionTitle": "Fall Enrollment",
  "collectionVersionId": 34,
  "organizationId": 1,
  "submittedAt": "2026-10-20 18:22:03",
  "respondent": { "name": "Jane Doe", "email": "jane@example.com" },
  "values": [
    { "fieldKey": "field-42", "label": "Student Id", "type": "short_text", "value": "A12345678" },
    { "fieldKey": "field-43", "label": "Program",     "type": "single_choice", "value": "Nursing" }
  ]
}
```

The `X-Webhook-Secret` header is optional and sent only when a secret is configured. Any 2xx = success. Non-2xx / timeout / network error = logged as failed.

### Power Automate compatibility

Power Automate is a first-class target, so the integration must work with **no secret at all**:

- **Auth lives in the URL.** A Power Automate *"When an HTTP request is received"* trigger generates a URL containing a `sig=` query parameter that is itself the credential. We store the full URL verbatim (query string included) and must **never** strip or re-encode query parameters when saving or sending.
- **No secret = no header.** When the secret field is blank, the request carries only `Content-Type: application/json`. We do not send an empty `X-Webhook-Secret`, because an empty header can trip request validators.
- **URL validation must allow long, signed URLs.** The `z.string().url()` check plus the `http(s)://` prefix check is sufficient; do **not** add a max-length limit below ~4000 chars, since signed Power Automate URLs are long.
- **Validation response.** A Power Automate flow returning `{ "valid": true }` (e.g. from a *Respond to the request* action) satisfies the webhook-1 contract. The flow must respond **synchronously** within the configured timeout (default 5000 ms); document that flows using *"Respond immediately"* + long-running logic will be reported as `error`, not `invalid`.
- **Submission response.** A Power Automate flow that replies `202`/`200` with any body counts as success — we don't parse the webhook-2 response.
- **Test button** sends a sample payload with `"value": "TEST-000"` (webhook-1) or `event: "webhook.test"` (webhook-2) so a flow can be exercised without creating a real submission.

---

## Step-by-Step Implementation Guide

### Step 1: Database schema — `webhooks` table

**File:** `server/src/database/schema.ts`

Add inside `createSchema()`:

```sql
CREATE TABLE IF NOT EXISTS webhooks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key             TEXT    NOT NULL CHECK(key IN ('webhook-1', 'webhook-2')),
  name            TEXT,
  url             TEXT    NOT NULL,
  secret          TEXT,               -- optional; NULL = no secret header sent
  enabled         INTEGER NOT NULL DEFAULT 1,
  timeout_ms      INTEGER NOT NULL DEFAULT 5000,
  -- How to interpret webhook-1's response. Configurable so the endpoint's
  -- contract can change without a code deploy.
  response_shape  TEXT    NOT NULL DEFAULT 'json_boolean'
                          CHECK(response_shape IN ('json_boolean', 'json_string', 'plain_text')),
  response_key    TEXT    NOT NULL DEFAULT 'valid',
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(organization_id, key)
);
```

```sql
CREATE INDEX IF NOT EXISTS idx_webhooks_org ON webhooks(organization_id, key);
```

And a delivery log table (keeps failures diagnosable from the admin panel):

```sql
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id     INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  response_id    INTEGER REFERENCES collection_responses(id) ON DELETE SET NULL,
  direction      TEXT    NOT NULL CHECK(direction IN ('validate', 'submit')),
  status         TEXT    NOT NULL CHECK(status IN ('success', 'failed')),
  http_status    INTEGER,
  duration_ms    INTEGER,
  error          TEXT,
  response_body  TEXT,          -- truncated to 1000 chars; lets admins see the real shape
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

```sql
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_hook ON webhook_deliveries(webhook_id, created_at);
```

> **Note:** `key` is a SQL Server reserved word. The MSSQL adapter already rewrites bare `key` → `[key]` (`server/src/database/adapters/mssql-adapter.ts:70`), so `webhooks.key` works without extra escaping — but write queries with a bare `key` identifier (not `webhooks.key` aliased oddly) so the rewrite applies.

#### Where the field → webhook binding lives

Because `collection_fields` must not be altered, the binding is stored on the **webhook** side, in a third new table:

```sql
CREATE TABLE IF NOT EXISTS webhook_field_bindings (
  webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  field_id   INTEGER NOT NULL REFERENCES collection_fields(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (webhook_id, field_id)
);
```

```sql
CREATE INDEX IF NOT EXISTS idx_webhook_field_bindings_field ON webhook_field_bindings(field_id);
```

- A field is a "Student ID" field when it has a row here **and** the bound webhook is `key = 'webhook-1'`.
- `ON DELETE CASCADE` on `field_id` means deleting a field or a collection cleans up bindings automatically — no orphan rows, no manual cleanup.
- Deleting a webhook cascades its bindings, so the field silently degrades to a plain short-text field (matching D7).
- **`collection_fields` is never written to by this feature.**

---

### Step 2: Database migration — **no table rebuild**

**File:** `server/src/database/db.ts` (`applyIncrementalSchema`)

> **Decision: do not rebuild `collection_fields`.** The `type` column has a `CHECK` constraint, and the repo already rebuilds the table three times (`pre_location`, `pre_document`, `collection_fields_old`). A fourth rebuild means renaming a table that three other tables have foreign keys into, copying every row, dropping the original, and then repairing stale FK targets — exactly the class of migration that has caused the most trouble here. **We avoid it entirely** by storing the Student ID as an existing type plus a flag.

#### Why this is safe

1. **No DDL on `collection_fields` at all** — no rename, no copy, no drop, no FK repair. `collection_fields` is never touched.
2. **The only schema change is three brand-new tables** (`webhooks`, `webhook_deliveries`, `webhook_field_bindings`), created with `CREATE TABLE IF NOT EXISTS`. Nothing existing is altered.
3. **The `CHECK` constraint stays valid** because we never write a new `type` value. A Student ID field is stored as `type = 'short_text'` with `display_style = 'student_id'`.
4. **`display_style` already round-trips end to end** — it is read/written by `toApiCollection`, `dbFieldsToFieldInput`, `insertFields`, `insertFieldsForVersion`, and the builder's save payload. No new column, no new plumbing.
5. **Existing rows are unaffected.** No `UPDATE` is run; every current field keeps `display_style` as-is (`'radio'`, `'dropdown'`, or `'stars'`).
6. **`resolveFieldDisplayStyle()` is already a whitelist** (`collections.ts:396`) — it only preserves `'dropdown'` for `single_choice` and `'numbers'` for `rating`, and returns `'radio'` for everything else. So a stored `'student_id'` can never leak into an unrelated field type on read.

#### The one thing that must change

`resolveFieldDisplayStyle()` would currently **coerce `'student_id'` back to `'radio'`** on save. Add one branch:

```ts
function resolveFieldDisplayStyle(type: FieldType, displayStyle?: string): string {
  if (type === 'single_choice') {
    return displayStyle === 'dropdown' ? 'dropdown' : 'radio'
  }

  if (type === 'rating') {
    return displayStyle === 'numbers' ? 'numbers' : 'stars'
  }

  // Student ID is a short-text field distinguished by display_style, which
  // avoids adding a value to the collection_fields.type CHECK constraint
  // (that would require a full table rebuild).
  if (type === 'short_text') {
    return displayStyle === 'student_id' ? 'student_id' : 'radio'
  }

  return 'radio'
}
```

#### Migration code (the whole of it)

```ts
// webhooks / webhook_deliveries are created in schema.ts via CREATE TABLE IF NOT EXISTS.
// No ALTER TABLE and no rebuild is needed for the Student ID field type:
// it is stored as type='short_text' + display_style='student_id'.
```

That's it. **No `ALTER TABLE`, no rename, no rebuild, no FK repair, no data copy.**

#### Backfill / data safety

- **Nothing to backfill.** No existing row is read or written.
- **Rollback is trivial.** Reverting the code leaves the three new tables in place (harmless, unused) and every existing field untouched. There is no half-rebuilt table to recover from — the failure mode that makes rebuilds risky simply doesn't exist here.
- **`server/src/database/schema.ts`** — add the three new tables only. Leave the `collection_fields` `CHECK` list **unchanged** (adding `'student_id'` there would only matter for fresh installs, and we're not using that type value at all).

> ⚠️ **SQL Server:** `applySqlServerMigrations()` is intentionally a no-op for schema changes. The three tables are created by an **opt-in bootstrap step that runs automatically at startup** — `applySqlServerBootstrapScripts()` executes `server/scripts/webhooks-sqlserver.sql` via the existing `runSqlServerSeedFile()` helper. Every statement is guarded, so it is safe on every boot and never alters existing tables. Disable with `SQLSERVER_BOOTSTRAP_DDL=false`.
>
> **All ID/FK columns must be `BIGINT`** — the existing `organizations.id`, `users.id`, `collection_fields.id`, and `collection_responses.id` are `bigint` in Azure SQL, and `INT` FK columns fail with *"Could not create constraint or index"*.
>
> To apply out-of-band instead: `cd server && node scripts/apply-webhooks-sqlserver.mjs`.

#### Trade-offs (and why they're acceptable)

| Trade-off | Impact | Mitigation |
|-----------|--------|------------|
| `type` doesn't literally say `student_id` | A raw SQL query filtering `type = 'student_id'` returns nothing | Query `type = 'short_text' AND display_style = 'student_id'`; expose a single server-side helper `isStudentIdField(field)` so the predicate lives in one place |
| Two columns encode one concept | Slightly less self-documenting | Documented in `APPLICATION_GUIDE.md` and in a comment on `resolveFieldDisplayStyle` |
| A future maintainer might "fix" it by adding the type | Could reintroduce the rebuild | Add a code comment at the `CHECK` constraint stating Student ID deliberately uses `display_style` to avoid a rebuild |

If the field type later needs to be a true first-class `type` value, the rebuild can be done deliberately as its own reviewed migration — not bundled into this feature.

---

### Step 3: Shared types

**File:** `client/src/types/index.ts`

```ts
export type FieldType = /* …existing… */ | 'student_id'

export interface CollectionField {
  /* …existing… */
  isStudentId?: boolean       // derived: type === 'short_text' && displayStyle === 'student_id'
  studentIdWebhookId?: number | null   // read-only, resolved from webhook_field_bindings
}

export type WebhookKey = 'webhook-1' | 'webhook-2'

export interface Webhook {
  id: number
  organizationId: number
  key: WebhookKey
  name: string | null
  url: string
  hasSecret: boolean          // never return the secret itself
  enabled: boolean
  timeoutMs: number
  responseShape: 'json_boolean' | 'json_string' | 'plain_text'
  responseKey: string         // JSON key to read when shape is json_*
  boundFieldIds: number[]     // fields bound to this webhook (webhook-1 only)
  updatedAt: string
}

export interface WebhookDelivery {
  id: number
  direction: 'validate' | 'submit'
  status: 'success' | 'failed'
  httpStatus: number | null
  durationMs: number | null
  error: string | null
  createdAt: string
}
```

**File:** `server/src/lib/schemas.ts`

- **Do not** add a new value to `fieldTypeSchema` — Student ID uses the existing `'short_text'` type.
- Add `studentIdWebhookId: z.number().int().positive().nullable().optional()` to `fieldInputSchema` (it is a *binding* input, not a field column).
- Add:

```ts
export const webhookKeySchema = z.enum(['webhook-1', 'webhook-2'])

export const upsertWebhookSchema = z.object({
  organizationId: positiveInt.optional(),
  key: webhookKeySchema,
  name: z.string().trim().max(120).optional(),
  url: z.string().trim().url('Must be a valid URL').refine(u => /^https?:\/\//i.test(u), 'URL must start with http:// or https://'),
  secret: z.string().max(512).optional().or(z.literal('')),   // empty string = clear / no secret
  enabled: z.boolean().optional(),
  timeoutMs: z.number().int().min(500).max(30000).optional(),
  responseShape: z.enum(['json_boolean', 'json_string', 'plain_text']).optional(),
  responseKey: z.string().trim().min(1).max(64).optional(),
})

export const validateFieldSchema = z.object({
  fieldId: positiveInt,
  value: z.string().max(2000),
})

export const bindWebhookFieldSchema = z.object({
  fieldId: positiveInt,
  bound: z.boolean(),
})
```

Also add the shared predicate used by every server path:

```ts
// server/src/services/webhooks.ts
export function isStudentIdField(field: { type: string; display_style?: string | null }): boolean {
  return field.type === 'short_text' && field.display_style === 'student_id'
}
```

---

### Step 4: Server — webhook service

**New file:** `server/src/services/webhooks.ts`

Responsibilities:

- `getWebhookForOrg(orgId, key)` → row or `null`.
- `callValidationWebhook(webhook, payload)` → `{ valid: boolean, reason: 'invalid' | 'error', rawBody: string }`.
  - `fetch` with `AbortSignal.timeout(webhook.timeout_ms)`.
  - Send `X-Webhook-Secret` **only** when `webhook.secret` is a non-empty string. When it is `NULL`/empty, send no auth header at all (Power Automate and similar endpoints reject or ignore unknown headers inconsistently, so omit rather than send an empty one).
  - Parse via `parseValidationResponse(webhook, bodyText)` — driven entirely by the stored `response_shape` / `response_key` (see D3). **Never hard-code a key or a type.**
  - **Never throw** — return `reason: 'error'` on network/timeout/non-2xx.
- `parseValidationResponse(webhook, bodyText): boolean | null` — pure, unit-testable:
  ```ts
  const TRUTHY = new Set(['true', '1', 'yes', 'y', 'valid'])
  const FALSY  = new Set(['false', '0', 'no', 'n', 'invalid'])

  export function parseValidationResponse(
    hook: { response_shape: string; response_key: string },
    bodyText: string,
  ): boolean | null {
    let raw: unknown = bodyText
    if (hook.response_shape !== 'plain_text') {
      try {
        const json = JSON.parse(bodyText) as Record<string, unknown>
        raw = json?.[hook.response_key]
      } catch {
        return null                     // unparseable → caller reports 'invalid'
      }
    }
    if (typeof raw === 'boolean') return raw
    if (typeof raw === 'number') return raw === 1 ? true : raw === 0 ? false : null
    if (typeof raw === 'string') {
      const s = raw.trim().toLowerCase()
      if (TRUTHY.has(s)) return true
      if (FALSY.has(s)) return false
    }
    return null
  }
  ```
- `sendSubmissionWebhook(webhook, payload, responseId)` → fire-and-forget; writes a `webhook_deliveries` row in both success and failure paths.
- `logDelivery(...)` helper.
- `pruneDeliveries(webhookId)` — keep the newest 200 rows per webhook (call after each insert).

Implementation notes:
- Reuse the `fetch` pattern from `server/src/services/notificationEmail.ts`.
- Follow the existing fire-and-forget convention used for confirmation emails in `collections.ts`:
  `void sendSubmissionWebhook(...).catch(err => console.error('[webhooks] …', err))`.
- Truncate `error` to ~1000 chars before storing.

---

### Step 5: Server — admin CRUD routes

**New file:** `server/src/routes/webhooks.ts`

Register in `server/src/index.ts` after `signupSlotsRouter`:

```ts
import webhooksRouter from './routes/webhooks'
app.use('/api/webhooks', webhooksRouter)
```

Routes (all `authenticateToken`; **Administrator or Super Admin** only; org scoping mirrors `locations.ts`):

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/webhooks` | List webhooks for the caller's org (Super Admin may pass `?organizationId=`). |
| `PUT` | `/api/webhooks/:key` | Create or update (`webhook-1` / `webhook-2`). Upsert on `(organization_id, key)`. |
| `DELETE` | `/api/webhooks/:key` | Delete; its `webhook_field_bindings` rows cascade away, so bound fields degrade to plain text. |
| `POST` | `/api/webhooks/:key/test` | Send a sample payload; return `{ ok, httpStatus, durationMs, error }`. For `webhook-1`, report the parsed boolean. |
| `GET` | `/api/webhooks/:key/deliveries` | Last 20 delivery log rows. |

`GET` must **never** return `secret` — return `hasSecret: true` instead. On `PUT`, omitting `secret` leaves the stored value untouched; sending `""` clears it; sending a non-empty string replaces it.

---

### Step 6: Server — expose the binding on collections

**File:** `server/src/routes/collections.ts`

1. **No `DbField` interface change and no `INSERT` change.** `collection_fields` is untouched — `insertFields()` / `insertFieldsForVersion()` need no modification.
2. In `toApiCollection()` (line ~624) and `dbFieldsToFieldInput()` (line ~659), add one derived property per field:
   `isStudentId: isStudentIdField(f)` — `displayStyle` is already mapped, so `display_style = 'student_id'` flows to the client automatically.
3. **Resolve bindings in bulk** (avoids N+1): one query per collection load —
   ```sql
   SELECT b.field_id, b.webhook_id
   FROM webhook_field_bindings b
   JOIN webhooks w ON w.id = b.webhook_id
   WHERE b.field_id IN (…) AND w.key = 'webhook-1'
   ```
   Map `field_id → webhook_id` and expose it as `studentIdWebhookId` on the field.
4. **Persist bindings separately from fields.** In `POST /` and `PUT /:id`, after `insertFields`/`insertFieldsForVersion` runs, reconcile `webhook_field_bindings` for this collection's fields:
   - delete bindings for fields no longer present or no longer `display_style = 'student_id'`;
   - insert bindings for fields carrying `studentIdWebhookId`.
   - **Validate** that the referenced webhook exists, belongs to the collection's organization, and has `key = 'webhook-1'`; return `400` otherwise. This keeps the write path to `collection_fields` completely unchanged.
5. In `GET /public/:slug`, **strip** `studentIdWebhookId` from the public payload — the browser only needs `isStudentId`, not which internal webhook row backs it.

6. **Enforce one webhook-1 per form on save.** In `POST /` and `PUT /:id`, if more than one distinct `studentIdWebhookId` appears across Student ID fields, return `400 { error: 'Only one validation webhook may be used per form' }`. This backs the UI rule with a server guarantee.

> **Versioning note:** `collection_versions` copies fields via `insertFieldsForVersion()`. Bindings are keyed by `field_id`, so each version's field rows get their own bindings — the reconcile step in (4) must run for version creation too (`POST /:id/versions`), not just for the base collection.

---

### Step 7: Server — public validation endpoint

**File:** `server/src/routes/collections.ts` (registered **before** `/:id` routes; place it next to the other `/public/*` routes)

```
POST /api/collections/public/:slug/validate-field
Body: { fieldId: number, value: string }
```

Flow:

1. Load the collection by slug (`status = 'published'`), resolve its org.
2. Load the field by `fieldId` **and** `collection_id` — 404 if it isn't a field of this collection.
3. If `!isStudentIdField(field)` → `400 { error: 'Field is not a Student ID field' }`.
4. Look up the binding in `webhook_field_bindings`; if none → `{ valid: true, skipped: true }` (D7).
5. If the webhook is disabled → `{ valid: true, skipped: true }` (an admin disabling the hook should not lock every respondent out).
6. Empty value → `{ valid: false }` (let the required-field logic own the message; see UX).
7. Call `callValidationWebhook`.
8. Respond `{ valid: boolean, reason?: 'invalid' | 'error' }`.
9. Log a `webhook_deliveries` row (`direction: 'validate'`).

**Rate limiting:** add a lightweight in-memory limiter keyed by `slug + fieldId + IP` (e.g. 20 requests / 60 s) to stop a single client hammering the admin's endpoint. Keep it simple — no new dependency.

---

### Step 8: Server — re-validate + forward on submit

**File:** `server/src/routes/collections.ts` — `POST /public/:slug/responses` (line ~1592)

1. **Before** the response is inserted, loop over `body.values`:

   ```ts
   for (const val of body.values) {
     const field = fieldById.get(val.fieldId)
     if (!field || !isStudentIdField(field)) continue
     const hook = await getWebhookForField(val.fieldId)   // via webhook_field_bindings
     if (!hook || !hook.enabled) continue
     const result = await callValidationWebhook(hook, { … })
     if (!result.valid) {
       res.status(422).json({
         error: 'Please enter a valid student id',
         fieldId: val.fieldId,
       })
       return
     }
   }
   ```

2. **After** the values are written and `initializeWorkflowForResponse` has run, fire `webhook-2`:

   ```ts
   const submitHook = await getWebhookForOrg(col.organization_id, 'webhook-2')
   if (submitHook?.enabled) {
     void sendSubmissionWebhook(submitHook, buildSubmissionPayload(…), responseId)
       .catch(err => console.error('[webhooks] submission webhook error:', err))
   }
   ```

   Build `values` from `fieldById` so each entry carries `fieldKey`, `label`, `type`, and the **stored** (post-attachment-sanitisation) value. Skip `comment` and `document` fields, matching `fieldStoresResponse()` on the client.

3. **Do not** call `webhook-2` from `PUT /api/my-submissions/:id` — per Resolved Decisions #1, forwarding is create-only. (A `submission.updated` event is listed in future improvements.)

---

### Step 9: Client — API module

**New file:** `client/src/api/webhooks.ts`

```ts
export async function listWebhooks(): Promise<Webhook[]>
export async function saveWebhook(key: WebhookKey, data: WebhookInput): Promise<Webhook>
export async function deleteWebhook(key: WebhookKey): Promise<void>
export async function testWebhook(key: WebhookKey): Promise<WebhookTestResult>
export async function listWebhookDeliveries(key: WebhookKey): Promise<WebhookDelivery[]>
```

**File:** `client/src/api/collections.ts`

```ts
export async function validateStudentId(
  slug: string,
  fieldId: number,
  value: string,
): Promise<{ valid: boolean; reason?: 'invalid' | 'error' }> {
  const res = await fetch(`/api/collections/public/${slug}/validate-field`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fieldId, value }),
  })
  if (!res.ok) throw new Error('Validation request failed')
  return res.json()
}
```

---

### Step 10: Client — Settings "Webhooks" panel

**File:** `client/src/pages/SettingsPage.tsx`

1. Add `'webhooks'` to the `PanelId` union (line ~70).
2. Add to `PANEL_LABELS`: `webhooks: 'Webhooks'`.
3. Add to `ALL_PANEL_IDS` (line ~122) and to `DEFAULT_PANEL_LAYOUT.general` — place it after `'notifications'` so it's discoverable next to the other integration settings.
4. Add `case 'webhooks':` to `renderPanel()` (line ~1958), following the collapsible `<section>` card pattern used by `'categories'` / `'visibility-settings'`:
   - Gate on `user?.role === 'super_admin' || user?.role === 'administrator'` (same guard style as `'ticket-activity'`).
   - Two cards, one per key:
     - **Webhook 1 — Field Validation** — subtitle: *"Called when a Student ID field loses focus. Must return `{ "valid": true }` or `{ "valid": false }`."*
     - **Webhook 2 — Submission Forwarding** — subtitle: *"Called after a form is submitted. Receives the full submission as JSON."*
   - Each card: URL input, **optional** Secret input (password, placeholder "•••• (saved)" when `hasSecret`, helper text *"Optional. Sent as the `X-Webhook-Secret` header. Leave blank for Power Automate / unsigned endpoints."*, with a **Clear** action when one is saved), Timeout (ms) number input, Enabled toggle, **Save**, **Test**, **Delete**, and a collapsible **Recent deliveries** list (status pill, HTTP code, duration, timestamp, **response body**, error).
   - **Webhook-1 only** — a "Response shape" sub-section:
     - **Shape** dropdown: `JSON boolean` (default) / `JSON string` / `Plain text`.
     - **Key** text input (hidden when shape is `Plain text`), default `valid`, placeholder `valid`. Helper: *"The JSON property that holds the result, e.g. `valid`, `isValid`, `result`."*
     - A live **preview** showing what a passing response looks like for the chosen shape/key, e.g. `{ "valid": true }`.
   - **Test** for webhook-1 runs the configured shape/key and reports `Parsed: true` or `Parsed: false (raw: …)` so the admin can confirm the mapping without submitting a real form.
   - Show inline validation errors from the API (invalid URL, etc.).
   - Empty state: "No webhook configured for this organization."

**File:** `client/src/api/settings.ts` / `client/src/types/index.ts` — nothing extra needed; `PanelId` lives in `SettingsPage.tsx`.

---

### Step 11: Client — Collection Builder: Student ID field

**File:** `client/src/pages/CollectionBuilderPage.tsx`

1. **Do not add a value to `FieldType`.** The builder presents "Student ID" as a choice, but stores it as `type: 'short_text'` + `displayStyle: 'student_id'`.
2. Add a small presentation-layer mapping so the UI can still show it as its own entry:
   ```ts
   const STUDENT_ID_DISPLAY_STYLE = 'student_id'
   // In the type picker, "Student ID" sets { type: 'short_text', displayStyle: 'student_id' }
   // and the field card renders its label from displayStyle when it is STUDENT_ID_DISPLAY_STYLE.
   ```
3. `normalizeFieldType` and `FieldType` are **unchanged** — no new type to normalise.
4. The local field draft interface (line ~81) and its initialiser (line ~114): add `studentIdWebhookId: number | null` (default `null`).
5. Hydration from the API (lines ~143, ~426) and the save payload (line ~970): carry `displayStyle` and `studentIdWebhookId` through. **`displayStyle` already exists in all three places** — only `studentIdWebhookId` is new.
6. In the field settings card, add a block for `field.displayStyle === 'student_id'`, modelled on the existing `'location'` filter checkbox block (line ~3240):

   ```
   Validation webhook
   [ dropdown: — None (always valid) —  |  Webhook 1 — <name> ]
   ```
   - Populate from `listWebhooks()` filtered to `key === 'webhook-1'` (fetched once on page mount).
   - **One per form:** the dropdown selection is held at the *form* level, not per field. Choosing a webhook in one Student ID field applies it to every Student ID field in the collection, and the dropdown is disabled (with a hint: *"One validation webhook per form — change it here to update all Student ID fields."*) on any second and subsequent Student ID field. Clearing it clears all bindings.
   - If no `webhook-1` exists, show a hint with a link to Settings → Webhooks.
   - Subtitle: *"Validated when the respondent leaves the field. Must return `true` for the form to submit."*

7. **Preview mode** (`TicketPreviewModal` / builder preview): render the field as a plain text input — no network calls (D6).

---

### Step 12: Client — Fill page: Student ID input + on-blur validation

**File:** `client/src/pages/CollectionFillPage.tsx`

1. **New component** `StudentIdFieldInput`, alongside `LocationFieldInput` (line ~1990):

```tsx
function StudentIdFieldInput({
  value, onChange, disabled, collectionSlug, fieldId, previewMode,
}: { … }) {
  const [status, setStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid' | 'error'>('idle')
  const lastChecked = useRef<string>('')

  async function handleBlur() {
    const trimmed = value.trim()
    if (!trimmed) { setStatus('idle'); return }
    if (trimmed === lastChecked.current) return          // don't re-hit on unchanged value
    lastChecked.current = trimmed
    if (previewMode) return                               // D6
    setStatus('checking')
    try {
      const { valid, reason } = await validateStudentId(collectionSlug, fieldId, trimmed)
      setStatus(valid ? 'valid' : reason === 'error' ? 'error' : 'invalid')
    } catch {
      setStatus('error')
    }
  }

  // reset when the value is edited after a check
  // (onChange wrapper clears status + lastChecked)
  …
}
```

2. Render:

```tsx
{field.displayStyle === 'student_id' && (
  <StudentIdFieldInput … />
)}
```

3. **Messages** (exact copy requested by the admin):
   - `invalid` → `Please enter a valid student id` (red, below the input).
   - `error` → `We couldn't verify this student id right now. Please try again in a moment.` (amber) — distinct so a broken webhook isn't blamed on the respondent.
   - `checking` → small spinner / "Checking…" next to the input.
   - `valid` → green check icon (no text).

4. **Submit gate.** Track validation state in the parent so it survives page navigation:

   ```ts
   const [studentIdStatus, setStudentIdStatus] = useState<Record<number, 'idle'|'checking'|'valid'|'invalid'|'error'>>({})
   ```

   - In `handleNextPage()` (line ~1190) and `handleStartReview()` (line ~1217): if any **visible** Student ID field on the current page has a non-empty value and status is `invalid` or `error`, block with the matching message.
   - In `handleSubmit()` (line ~1243): same check across all visible fields before calling `submitResponse`. If the server returns `422` with `fieldId`, map it back to the field, set `invalid`, jump to that page, and show the message.
   - Status `idle` with a non-empty value = "not yet checked" → trigger the check on submit rather than blocking (avoids punishing users who typed and clicked Submit without blurring).

5. **`fieldStoresResponse()`** (line ~170): stores normally — the field is `short_text`, which already falls through the `default` branch. No change needed.

6. **`isRequiredFieldFilled()`** (line ~1132): falls through to `value.trim() !== ''` — correct.

7. **Review step** (`renderReviewValue`, line ~1357): falls through to the default text rendering — correct.

8. **Draft restore** (line ~944): a restored draft's Student ID values are unchecked (`idle`). That's intentional — they're re-checked on submit.

---

### Step 13: Documentation

- `docs/APPLICATION_GUIDE.md` — new "Webhooks" section: where to configure them, the request/response contracts from this doc, what "valid" means, and the fact that `webhook-2` failures never block submissions.
- `docs/plans/future-improvements.md` — add: retry/backoff + dead-letter for `webhook-2`, per-collection webhook overrides, HMAC signing, webhook support for signup sheets, and a `submission.updated` event for edits (deferred per Resolved Decisions #1).
- `SQL_SERVER_MIGRATION_LOG.md` — record the manual DDL for the three new tables only (`webhooks`, `webhook_deliveries`, `webhook_field_bindings`). **No `collection_fields` change.**

---

## Files Touched

| File | Change |
|------|--------|
| `server/src/database/schema.ts` | **+3 new tables only** (`webhooks`, `webhook_deliveries`, `webhook_field_bindings`). `collection_fields` untouched. |
| `server/src/database/db.ts` | **No change.** No rebuild, no `ALTER TABLE`, no FK repair. |
| `server/src/lib/schemas.ts` | `studentIdWebhookId` on `fieldInputSchema`; webhook / validate / bind schemas incl. `responseShape` + `responseKey`. **No new `fieldTypeSchema` value.** |
| `server/src/services/webhooks.ts` | **new** — outbound calls, parsing, delivery logging, `isStudentIdField()` |
| `server/src/routes/webhooks.ts` | **new** — admin CRUD + test + deliveries + field binding |
| `server/src/routes/collections.ts` | `resolveFieldDisplayStyle()` branch; `isStudentId` on the API payload; binding reconcile on save/version-create; validate-field route; submit re-check + forward |
| `server/src/index.ts` | mount `/api/webhooks` |
| `client/src/types/index.ts` | `isStudentId` / `studentIdWebhookId` on `CollectionField`; `Webhook`, `WebhookDelivery` |
| `client/src/api/webhooks.ts` | **new** |
| `client/src/api/collections.ts` | `validateStudentId()` |
| `client/src/pages/SettingsPage.tsx` | `webhooks` panel |
| `client/src/pages/CollectionBuilderPage.tsx` | "Student ID" picker entry (`short_text` + `display_style`) + webhook binding UI |
| `client/src/pages/CollectionFillPage.tsx` | `StudentIdFieldInput`, submit gate, 422 handling |
| `docs/*` | guide, future improvements, SQL Server log |

---

## Edge Cases & Behaviours

| Scenario | Behaviour |
|----------|-----------|
| Field left empty, not required | No call, no error. |
| Field left empty, required | Existing required-field message. |
| Webhook has no secret (e.g. Power Automate) | No `X-Webhook-Secret` header sent; everything else identical. |
| Webhook disabled by admin | Treated as "skipped → valid" so respondents aren't locked out. |
| Webhook returns non-2xx / times out | `error` state → amber "couldn't verify" message; submit blocked until it succeeds. |
| Webhook returns `false` | `invalid` state → red "Please enter a valid student id"; submit blocked. |
| User types after a failed check | Status resets to `idle`; re-checked on next blur. |
| Server-side re-check fails at submit | `422` with `fieldId`; client jumps to the page and shows the message. |
| `webhook-2` down / slow | Submission succeeds; delivery logged as `failed`. |
| Webhook deleted while bound to a field | Binding row cascades away; field degrades to a plain short-text field. |
| Collection or field deleted | Binding rows cascade away; no orphans. |
| Existing `short_text` field | Unaffected — it has no binding and `display_style = 'radio'`. |
| Existing `display_style` values (`radio`/`dropdown`/`stars`/`numbers`) | Unaffected — `resolveFieldDisplayStyle()` whitelist is unchanged for those types. |
| Preview / test mode | No outbound calls. |
| Anonymous collection | Works the same; `organizationId` comes from the collection. |
| Cross-org binding attempt | `400` on collection save. |
| Two Student ID fields with different webhooks | `400` on save — one validation webhook per form. |
| Endpoint changes `true` → `"true"` | Admin switches Response shape to `JSON string`; no code change or redeploy. |
| Endpoint renames the key (`valid` → `isValid`) | Admin edits the Key field; no code change. |
| Endpoint returns something unparseable | Treated as `invalid`, raw body visible in the delivery log. |
| Rollback of the feature | Drop the 3 new tables; every existing field and response is untouched. |

---

## Testing Plan

**Server**
- Upsert/list/delete webhooks; `secret` never returned; org scoping enforced; non-admin gets `403`.
- Secret round-trip: omit → unchanged, `""` → cleared, value → replaced; **no header sent when secret is NULL** (assert on a mock server).
- Signed URL round-trip: a Power Automate-style URL with `?sig=…&api-version=…` is stored and sent byte-for-byte.
- `resolveFieldDisplayStyle()`: `short_text` + `student_id` → `student_id`; `short_text` + `dropdown` → `radio`; `single_choice` + `dropdown` → `dropdown` (unchanged).
- `parseValidationResponse()` table-driven cases: `json_boolean` (`true`/`false`/`"true"`/`1`/`0`/missing key/garbage), `json_string` (`"true"`/`"false"`/`"YES"`/`"no"`/`""`), `plain_text` (`true`/` false `/`yes`/`maybe`), custom key (`isValid`, `result`), non-JSON body under a JSON shape.
- Changing `response_shape`/`response_key` on a saved webhook takes effect immediately on the next validation.
- Two Student ID fields with different webhooks → `400` on save.
- Binding reconcile: bind, unbind, delete field, delete webhook, create a new version — bindings stay correct and no orphans remain.
- `validate-field`: valid / invalid / unreachable / disabled / non-Student-ID field / field from another collection.
- Submit with an invalid Student ID → `422`, no response row created.
- Submit with a valid Student ID → response created, `webhook-2` called with the expected payload shape.
- `webhook-2` returning 500 → response still created, delivery row `failed`.
- Delivery log pruning keeps ≤ 200 rows.

**Client**
- Blur triggers exactly one call; unchanged value on re-blur triggers none.
- Error copy matches the spec.
- Submit blocked while `invalid` / `error`; allowed once `valid`.
- 422 from the server routes the user to the right page.
- Preview mode makes no network calls.
- Settings panel: save, test, delete, deliveries list, validation errors.
- Builder: pick "Student ID" → save → reload → still renders as Student ID with its webhook binding intact.

**Migration / safety**
- **No `collection_fields` schema change** — assert `sqlite_master.sql` for `collection_fields` is byte-identical before and after startup.
- Startup against a DB with existing data creates only the 3 new tables; `PRAGMA table_info(collection_fields)` is unchanged.
- Restart → `CREATE TABLE IF NOT EXISTS` is a no-op (idempotent).
- Existing collections with `short_text`, `single_choice`, `rating`, and `location` fields render and submit exactly as before.

---

## Resolved Decisions

All questions answered by the product owner on 2026-10-20.

| # | Question | Decision | Where it lands |
|---|----------|----------|----------------|
| 1 | Should `webhook-2` fire on submission **edits**? | **No.** `webhook-2` fires on create only. | Step 8 — no call in `PUT /api/my-submissions/:id`. A `submission.updated` event is a future improvement. |
| 2 | Is the validation payload sufficient? | **Yes** — `{ value, fieldKey, fieldLabel, collectionSlug, organizationId }`. | Step 4 / webhook-1 contract. |
| 3 | Is `{ "valid": true }` the accepted response shape? | **Make it configurable and stored**, since it may become a string. | New `response_shape` + `response_key` columns; `parseValidationResponse()`; Settings → "Response shape" sub-section. See D3. |
| 4 | Plain `X-Webhook-Secret` or HMAC? | **Plain, optional header.** No HMAC. | Step 4. |
| 5 | Multiple Student ID fields per form? | **One webhook per form.** Multiple Student ID fields are allowed, but they all share the same `webhook-1`. | Builder: form-level dropdown; server: `400` if two distinct webhooks appear on one form. See D7. |
| 6 | `webhook-2` scope? | **One per organization.** | `UNIQUE(organization_id, key)` already enforces it. See D5. |

### Note on Q3 — why this matters

Storing the shape rather than hard-coding it means the endpoint's contract can evolve without a code change:

- It returns `true` today → `JSON boolean`, key `valid`.
- It later returns `"true"` → switch to `JSON string`, same key. **No redeploy.**
- It later returns `{ "isValid": "Y" }` → `JSON string`, key `isValid`. **No redeploy.**
- It returns a bare `true` with no JSON wrapper → `Plain text`.

The delivery log stores the raw response body (truncated to 1000 chars), so if a parse fails the admin can open **Recent deliveries** and see exactly what came back, then adjust the shape accordingly.
