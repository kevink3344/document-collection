# App Demo Plan

**Date:** 2026-08-13
**Author:** Copilot
**Status:** Draft — for upcoming demo
**Related:** `docs/APPLICATION_GUIDE.md`, `docs/features/org-filter.md`, `docs/features/preview-csv.md`, `docs/plans/placeholder-image.md`

---

## Goal

A 20–30 minute walkthrough that shows the end-to-end lifecycle: **users → collections → submissions → review/reporting**. Each bullet below is a demo beat with what to show, what to say, and a quick click-path.

---

## Prerequisites (1 min before demo)

- Login Mode set to `select` with `ORG_LIST="HRS,TST"` so the org picker is short and predictable.
- Seed data: 1 org (HRS), 2 users (Administrator + User), 1 published collection with 2 pages + branching, 3–5 sample submissions, 1 gallery image.
- Have a second browser/incognito window ready to show the **User** view vs **Administrator** view side-by-side.

---

## Demo Flow — 10 Beats

### 1. Login & Organization Context (2 min)
**Show:** Login page with org dropdown filtered by `ORG_LIST`, user picker, live stats under the form, title-bar org switcher.
**Say:** "Single login, multi-org access. Operators can restrict which orgs appear in Select-User mode via an env allowlist — no code change."
**Click-path:** `LoginPage` → pick HRS → pick Administrator → note header shows `HRS` + location icon → click icon to show org switcher.

### 2. Adding & Managing Users (3 min)
**Show:** Settings → Users → Invite by email, role assignment (`super_admin` / `administrator` / `reviewer` / `user`), multi-org membership, Accept Invite flow.
**Say:** "Invite is email-based; invited users set their own password. Roles are org-scoped — a Reviewer can be granted access to specific collections without full admin rights."
**Click-path:** Settings → Users → Invite User → show role dropdown → show user row with org badges → (optional) open Accept Invite link in incognito.

### 3. Organizations & Locations (1–2 min)
**Show:** Organizations CRUD, auto-seeded "General" category, Locations scoped to org.
**Say:** "Everything — collections, categories, locations, gallery — is org-scoped. Locations let you tag where a submission happened."
**Click-path:** Settings → Organizations → Create/Edit → Settings → Locations → add a location.

### 4. Adding Collections — Collection Builder (4 min)
**Show:** Create collection → drag-and-drop field reordering, field types (text, single-choice, multi-choice, date, file, etc.), multi-page forms, autosave + draft/publish, cover photo from gallery with **placeholder options** (No cover / Use default / Select gallery), QR code.
**Say:** "Builder autosaves and keeps a localStorage draft so work survives refresh. Cover photos are gallery-first — you can also choose no cover or a default placeholder (blue SVG) for a clean look."
**Click-path:** Collections → New Collection → add 3 fields → drag to reorder → Pages → add Page 2 → set cover photo → Publish.

### 5. Branching Logic (2–3 min)
**Show:** Single-choice field → "Is this survey useful? Yes/No" → branch rules routing to different pages. Fixed visibility so rules only show for the owning field.
**Say:** "Branching is per-field and page-aware — respondents only see the path their answer triggers. Great for screening or follow-up flows."
**Click-path:** Builder → select single-choice field → Branching tab → add rule `If "No" → go to Page 3` → Preview fill page and toggle answer to show routing.

### 6. Filling & Submitting — Respondent View (2 min)
**Show:** Fill page as `user` role (simplified dashboard → card click goes straight to fill), multi-page navigation, validation, file/image upload (storage label now correctly shows SQL Server vs Turso).
**Say:** "Users see a focused dashboard. Validation is Zod-backed on both client and server, so errors are consistent."
**Click-path:** Switch to incognito `user` → Dashboard → click collection card → fill Page 1 → Next → submit → show success + My Submissions.

### 7. Records, Approvals & Tickets (2–3 min)
**Show:** Records page (reviewer/admin), approval workflow stages (sequential, any/all approvers, conditions, reminders), ticket templates linked to submissions.
**Say:** "Each submission can spawn its own approval workflow instance. Tickets give you a lightweight task layer on top of responses."
**Click-path:** Records → open submission → show Approval timeline → create ticket from template.

### 8. Reporting & AI Summaries (2 min)
**Show:** Reports dashboard, per-collection stats, AI summary page (if enabled).
**Say:** "Reporting is org-scoped and respects the same filters as export. AI summaries give a narrative roll-up for stakeholders who don't want to read every row."
**Click-path:** Reports → select collection → show charts/counts → open AI Summary.

### 9. Export CSV + Preview (2 min)
**Show:** Records → Export CSV → pick submission + ticket columns → **Preview CSV** (dedicated page, first 100 rows, exact match to download) → **Download CSV** → saved presets.
**Say:** "Preview was added so users can verify headers and rows before downloading — same `buildExportTable` path, capped at 100 rows, with a truncated notice. Presets let teams reuse column sets."
**Click-path:** Export CSV → select columns → Preview CSV → scroll sticky header table → Back → Download CSV → show preset save/load.

### 10. Settings, Gallery & Personalization (1–2 min)
**Show:** Settings tabs with drag-and-drop reordering (now persists correctly on SQL Server via composite PK fix), menu labels, gallery assets, notifications, preferences.
**Say:** "Settings layout is per-user and draggable — tabs remember their order. Gallery is org-specific, and notifications keep reviewers in the loop."
**Click-path:** Settings → drag a panel to a new tab → refresh to prove it sticks → Gallery → upload image → Notifications bell.

---

## Timing Cheat-Sheet

| Block | Minutes |
|-------|---------|
| 1 Login | 2 |
| 2 Users | 3 |
| 3 Orgs/Locations | 1.5 |
| 4 Builder | 4 |
| 5 Branching | 2.5 |
| 6 Fill | 2 |
| 7 Records/Approvals | 2.5 |
| 8 Reporting | 2 |
| 9 Export | 2 |
| 10 Settings | 1.5 |
| **Total** | **~23** + Q&A |

## Tips for Delivery

- Narrate the **role switch** explicitly ("Now I'm the end user... now I'm the reviewer") — it makes permissions tangible.
- Keep one collection as the "hero" throughout (create → branch → fill → report → export) so the story is continuous.
- If time is short, cut beats 3 and 10; never cut 4, 5, 6, 9 — they are the core loop.
- Have `http://localhost:5173` and `http://localhost:4000/api/health` + `/api/info` open in tabs to prove `dbMode: sqlserver` and `orgList: HRS,TST` if asked about deployment.

## Follow-Up / Q&A Hooks

- "How does this deploy to production?" → startup migrations auto-repair schema (e.g., `user_preferences` PK) — no manual SQL needed.
- "Can we add SSO?" → JWT HttpOnly cookie today; SSO is on the `future-improvements` roadmap.
- "Can we white-label?" → `LOGIN_SCREEN_COLOR`, `IMAGE_LOGO_URL`, and menu labels are all configurable.
