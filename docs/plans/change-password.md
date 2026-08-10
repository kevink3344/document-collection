# Plan: Self-Service "Change Password" Page (Replace Forced Modal)

**Date:** 2026-08-10
**Status:** Draft — awaiting review before implementation
**Primary files:** `client/src/App.tsx`, `client/src/components/layout/TopNavBar.tsx`,
`client/src/pages/ChangePasswordPage.tsx` (new), `client/src/components/common/ChangePasswordModal.tsx` (removed/replaced)

---

## Summary

Today, a user created with a default password (`DEFAULT_USER_PASSWORD`) or
whose password was reset by an admin is **forced** to change it via a
full-screen, blocking modal (`ChangePasswordModal`) before they can use any
part of the app. This has been the source of a hard-to-diagnose production
bug (the modal sometimes doesn't close) and is also a worse experience than
necessary — a locked-out user can't do anything until the modal succeeds.

The new approach: **drop the blocking requirement entirely.** Users log in
normally with their default password and use the app right away. A
non-blocking reminder appears after login if they still need to change
their default password, and they can change it any time from a
"Change Password" link in the user profile dropdown (hover/click their name
in the top nav), which takes them to a dedicated page. The link is hidden
for select-mode users (accounts with no password at all).

---

## Current State

- `client/src/App.tsx` (~line 53) renders `<ChangePasswordModal>` on top of
  everything whenever `user.mustChangePassword && user.role !== 'super_admin'`.
- `client/src/components/common/ChangePasswordModal.tsx` is a full-screen
  overlay with Current/New/Confirm password fields. On success it calls
  `clearMustChangePassword(updatedUser)` from `AuthContext`.
- Backend endpoint `POST /api/auth/change-password` (in `server/src/routes/auth.ts`)
  already does exactly what's needed: verifies `currentPassword`, hashes and
  saves `newPassword`, sets `must_change_password = 0`, re-issues the auth
  cookie, and returns the updated user. **No backend changes required** —
  this plan only changes how/when the client surfaces this functionality.
- `must_change_password` is still set to `1` by:
  - `POST /api/users` (new user created with a default password)
  - `POST /api/users/:id/reset-password` (admin resets a user's password)
- `client/src/components/layout/TopNavBar.tsx` (~line 300) has the user
  profile dropdown with "About" and "Sign out" buttons.

---

## Proposed Changes

### 1. Remove the blocking modal

In `client/src/App.tsx`, delete the `ChangePasswordModal` render and its
import. Users are never blocked from using the app regardless of
`mustChangePassword`.

`ChangePasswordModal.tsx` can be deleted, or its form JSX repurposed into
the new page (see below) to avoid rewriting the UI from scratch.

### 2. New page: `client/src/pages/ChangePasswordPage.tsx`

A normal routed page (not an overlay), styled consistently with other
simple pages (e.g. `AboutPage.tsx`): a card with a heading, description,
and a form with:

- Current Password
- New Password (min 8 characters, same validation as today)
- Confirm New Password

Submits to the existing `POST /api/auth/change-password` endpoint. On
success:
- Show an inline success message ("Password changed successfully.") instead
  of navigating away, and update the user in `AuthContext` via
  `clearMustChangePassword(updatedUser)` (rename optional — see Open
  Questions) so the top-nav dropdown reflects state without page needing
  `mustChangePassword` for gating.
- Clear the form fields.

On error, show the existing inline error banner (wrong current password,
password too short, etc.) — same behavior as today's modal, just on a page
instead of an overlay.

### 3. New route

In `client/src/App.tsx`, add a route inside the authenticated section
(available to every role, since anyone with a password can use it):

```tsx
<Route path="/change-password" element={<ChangePasswordPage />} />
```

Placed alongside `/about` and `/notifications` (no special role
restriction needed).

### 4. Expose a `hasPassword` flag to the client

The client currently has no way to distinguish a select-mode user (no
password) from a password-mode user, since `mustChangePassword` is `false`
for both "select-mode" and "already changed their password" accounts.

Add `hasPassword: boolean` to `toApiUser()` in `server/src/lib/userAccess.ts`
(derived from `Boolean(profile.passwordHash)`), and to the `User` type in
`client/src/types/index.ts`. This is a boolean only — the hash itself is
never sent to the client.

### 5. Profile dropdown link (hidden for select-mode users)

In `client/src/components/layout/TopNavBar.tsx`, add a new button between
"About" and "Sign out", rendered only when `user.hasPassword`:

```tsx
{user.hasPassword && (
  <button
    type="button"
    onClick={() => {
      setProfileOpen(false)
      navigate('/change-password')
    }}
    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#64748B] hover:bg-[#F1F5F9] dark:hover:bg-[#1E293B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9] transition-colors"
  >
    <KeyRound size={14} />
    Change Password
  </button>
)}
```

### 6. Non-blocking "default password" reminder

Replace the forced modal with a dismissible reminder banner shown when
`user.mustChangePassword` is `true`. Rendered in `client/src/App.tsx` (or a
small new `DefaultPasswordBanner.tsx` component) directly under
`TopNavBar`, spanning full width — amber/warning styling consistent with
existing UI accents:

> ⚠ You're using a temporary password. [Change Password] &nbsp; [Dismiss ✕]

Behavior:
- Shown once per login session when `user.mustChangePassword` is `true`.
- Clicking "Change Password" navigates to `/change-password`.
- Clicking dismiss (✕) hides it for the rest of the session (store
  dismissal in component state or `sessionStorage`, keyed by user id — not
  `localStorage`, so it reappears on the next fresh login if the password
  still hasn't been changed).
- Automatically disappears once the user successfully changes their
  password (since `clearMustChangePassword` will update `user.mustChangePassword`
  to `false`).

### 7. Backend: one small addition

`POST /api/auth/change-password` already does everything required for the
password change itself — no changes there. The only backend change is
adding `hasPassword` to `toApiUser()` (step 4 above). `must_change_password`
continues to be set as today by user creation/reset; it now drives the
non-blocking banner instead of a blocking modal.

---

## Resolved Decisions

1. **Reminder indicator:** kept, as a dismissible non-blocking banner shown
   after login (see step 6).
2. **Select-mode users:** the "Change Password" link is hidden for them via
   the new `hasPassword` flag (see steps 4 & 5).

## Open Questions (please confirm before implementation)

4. Should super admins also see the "Change Password" link and reminder
   banner? (Today they're exempt from the forced modal.) Default
   assumption: **yes** — everyone with a password can use the self-service
   page; the exemption only ever applied to the forced-modal behavior,
   which is going away.

---

## Out of Scope

- The production 401 investigation (temporary diagnostic logging currently
  in `auth.ts` / `users.ts`) is tracked separately and will be cleaned up
  once resolved, independent of this UI change.
- No changes to the invitation or forgot-password flows.
