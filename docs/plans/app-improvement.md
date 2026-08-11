# App Improvement Plan

**Date:** 2026-08-11
**Status:** Draft — pending review
**Scope:** Cross-cutting codebase health improvements identified from review of `server/` and `client/`

---

## Executive Summary

Four high-impact improvements targeting security, correctness, reliability, and maintainability. Each is independently shippable and ordered by risk-reduction priority.

| # | Improvement | Primary Risk Addressed | Effort | Impact |
|---|-------------|------------------------|--------|--------|
| 1 | Harden API Security — Helmet + Rate Limiting | Brute-force / header attacks | Low | High |
| 2 | Standardize Input Validation with Zod | Bad data / injection | Medium | High |
| 3 | Add Automated Tests | Regressions | Medium | High |
| 4 | Centralize Frontend Data-Fetching | Stale data / boilerplate | Medium | Medium-High |

---

## 1. Harden API Security — Helmet + Rate Limiting

**Problem:**
- No `helmet` — missing `X-Frame-Options`, `HSTS`, `X-Content-Type-Options`, etc. in `server/src/index.ts`.
- No `express-rate-limit` — `POST /api/auth/login` and `POST /api/auth/logout` are unthrottled.
- `JWT_SECRET` fallback in `server/src/middleware/auth.ts` (`dcp-dev-secret-change-in-production`) and per-restart random secret in `server/src/index.ts` (prod) silently invalidates all sessions on restart.
- CORS allowlist is hardcoded to `localhost:5173` with no prod env var.

**Solution:**
1. `npm install helmet express-rate-limit` in `server/`.
2. In `server/src/index.ts`:
   ```ts
   import helmet from 'helmet'
   import rateLimit from 'express-rate-limit'
   app.use(helmet())
   const authLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true })
   app.use('/api/auth/login', authLimiter)
   app.use('/api/auth/logout', authLimiter)
   ```
3. Fail fast in prod if `JWT_SECRET` missing — `throw new Error('JWT_SECRET required in production')` instead of generating random secret.
4. Make CORS origin configurable: `process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:5173']` and enable only when `IS_PROD`.

**Files to Modify:**
- `server/package.json` — add `helmet`, `express-rate-limit`
- `server/src/index.ts` — middleware wiring, env validation, CORS config
- `server/src/middleware/auth.ts` — remove hardcoded fallback, require env
- `server/.env.example` — document `JWT_SECRET`, `CORS_ORIGIN`

**Acceptance Criteria:**
- `curl -I` shows `helmet` headers; 11th login attempt in 60s returns `429`.
- Server refuses to start in `NODE_ENV=production` without `JWT_SECRET`.

---

## 2. Standardize Input Validation with Zod

**Problem:**
- Manual checks (`typeof userId !== 'number'`, `Number.isInteger`, etc.) duplicated across `server/src/routes/auth.ts`, `server/src/routes/users.ts`, `server/src/routes/collections.ts`, `server/src/routes/organizations.ts`.
- Inconsistent error shapes and no type inference for `req.body`/`req.query`.
- No shared schema — validation drift as routes evolve.

**Solution:**
1. `npm install zod` in `server/`.
2. Create `server/src/lib/schemas.ts`:
   ```ts
   import { z } from 'zod'
   export const loginSchema = z.object({ userId: z.number().int().positive() })
   export const paginationSchema = z.object({ page: z.coerce.number().int().min(1).default(1) })
   ```
3. Create `server/src/middleware/validate.ts`:
   ```ts
   export const validate = (schema: z.ZodSchema) => (req, res, next) => {
     const result = schema.safeParse(req.body ?? req.query)
     if (!result.success) return res.status(400).json({ error: 'Validation failed', details: result.error.flatten() })
     req.validated = result.data; next()
   }
   ```
4. Replace manual checks: `router.post('/login', validate(loginSchema), handler)`.
5. Add `zod` schemas for collections, users, and organizations routes incrementally.

**Files to Modify:**
- `server/package.json`
- `server/src/lib/schemas.ts` (new)
- `server/src/middleware/validate.ts` (new)
- `server/src/routes/auth.ts`, `server/src/routes/users.ts`, `server/src/routes/collections.ts`, `server/src/routes/organizations.ts`

