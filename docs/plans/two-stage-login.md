# Plan: Two-Stage Password Login (Email → Password)

**Date:** 2026-08-10
**Status:** Draft — awaiting review before implementation
**Primary files:** `client/src/pages/LoginPage.tsx`

---

## Summary

When `login_mode` is `'password'`, the login page currently shows a single
form with **Email** and **Password** fields visible at the same time,
submitted together via one "Sign In" button.

This changes it to a **two-stage** flow, matching the attached screenshot:

1. **Stage 1 — Email:** only an email field is shown, with a button
   labeled **"Continue to Log in >"**.
2. **Stage 2 — Password:** the entered email is shown as read-only text
   with a **"Change"** link (returns to Stage 1, keeping the typed email
   editable again), a **Password** field appears below it, and the submit
   button is labeled **"Log in"**.

This only affects the password-mode form. The `select` and `maintenance`
forms are unchanged.

---

## Current State

`client/src/pages/LoginPage.tsx` (~line 412) renders, when
`loginMode === 'password'` (or `loginMode === null` while loading, or
`maintenance` + `?admin=1` override):

```tsx
<form onSubmit={e => void handlePasswordSignIn(e)} className="space-y-3 mb-8">
  <p>Sign In with Password</p>
  {pwError && <div>{pwError}</div>}
  <input type="email" placeholder="Email address" value={pwEmail} onChange={...} />
  <input type="password" placeholder="Password" value={pwPassword} onChange={...} />
  <button type="submit">{pwSigningIn ? 'Signing in…' : 'Sign In'}</button>
  <p>Forgot your password? Contact your organization administrator.</p>
</form>
```

`handlePasswordSignIn` posts both fields to
`POST /api/auth/login-with-password` in one request — **no backend changes
are needed**; only the client-side form is being split into two visual
steps before that same submit happens.

---

## Proposed Changes

### 1. New state

```ts
const [pwStage, setPwStage] = useState<'email' | 'password'>('email')
```

Reset to `'email'` whenever the login page mounts or `loginMode` changes
away from `'password'` (not strictly necessary, but keeps state clean if a
user navigates back to `/login` after signing out).

### 2. Stage 1 — Email entry

Renders instead of the current combined form when `pwStage === 'email'`:

```tsx
<form onSubmit={e => { e.preventDefault(); setPwStage('password') }} className="space-y-3 mb-8">
  <p className="text-[10px] font-semibold tracking-[0.2em] text-[#64748B] dark:text-[#475569] uppercase mb-4">
    Sign In with Password
  </p>
  <input
    type="email"
    placeholder="Email address"
    value={pwEmail}
    onChange={e => setPwEmail(e.target.value)}
    autoComplete="email"
    required
    autoFocus
    className={INPUT_CLASS}
  />
  <button
    type="submit"
    disabled={!pwEmail}
    className="w-full bg-[#2563EB] text-white font-semibold py-2.5 text-sm tracking-wide rounded-[2px] hover:bg-blue-700 transition-colors disabled:opacity-50"
  >
    Continue to Log in &gt;
  </button>
</form>
```

- No server call at this stage — it's a pure client-side transition, same
  as the reference screenshot (the "Change" link on Stage 2 has to return
  to an already-filled email field instantly, with no round trip).
- `required` + native email validation on the input is enough gating for
  "Continue" (matches today's minimal validation approach elsewhere in
  this form).

### 3. Stage 2 — Password entry

Renders when `pwStage === 'password'`:

```tsx
<form onSubmit={e => void handlePasswordSignIn(e)} className="space-y-3 mb-8">
  <p className="text-[10px] font-semibold tracking-[0.2em] text-[#64748B] dark:text-[#475569] uppercase mb-4">
    Sign In with Password
  </p>
  {pwError && (
    <div className="px-3 py-2.5 border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 text-sm">
      {pwError}
    </div>
  )}

  {/* Read-only email row with Change link */}
  <div className="flex items-center justify-between border border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#1E293B] px-3 py-2.5 rounded-[2px]">
    <span className="text-sm text-[#1E293B] dark:text-[#F1F5F9] truncate">{pwEmail}</span>
    <button
      type="button"
      onClick={() => { setPwStage('email'); setPwError(null) }}
      className="text-sm font-semibold text-[#2563EB] hover:underline shrink-0 ml-3"
    >
      Change
    </button>
  </div>

  <input
    type="password"
    placeholder="Password"
    value={pwPassword}
    onChange={e => setPwPassword(e.target.value)}
    autoComplete="current-password"
    required
    autoFocus
    className={INPUT_CLASS}
  />
  <button
    type="submit"
    disabled={pwSigningIn || !pwPassword}
    className="w-full bg-[#2563EB] text-white font-semibold py-2.5 text-sm tracking-wide rounded-[2px] hover:bg-blue-700 transition-colors disabled:opacity-50"
  >
    {pwSigningIn ? 'Signing in…' : 'Log in'}
  </button>
  <p className="text-center text-sm text-[#64748B] dark:text-[#94A3B8]">
    <span className="text-[#94A3B8] dark:text-[#475569] text-sm">Forgot your password? Contact your organization administrator.</span>
  </p>
</form>
```

`handlePasswordSignIn` itself is unchanged — it already reads `pwEmail`
and `pwPassword` from state and posts both together.

### 4. Error handling

- If `login-with-password` fails (e.g. wrong password), stay on Stage 2
  and show `pwError` as today — the user shouldn't be bounced back to
  Stage 1 just because the password was wrong.
- Clear `pwError` when "Change" is clicked, so a stale error doesn't
  linger after switching the email.

### 5. Scope check — where the two-stage form applies

Same three render conditions as today, just swapped to the staged version:
`loginMode === 'password'`, `loginMode === null` (still loading, dual
render), and `loginMode === 'maintenance' && adminOverride`.

---

## Out of Scope / Unaffected

- `select` mode (organization/user dropdown) — unchanged.
- `maintenance` mode notice — unchanged.
- Backend `POST /api/auth/login-with-password` — unchanged; still receives
  both fields in a single request at submit time.
- No new validation of "does this email exist" at Stage 1 — keeping it
  purely a UI split avoids adding a new endpoint/round trip and avoids
  leaking whether an email exists before password entry (better security
  posture than a stage-1 lookup would be anyway).

---

## Open Questions

1. Should pressing **Enter** in the Stage 1 email field submit the form
   (advance to Stage 2)? Default assumption: **yes**, using a native
   `<form onSubmit>` so Enter behaves the same as clicking the button.
2. Should the "Continue to Log in >" button be disabled purely on
   `!pwEmail`, or should it also validate email format client-side before
   allowing continue? Default assumption: rely on the `type="email"` +
   `required` native browser validation (same level of validation used
   elsewhere in this form today).
