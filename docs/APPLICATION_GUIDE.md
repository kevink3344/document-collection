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
13. [Infrastructure & Database](#13-infrastructure--database)

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

### Multi-Page Forms
- Collections can be split across **multiple pages**; respondents navigate forward/back through pages.

### Version History & Comparison
- A **version badge** on collection cards shows the current version number.
- A **version comparison tab** in the editor lets administrators diff two versions of a collection side-by-side.

### Collection Branching
- **Single-choice branching**: A single-choice field can route respondents to different pages depending on their answer.

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

---

## 11. Settings

### Tabbed Layout
- Settings are organized into tabs with **drag-and-drop panel reordering** so administrators can arrange the settings layout to their preference.

### Branding
- Upload a **custom logo** displayed on the survey banner and fill page.
- Configurable **logo padding** (pixel-level control).
- Configurable **QR code** appearance per collection.

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

## 13. Infrastructure & Database

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