**Acceptance Criteria:**
- All auth/user/collection endpoints return `400 { error, details }` with field-level errors.
- `req.body` is typed via `z.infer<typeof schema>`.

---

## 3. Add Automated Tests (Currently 0% Coverage)

**Problem:**
- No `*.test.*` or `*.spec.*` files in repo. Critical paths — `DbAdapter` dialect branching (`sqlite` vs `sqlserver`), approval workflows (`server/src/services/approvalWorkflows.ts`), collection versioning — have no regression safety.
- No CI gate; `tsc --noEmit` not enforced on PR.

**Solution:**
1. **Server:** `npm install -D vitest supertest @types/supertest` in `server/`.
   - `server/vitest.config.ts` + `server/src/database/adapter.test.ts` (dialect placeholder conversion `?` → `@p1`).
   - `server/src/routes/auth.test.ts` (supertest: login success/404/400, rate-limit 429).
   - `server/src/services/approvalWorkflows.test.ts` (stage transitions).
2. **Client:** `npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom` in `client/`.
   - `client/src/pages/CollectionBuilderPage.test.tsx` — renders builder, adds field.
3. **CI:** Add `.github/workflows/ci.yml`:
   ```yaml
   - run: npm --prefix server run build  # tsc
   - run: npm --prefix client run build  # tsc + vite build
   - run: npm --prefix server test
   - run: npm --prefix client test
   ```
4. Add `test` scripts to both `package.json`.

**Files to Modify:**
- `server/package.json`, `server/vitest.config.ts`, `server/src/**/*.test.ts`
- `client/package.json`, `client/vitest.config.ts`, `client/src/**/*.test.tsx`
- `.github/workflows/ci.yml` (new)

**Acceptance Criteria:**
- `npm test` passes locally; CI fails PR on type or test failure.
- Coverage for `DbAdapter` and `auth` routes > 70%.

---

## 4. Centralize Frontend Data-Fetching

**Problem:**
- `client/src/api/*.ts` and pages use raw `fetch` with repeated `credentials: 'include'`, scattered `401` handling, and no caching/deduping.
- `client/src/contexts/AuthContext.tsx` manually calls `/api/auth/me` and `/api/auth/switch-organization` with duplicated logic.
- No loading/error standardization; mutations leave stale data (e.g., after `switchOrganization`).

**Solution:**
1. Create `client/src/lib/apiClient.ts`:
   ```ts
   export async function apiClient<T>(path: string, init?: RequestInit): Promise<T> {
     const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...init?.headers }, ...init })
     if (res.status === 401) { window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT)); throw new Error('Unauthorized') }
     if (!res.ok) throw new Error((await res.json().catch(()=>({}))).error ?? res.statusText)
     return res.json() as Promise<T>
   }
   ```
2. Install `npm install @tanstack/react-query` in `client/`.
3. Wrap `App.tsx` with `QueryClientProvider`; replace manual `fetch` in `client/src/api/*.ts` with `useQuery`/`useMutation` hooks.
4. Invalidate queries on mutation: `queryClient.invalidateQueries({ queryKey: ['collections'] })` after create/update.
5. Migrate `AuthContext` to use `apiClient` and `useQuery(['me'])` for session validation.

**Files to Modify:**
- `client/package.json` — add `@tanstack/react-query`
- `client/src/lib/apiClient.ts` (new)
- `client/src/api/*.ts` — refactor to use `apiClient`
- `client/src/contexts/AuthContext.tsx` — use `apiClient` + react-query
- `client/src/App.tsx` — add `QueryClientProvider`
- `client/src/pages/*.tsx` — adopt `useQuery`/`useMutation` incrementally

**Acceptance Criteria:**
- No raw `fetch('/api/...')` outside `apiClient.ts`.
- Switching organization automatically refetches dependent queries; 401 consistently triggers sign-out.

---

## Implementation Order

1. **#1 Security** — smallest change, highest risk reduction; ship first.
2. **#2 Validation** — builds on #1; prevents bad data before tests.
3. **#4 apiClient** — can be done in parallel with #2 (client-only).
4. **#3 Tests** — add after #1/#2 so tests cover the new middleware.

## Out of Scope

- Full RBAC overhaul (covered in `docs/plans/organizing-settings.md`).
- DB migration changes (see `SQL_SERVER_MIGRATION_LOG.md`).
