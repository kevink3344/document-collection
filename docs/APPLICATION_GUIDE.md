# Data Collection Pro — Application Guide

A full-stack document and survey collection platform built with React + TypeScript (Vite), Express, and libSQL (Turso). This guide covers every major feature area added to the application.

---

## Table of Contents

1. [Authentication & Users](#1-authentication--users)
2. [Roles & Permissions](#2-roles--permissions)
3. [Organizations](#3-organizations)
4. [Collection Builder](#4-collection-builder)
5. [Field Types](#5-field-types)
6. [Collection Fill Page](#6-collection-fill-page)
7. [Records Page](#7-records-page)
8. [Dashboard](#8-dashboard)
9. [Reports & AI Summaries](#9-reports--ai-summaries)
10. [Notifications](#10-notifications)
11. [Settings](#11-settings)
12. [Locations](#12-locations)
13. [Approval Workflows](#13-approval-workflows)
14. [Infrastructure & Database](#14-infrastructure--database)

---

## 1. Authentication & Users

### Login
- Users select their **account** and enter their password.
- The login page displays **live global stats** (organizations, collections, submissions) beneath the form.
- A configurable **subtitle badge** and **login message** can be set in Settings.

### JWT with HttpOnly Cookies
- Authentication tokens are issued as **HttpOnly cookies** (not stored in `localStorage`) to protect against XSS.

### Forgot / Reset Password
- Full forgot-password and reset-password flow via emailed reset links.

### User Invitation System
- Administrators can **invite users by email**. Invited users receive a link to the Accept Invite page where they set their own password.

### User Account Management
- Administrators can view, edit, and manage users within their organization from the Settings page.
- A user's **role** and **organization** are shown in the navigation profile dropdown.
- An auth indicator shows the currently logged-in user at a glance.

### `/me` Refresh Endpoint
- A dedicated `/me` endpoint refreshes the logged-in user's profile (name, org, role) without requiring a full re-login.

### Multi-Organization Switching
- Users can belong to **multiple organizations** while keeping a single login.
- The **active organization description** is always shown in the title bar.
- A **location icon** beside the org name opens the organization picker so users can switch their active organization without leaving the page.

---

## 2. Roles & Permissions

| Role | Access Level |
|------|-------------|
| `super_admin` | Full access across all organizations, collections, users, and reports |
| `administrator` | Full access scoped to their own organization |
| `reviewer` | Read access to collections and submissions within their org; can be granted access to specific collections |
| `user` | Dashboard-only navigation; can fill out and submit assigned collections |

- **Super Admin**: Can view and manage all organizations, access all reports, and override org-scoped restrictions.
- **Reviewer**: Added as a distinct role with collection-sharing capabilities — reviewers can be granted explicit access to specific collections.
- **User**: Sees a simplified dashboard; clicking a collection card goes directly to the fill page.
- Role labels and org names are shown inline in the user profile dropdown.

---

## 3. Organizations

- **Organization management**: Administrators can create, edit, and manage organizations.
- **Org-scoped data**: Collections, categories, users, and locations are all scoped to the owning organization.
- **Org description and name** are displayed in the profile menu.
- Users with access to more than one organization can switch the active org from the **title bar organization picker**.
- When a new organization is created with no categories, a default **"General"** category is automatically seeded.
- **Single login, multi-org access**: Users sign in once, then switch among their allowed organizations from the header.

---

## 4. Collection Builder

### Core Builder
- Drag-and-drop **field reordering** within a collection.
- Real-time **autosave** — changes are saved automatically while editing. Autosave is debounced and does not fire on the initial page load (React 18 concurrent mode safe).
- **Draft / Publish workflow**: Collections start as drafts; administrators explicitly publish them to make them available for respondents.
- **LocalStorage draft saving**: Unsaved changes to a draft are preserved in `localStorage` so work is not lost on page refresh.
- **Gallery-first cover photos**: Cover photos are now chosen from an organization-specific gallery instead of being uploaded directly inside the builder.

### Multi-Page Forms
- Collections can be split across **multiple pages**; respondents navigate forward/back through pages.

### Version History & Comparison
- A **version badge** on collection cards shows the current version number.
- A **version comparison tab** in the editor lets administrators diff two versions of a collection side-by-side.

### Collection Branching
- **Single-choice branching**: A single-choice field can route respondents to different pages depending on their answer.

### Approval Workflows
- Collections can now include a built-in **approval workflow definition**.
- Administrators can configure **sequential approval stages** directly in the Collection Builder.
- Each stage can use **all approvers required** or **any approver can approve** behavior.
- Approvers can be assigned by **specific user** or by **role**.
- Each stage supports **optional conditions** so the stage only runs when submitted field values match the configured rule.
- Each stage supports **reminder** and **escalation** timers measured in hours.
- Workflow definitions live on the **Collection**; each submission creates its own **workflow instance** at submit time.

### Template Library
- A **collection template library** provides pre-built collection structures that administrators can load as a starting point.

### Collection Sharing
- Collections can be shared with specific **Reviewer** users, granting them read access to responses without full administrator privileges.

### QR Code
- Each published collection has a configurable **QR code** that links directly to the fill page.

### Survey Instructions & Review Flow
- A configurable **instructions block** appears at the start of the fill page.
- A **review step** lets respondents check their answers before final submission.
- A **time estimate** can be configured and displayed to respondents.

### Anonymous Submissions
- An **anonymous toggle** on the collection hides respondent identity from records.

### Copy-of-Answers Email
- An optional **copy-of-answers email** can be sent to respondents upon submission.

### Per-User Card Reordering
- Each user can independently **reorder collection cards** on their dashboard; the order is persisted per user.

---

## 5. Field Types

| Type | Description |
|------|-------------|
| **Text** | Single-line or multi-line free text input |
| **Single Choice** | Radio-button group; supports configurable display styles and branching logic |
| **Multiple Choice** | Checkbox group; supports an **"Other" free-text option**; responses display as a bullet list in Records |
| **Rating** | Star/numeric rating; configurable **display style** (stars, numbers, etc.) |
| **Matrix / Likert Scale** | Grid of rows × columns for scaled responses; fully responsive on mobile |
| **Date** | Date picker input |
| **Location** | Dropdown linked to org-scoped locations; supports optional authentication (public access or scoped) |
| **Student ID** | Text field validated against a configured webhook when the respondent leaves the field. See [Webhooks](#14-webhooks). |
| **Signature** | Canvas-based signature capture; renders as an inline image preview in Records |
| **Comment (Read-Only)** | Non-interactive inline text block shown to respondents; supports a **rich-text editor** for formatting |
| **List** | Column-list input type |

### Field Subtitles
- Every field type supports an optional **subtitle** (helper text) displayed beneath the field label on the fill page.

### Staff-Only Fields
- Fields can be marked **staff-only**, making them invisible to respondents and only editable by administrators/reviewers in Records.

---

## 6. Collection Fill Page

- Respondents access collections via a direct URL or QR code — **no login required** for public collections.
- Multi-page navigation with forward/back controls.
- **Confirmation field**: A final checkbox that respondents must tick before submitting. Renders a heading, an optional subtitle, and the checkbox — no duplicate label.
- **Rich-text instructions** rendered as formatted HTML.
- **Review step** before final submission.
- **Signature** field with canvas drawing.
- **"Other"** free-text input on single/multiple choice fields.
- **Branching**: Single-choice answers can skip respondents to a specific page.
- **Student ID validation**: Student ID fields are checked against the organization's validation webhook when the field loses focus. A rejected value shows *"Please enter a valid student id"* and blocks submission; the server re-validates on submit so the check cannot be bypassed.

---

## 7. Records Page

### Summary Tab
- Aggregate charts and statistics across all submissions for the selected collection.
- **Submission trendline chart** showing volume over time (built with Recharts).
- Per-field response breakdowns.

### Individual Tab
- Paginated list of individual submissions displayed as **cards**.
- **Table / Spreadsheet view**: Toggle between card view and a spreadsheet-style table.
- **Submission edit flow**: Administrators can edit any submission's field values directly in the Records page.
- Each response now carries its **approval workflow summary**, including the active stage and overall approval status.

### Staff Notes
- Staff-only fields appear in each submission card for administrators to fill in.
- **Audit trail**: When a staff note is saved, the editor's **name** and a **timestamp** are recorded and displayed beneath the field value (e.g., `Updated by Amy Smith · May 28, 2026, 2:11 PM`).

### Multiple Choice Display
- Multiple-choice responses are displayed as a **bulleted list** rather than a comma-separated string.

### Signature Preview
- Signature responses are rendered as an **inline image** directly within the submission card.

### Comments Tab (Individual View)
Each submission card in Individual view has two tabs: **General** and **Comments**.

**General tab** — existing field values and staff notes.

**Comments tab**:
- Threaded comment view with **avatar initials bubble**, commenter name, timestamp, and comment body.
- A **count badge** on the tab label shows the number of comments (e.g., `Comments 3`).
- **Add a comment**: Text area with a Post button; pressing **Enter** submits, **Shift+Enter** inserts a newline.
- **Delete**: Users can delete their own comments; administrators and super admins can delete any comment.
- **Auto-refresh**: The comment thread polls the server every **60 seconds** while the Comments tab is open; polling stops when switching back to General or changing collection.

---

## 8. Dashboard

- Displays collections grouped by **category**, each with a badge showing the category name and collection count.
- Per-category **submission counts** are shown inline on collection cards.
- Global **dashboard stats** (total collections, submissions, users) at the top.
- A custom **table icon** on collection cards links to Records.
- **Relative timestamps** on recent activity.

---

## 9. Reports & AI Summaries

### Reports Page
- **KPI cards**: Total submissions, active collections, completion rate, and more.
- **Charts**: Submission volume trends, per-collection breakdowns, performance tables.
- **User activity table**: Shows submission counts per user.

### AI Summaries (Groq)
- Integrated with **Groq** to generate natural-language summaries of report data.
- **Survey-scoped summaries**: AI summaries can be generated per collection.
- **Admin AI Summary page**: A dedicated page for super admins to generate and view AI summaries across all organizations.
- Groq failure reasons are surfaced in the UI when the AI call fails.

---

## 10. Notifications

- **In-app notification system**: Real-time notifications for key events (new submissions, invitations, etc.).
- A **notification badge** on the nav icon shows unread count.
- **Relative timestamps** (e.g., "2 minutes ago") on notification items.
- Approval workflows also use the notification system for **stage assignment**, **SLA reminders**, and **escalation alerts**.

---

## 11. Settings

### Tabbed Layout
- Settings are organized into tabs with **drag-and-drop panel reordering** so administrators can arrange the settings layout to their preference.

### Branding
- Upload a **custom logo** displayed on the survey banner and fill page.
- Configurable **logo padding** (pixel-level control).
- Configurable **QR code** appearance per collection.
- A **Cover Photo Gallery** panel lets administrators upload organization-specific gallery images for later use in the Collection Builder.
- Gallery images can only be **deleted when unused**; in-use images show a usage count and remain protected until they are removed from all collections.

### Login Page
- Set a custom **subtitle badge** and **login message** that appear on the public login screen.

### Categories
- Create, edit, and delete **categories** scoped to the organization.
- Categories are used to group collections on the dashboard.

### User Management
- View, invite, edit, and remove users within the organization.

---

## 12. Locations

- A **Location field type** lets collection designers link a field to a list of named locations.
- Locations are **org-scoped**: each organization manages its own location list.
- The locations API supports **optional authentication** — public fill pages can load locations without a login token, while scoped routes enforce org membership.

---

## 13. Approval Workflows

### Collection-Level Workflow Design
- Approval workflows are configured on the **Collection**, not on individual submissions.
- A collection workflow acts as the reusable **template definition** for how requests should be approved.
- When a respondent submits a form, the system creates a **workflow instance** for that specific response.

### Sequential and Parallel Approval Patterns
- A collection can define multiple approval stages in sequence.
- Each stage supports one of two approval modes:
	- **All approvers required**: every assigned approver must approve before the workflow moves forward.
	- **Any approver can approve**: one approval is enough to advance the workflow.
- Stages can be routed to:
	- specific named users
	- organization-scoped roles such as `administrator`, `team_manager`, `reviewer`, or `user`

### Conditional Workflow Routing
- Each stage can include an optional **field-based condition**.
- Conditions evaluate submitted response values using operators such as:
	- equals / does not equal
	- greater than / less than
	- contains
	- is empty / is not empty
- This allows patterns such as:
	- route Finance approval only when `amount > 500`
	- add a manager stage only when `department = Operations`
	- skip a stage entirely when a controlling field is blank

### SLAs, Reminders, and Escalations
- Each workflow stage supports a **reminder window** and an **escalation window**.
- If a stage remains pending beyond the reminder threshold, the system sends a **reminder notification**.
- If a stage remains pending beyond the escalation threshold, the system marks the stage as **escalated** and sends a higher-priority escalation notification.
- SLA checks run as part of the server's recurring background notification sweep.

### Approval Lifecycle
- Workflow instances track:
	- overall workflow status
	- active stage name and order
	- stage-by-stage approval state
	- per-approver decision status
	- reminders and escalation timestamps
- Approvers can approve or reject the active stage.
- Rejection ends the workflow in a **rejected** state.
- Approval advances to the next applicable stage until the workflow is **approved**.

### Admin Experience
- The **Collection Builder** includes an Approval Workflow section in the General tab.
- Administrators can:
	- enable or disable approval workflows per collection
	- add and remove stages
	- choose approval mode per stage
	- assign users or roles as approvers
	- add one conditional routing rule per stage
	- configure reminder and escalation hours

### Runtime Behavior
- Workflow instances are created automatically when a response is submitted.
- Workflow notifications link staff back into the application so they can review the request in context.
- Response data now includes workflow summary data for downstream records and reporting views.

---

## 14. Webhooks

Webhooks let an organization connect collection forms to external systems. Configure them in **Settings → Webhooks** (Administrators and Super Admins only). Each organization has at most one of each type.

### Webhook 1 — Field Validation

Called when a respondent leaves a **Student ID** field. The server proxies the call, so the URL and secret never reach the browser.

**Request** — `POST <url>`, `Content-Type: application/json`:

```json
{
  "value": "A12345678",
  "fieldKey": "field-42",
  "fieldLabel": "Student Id",
  "collectionSlug": "enrollment-form",
  "organizationId": 1
}
```

`X-Webhook-Secret` is sent **only** when a secret is configured. Leave it blank for Power Automate and other unsigned endpoints.

**Response** — HTTP 2xx plus a body in the configured *response shape*:

| Shape | Expects |
|-------|---------|
| `JSON boolean` (default) | `{ "valid": true }` |
| `JSON string` | `{ "valid": "true" }` |
| `Plain text` | `true` |

The JSON key is configurable (default `valid`), so `isValid`, `result`, etc. work without a code change. Accepted values (case-insensitive): `true/1/yes/y/valid` and `false/0/no/n/invalid`.

### Webhook 2 — Submission Forwarding

Called after a response is saved. Fire-and-forget: a slow or failing endpoint never blocks the respondent.

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
    { "fieldKey": "field-42", "label": "Student Id", "type": "short_text", "value": "A12345678" }
  ]
}
```

### Behaviour Notes

- Every attempt is recorded in **Recent deliveries** (status, HTTP code, duration, raw response body). The newest 200 per webhook are kept.
- **Test** sends a sample payload without creating a real submission.
- Disabling webhook 1 makes Student ID fields always valid; disabling webhook 2 stops forwarding.
- One validation webhook applies to every Student ID field in a form.

### Where to configure it

**Settings → Webhooks** (Administrators and Super Admins). It sits in the **General** tab next to *Ticket Activity*.

### Production deployment

The webhook tables are created automatically at startup on Azure App Service. If the app's database login lacks `CREATE TABLE` permission, the bootstrap logs a clear instruction and the feature returns **503 `WEBHOOKS_TABLES_MISSING`** until an admin runs `server/scripts/webhooks-sqlserver.sql` once. See `SQL_SERVER_MIGRATION_LOG.md`. Set `SQLSERVER_BOOTSTRAP_DDL=false` to skip the startup attempt.

> **Adding a new Settings panel later?** Three separate lists must be updated, or the panel will be invisible or unusable:
> 1. `PanelId` / `PANEL_LABELS` / `ALL_PANEL_IDS` / `DEFAULT_PANEL_LAYOUT` in `SettingsPage.tsx`
> 2. `VISIBILITY_CHECKLIST_IDS` in `server/src/routes/settings.ts`
> 3. `VISIBILITY_ADDED_LATER` in `server/src/routes/settings.ts` — otherwise a previously saved visibility list silently hides the new panel for non-super-admins.

---

## 15. Infrastructure & Database

### Database
- **libSQL (Turso)** remote database as the primary store; falls back to a local **SQLite** file for development.
- Connection is configured via `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` environment variables.
- **WAL mode** fallback for cloud deployment environments.
- Graceful recovery from corrupted SQLite files on startup.

### Migrations
- Schema migrations run automatically on server startup via `runMigrations()` in `db.ts`.
- **Migration tracking**: Each migration is recorded so it only runs once, even across restarts.
- `CREATE TABLE IF NOT EXISTS` guards prevent duplicate table creation.
- `ALTER TABLE` migrations add columns to existing tables safely.

### Key Tables
| Table | Purpose |
|-------|---------|
| `users` | User accounts with role, org, and password hash |
| `organizations` | Organization records |
| `collections` | Collection definitions (title, status, version, settings) |
| `collection_fields` | Individual fields within a collection |
| `collection_responses` | One row per submission |
| `collection_response_values` | One row per field value per submission; includes `staff_updated_by_name` and `staff_updated_at` audit columns |
| `submission_comments` | Staff comments on individual submissions (linked to response + user) |
| `categories` | Org-scoped categories |
| `locations` | Org-scoped location list |
| `notifications` | In-app notification records |
| `invitations` | Pending user invitations |
| `user_settings` | Per-user preferences (card order, display settings) |
| `settings` | Org-level and global settings (branding, login page) |

### API
- RESTful Express API with **Swagger / OpenAPI** documentation.
- A `/health` endpoint for uptime monitoring.
- All authenticated routes use **JWT middleware**; super_admin routes enforce the elevated role.

### Deployment
- **GitHub Actions CI/CD** deploys to **Azure App Service** on push to `main`.
- Static client assets are built with **Vite** and served by the Express server in production.

---

*Last updated: May 28, 2026*
