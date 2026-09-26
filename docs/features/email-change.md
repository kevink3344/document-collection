# Email Change Feature — Summary

> **Status:** Implemented
> **Goal:** Allow a user to change the email address / password they sign into the app with, and send a notification email (via SMTP2Go) when the email is changed.

---

## How the "must change password" flag works today

The `must_change_password` flag is set to `1` (true) when:
- A user is created with the default password (`POST /api/users`)
- An admin resets a user's password (`PUT /:id/reset-password`)

It's cleared to `0` only when the user successfully changes their password via `/api/auth/change-password`.

### Client-side behavior (where the user sees it)

`client/src/components/layout/DefaultPasswordBanner.tsx` shows a dismissible amber banner on the home page:

> **"You're using a temporary password. We recommend changing it."**

The banner is **purely advisory**:
- It's **dismissible** — there's an `X` button that hides it (stored in `sessionStorage`)
- It says **"recommend"** — not "required"
- A **Change Password** link takes the user to `/change-password`, but nothing forces them there
- There's **no routing guard** or redirect that blocks the user from using the rest of the app

### Server-side behavior

There's **no middleware or enforcement** that blocks API calls or redirects based on `must_change_password`. The flag is only used to inform the client banner. Even if a user never changes it, all functionality remains accessible.

---

## Summary: Is changing the password required or recommended?

| Aspect | Required? |
|--------|-----------|
| Banner shown | Yes, but dismissible |
| User blocked from using app | **No** |
| Message wording | "**We recommend** changing it" |
| Server enforces change | **No** |

**Bottom line:** The user can keep using the default password indefinitely and simply dismiss the warning. It is **recommended**, not required.
