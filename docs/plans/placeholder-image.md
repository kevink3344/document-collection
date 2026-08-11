# Plan: Placeholder Cover Photo — "No Cover" / "Use Default" / "Select Gallery Image"

**Date:** 2026-08-11 (revised)
**Status:** Draft — awaiting review before implementation
**Primary files:** `client/src/pages/CollectionBuilderPage.tsx`, `client/src/pages/CollectionsPage.tsx`, `client/src/pages/CollectionFillPage.tsx`, `client/public/images/placeholder-cover.svg` (new), `client/src/utils/coverPhoto.ts` (new)
**Related:** `server/src/routes/collections.ts` (`cover_photo_url` / `cover_photo_asset_id`), `client/src/types/index.ts` (`Collection.coverPhotoUrl`), `client/src/pages/SettingsPage.tsx` (gallery)

---

## Executive Summary

Today the cover photo is **optional and single-path**: the builder's **Photo** tab shows a gallery `<select>`. If nothing is selected, `coverPhotoAssetId` and `coverPhotoUrl` stay `null` and every consumer renders **nothing** — `CollectionsPage` card has no image block, `CollectionFillPage` shows only the title block, builder preview shows "No cover photo selected yet."

The previous draft proposed a two-option toggle ("Use default" vs "Select gallery image") that would **always** show a cover (placeholder fallback for `null`). Feedback: **some collections should have no cover at all** — forcing a placeholder removes a valid choice.

This revised plan keeps **three explicit options** in the builder:

1. **No cover** — no image block (current behavior, preserved)
2. **Use default** — branded static placeholder SVG (no DB row, no gallery dependency)
3. **Select gallery image** — pick an existing org gallery asset (current behavior)

No DB migration is required. The placeholder is represented by a **sentinel URL** (`/images/placeholder-cover.svg`) stored in `cover_photo_url` — so `null` continues to mean "no cover" and existing collections are unaffected.

---

## Current Behavior

| Area | File | Behavior when no cover |
|------|------|------------------------|
| Builder Photo tab | `CollectionBuilderPage.tsx:1983-2120` | `<select>` + "Clear Cover" button; preview shows `<ImageIcon /> No cover photo selected yet.` |
| Collections grid | `CollectionsPage.tsx:151` | `{collection.coverPhotoUrl && <div className="h-28">…}` — no image block at all |
| Fill page banner | `CollectionFillPage.tsx:1584` | `{collection.coverPhotoUrl && <div className="h-48 md:h-64">…}` — falls back to title-only block |
| API | `server/src/routes/collections.ts:429-474` | `buildCollectionCoverPhotoUrl()` returns `null` when `coverPhotoAssetId` is null; `resolveCoverPhotoSelection()` stores `null` for both columns |

Gallery is org-scoped and requires an upload in **Settings → Cover Photo Gallery** before anything can be selected.

---

## Desired Behavior

### Builder — Photo tab (three radio cards)

```
┌──────────────────────────────────────────────────────────────┐
│ Cover Photo                                                │
│ Choose how this collection is presented.                    │
│                                                            │
│ ○ No cover   ○ Use default placeholder  ● Select gallery   │
│ ┌──────────┐ ┌─────────────────────┐ ┌──────────────────┐  │
│ │ (empty)  │ │ [placeholder thumb] │ │ [gallery select] │  │
│ │ No image │ │ "Default cover"     │ │ Select a gallery…│  │
│ └──────────┘ └─────────────────────┘ └──────────────────┘  │
│                                                            │
│ Preview: [ 44h banner — image or "No cover" empty state ]  │
└──────────────────────────────────────────────────────────────┘
```

* **No cover** (default for new collections — preserves current behavior): clears `coverPhotoAssetId` and `coverPhotoUrl` on save (`null`/`null`). Preview shows the dashed "No cover photo" empty state (as today). No gallery fetch required.
* **Use default**: stores `coverPhotoAssetId: null` + `coverPhotoUrl: '/images/placeholder-cover.svg'` (sentinel). Preview shows the placeholder SVG. No gallery fetch required.
* **Select gallery image**: shows the existing `<select>` + asset meta + usage count. On change, sets `coverPhotoAssetId` and `coverPhotoUrl` to `/api/collections/public/${slug}/cover-photo` (as today). If gallery is empty, show the dashed empty state + link to Settings, but keep the other two options selectable.
* Persisted choice is derived from stored values (no new column):
  * `coverPhotoAssetId != null` → gallery
  * `coverPhotoUrl === '/images/placeholder-cover.svg'` → default
  * otherwise (`null`) → no cover
* "Clear Cover" button is removed — replaced by the radio selection.

### Consumers — respect the three states

* `CollectionsPage` card:
  * `coverPhotoUrl == null` → no image block (as today)
  * `coverPhotoUrl === PLACEHOLDER_COVER_URL` → render `h-28` block with placeholder SVG
  * otherwise → render `h-28` block with gallery image
* `CollectionFillPage` banner: same branching. Banner `h-48 md:h-64` only renders when there is a cover (placeholder or gallery); otherwise show the title-only block (as today).
* Builder preview: same branching — never forces a cover when "No cover" is selected.

### Default image — static asset, not a DB row

* File: `client/public/images/placeholder-cover.svg` (served statically, no auth, cacheable) — already created, preview at `/images/preview.html` (temporary)
* Helper: `client/src/utils/coverPhoto.ts` exports `PLACEHOLDER_COVER_URL`, `getCoverPhotoKind(url, assetId)`, and `resolveCoverPhotoUrl(url)` for consistent branching
* No seeding per organization. No `gallery_assets` row. Keeps the placeholder free of org scoping, storage-location logic (`local:` vs Drive), and delete protection.

---

## Default Image Design

### Recommended design (Option A — "Branded Gradient + Document")

A single SVG that looks good at `h-28` (card), `h-44` (builder preview), and `h-48 md:h-64` (fill banner), in both light and dark contexts (the image itself is self-contained, not theme-dependent).

**Spec:**

* **Size:** `1200×600` viewBox (2:1), `object-cover` crops gracefully to any aspect.
* **Background:** linear gradient `135deg` from `#2563EB` (brand blue) → `#1E293B` (slate-800). Subtle diagonal grid pattern at `6%` opacity for texture.
* **No center icon** — clean gradient only (per feedback). Title is overlaid by the page, not baked in.
* **No text** inside the SVG (avoids i18n and keeps it reusable).
* **File size:** < 2 KB, no embedded fonts or bitmaps.

**Why this works:**

* Matches existing palette (`#2563EB`, `#1E293B`, `#F1F5F9`) used in builder tabs and cards.
* Clean gradient reads as a polished cover without competing with the overlaid title.
* Works when cropped to `h-28` and when darkened with `bg-black/30` overlay on fill page.
* No photography licensing, no per-org customization needed for v1.

**SVG (already created at `client/public/images/placeholder-cover.svg`):**

```svg
<svg viewBox="0 0 1200 600" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Default cover">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2563EB"/><stop offset="100%" stop-color="#1E293B"/>
    </linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0 H0 V40" fill="none" stroke="white" stroke-opacity="0.06" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="1200" height="600" fill="url(#g)"/>
  <rect width="1200" height="600" fill="url(#grid)"/>
</svg>
```

Keep the file at `client/public/images/placeholder-cover.svg` and reference as `/images/placeholder-cover.svg`.

### Alternatives considered

* **Option B — Photography placeholder** (e.g., abstract office/desk photo): looks richer but adds ~200 KB, licensing questions, and crops poorly at `h-28`.
* **Option C — Per-organization placeholder gallery asset** (seed a `gallery_assets` row per org): makes placeholder deletable/editable and org-scoped, but couples a static fallback to DB/storage-location logic and requires a migration/seed. Rejected for v1; can be added later as "custom default" if requested.

---

## Scope

### In scope

* New static placeholder SVG + helper (SVG already created)
* Builder Photo tab: 3-way radio toggle "No cover" / "Use default" / "Select gallery image" with preview that respects the selection
* Collections grid + Fill banner: branch on `null` vs placeholder sentinel vs gallery URL
* Builder preview: same branching

### Out of scope

* DB migration / new column (not needed — sentinel URL distinguishes "default" from "no cover")
* Uploading a custom default per org (future enhancement)
* Changing `gallery_assets` storage or Settings gallery UI
* Migrating existing collections (they already have `null` → will continue to show "No cover", preserving current behavior)

---

## Step-by-Step Implementation Guide

### Phase 1 — Static asset + helper (no UI yet)

**Step 1.1: `client/public/images/placeholder-cover.svg` — DONE**

* File already created. Verify it is served at `http://localhost:5173/images/placeholder-cover.svg` (Vite serves `public/` at root). Remove temporary `preview.html` before commit.

**Step 1.2: Create `client/src/utils/coverPhoto.ts`**

```ts
export const PLACEHOLDER_COVER_URL = '/images/placeholder-cover.svg'

export type CoverPhotoKind = 'none' | 'placeholder' | 'gallery'

export function getCoverPhotoKind(
  coverPhotoUrl: string | null | undefined,
  coverPhotoAssetId: number | null | undefined,
): CoverPhotoKind {
  if (coverPhotoAssetId != null) return 'gallery'
  if (coverPhotoUrl === PLACEHOLDER_COVER_URL) return 'placeholder'
  if (coverPhotoUrl?.trim()) return 'gallery' // legacy direct URL
  return 'none'
}

export function getCoverPhotoUrl(
  coverPhotoUrl: string | null | undefined,
  coverPhotoAssetId: number | null | undefined,
): string | null {
  const kind = getCoverPhotoKind(coverPhotoUrl, coverPhotoAssetId)
  if (kind === 'none') return null
  if (kind === 'placeholder') return PLACEHOLDER_COVER_URL
  return coverPhotoUrl!.trim()
}
```

* Unit test: `coverPhoto.test.ts` — `null` → `none`/`null`, placeholder sentinel → `placeholder`, assetId → `gallery`, valid URL → `gallery`.

### Phase 2 — Builder Photo tab

**File:** `client/src/pages/CollectionBuilderPage.tsx`

* State: add `coverPhotoMode: 'none' | 'placeholder' | 'gallery'` derived from `coverPhotoAssetId`/`coverPhotoUrl` on load:
  * `assetId != null` → `'gallery'`
  * `coverPhotoUrl === PLACEHOLDER_COVER_URL` → `'placeholder'`
  * otherwise → `'none'`
* On `applyCollectionToForm()`: set `coverPhotoMode` accordingly.
* On `buildPayload()`: 
  * `none` → send `coverPhotoAssetId: null`, `coverPhotoUrl: null` (or omit) → server stores `null`/`null` via `resolveCoverPhotoSelection`
  * `placeholder` → send `coverPhotoAssetId: null`, `coverPhotoUrl: PLACEHOLDER_COVER_URL` → server stores `null` + sentinel
  * `gallery` → send as today (`coverPhotoAssetId` + derived URL)
* UI: replace "Clear Cover" + bare `<select>` with:
  * Three radio cards (styled like Document Storage cards in Settings) — "No cover" (empty state icon), "Use default" (small placeholder thumb + "Branded default cover"), "Select gallery image" (shows gallery `<select>` when active).
  * When `gallery` is active but `galleryAssets.length === 0`, show the dashed empty state inside that card.
  * Preview block branches: `none` → dashed "No cover photo" empty state; `placeholder` → `h-44` banner with placeholder SVG + title overlay; `gallery` → `h-44` banner with gallery image + title overlay.
* Keep `useEffect` that loads gallery only when `detailsTab === 'photo'` (or when mode switches to gallery).

### Phase 3 — Consumers

**File:** `client/src/pages/CollectionsPage.tsx:151`

```tsx
import { PLACEHOLDER_COVER_URL, getCoverPhotoKind } from '../utils/coverPhoto'
// ...
const kind = getCoverPhotoKind(collection.coverPhotoUrl, collection.coverPhotoAssetId)
{kind !== 'none' && (
  <div className="h-28 bg-[#F1F5F9] dark:bg-[#0F172A] overflow-hidden">
    <img
      src={kind === 'placeholder' ? PLACEHOLDER_COVER_URL : collection.coverPhotoUrl!}
      alt=""
      className="w-full h-full object-cover"
      onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
    />
  </div>
)}
```

**File:** `client/src/pages/CollectionFillPage.tsx:1584`

Same helper. Banner `h-48 md:h-64` only renders when `kind !== 'none'`; otherwise show the title-only block (as today). Keep the `bg-[#1E293B]` fallback behind the image.

**File:** `client/src/pages/CollectionBuilderPage.tsx` preview: replace the `coverPhotoUrl ? … : …` conditional with the three-way branch above.

**Optional:** `client/src/pages/CollectionBranchingPage.tsx:40` — if it shows a cover, apply same helper.

### Phase 4 — Polish

* Add `alt=""` (decorative) for placeholder; keep `alt` for gallery images if available.
* Ensure `onError` hides broken gallery URLs but does not hide placeholder (placeholder is local, should not 404).
* Verify dark mode: placeholder is self-contained, no extra dark variant needed.
* Remove `client/public/images/preview.html` (temporary preview file).
* Run `tsc --noEmit` for client and server, `npm run build`.

---

## Data & API

* **No schema change.** `collections.cover_photo_url` and `cover_photo_asset_id` stay nullable.
  * `null` / `null` → **No cover** (preserves current behavior for all existing collections)
  * `null` / `'/images/placeholder-cover.svg'` → **Use default placeholder**
  * `assetId` / `'/api/collections/public/${slug}/cover-photo'` → **Gallery image** (as today)
* **No API change required for v1.** `POST /api/collections` and `PUT /api/collections/:id` already accept `coverPhotoAssetId: number | null` and `coverPhotoUrl?: string` (`server/src/lib/schemas.ts:257-258`, `server/src/routes/collections.ts:436-474`). Sending `coverPhotoAssetId: null` + `coverPhotoUrl: '/images/placeholder-cover.svg'` will be stored as-is via `resolveCoverPhotoSelection` (which already handles `assetId === null` → store `coverPhotoUrl` as-is). No server code change needed unless we want to validate the sentinel explicitly.
* **Backwards compatible:** existing collections with `coverPhotoUrl = null` continue to show "No cover" after the frontend change — no backfill, no visual change unless the user explicitly picks "Use default".
* **Future option:** if we need to distinguish "explicitly chose default" from "never set" more robustly, add a `cover_photo_source: 'none' | 'placeholder' | 'gallery'` column then — not needed for v1 since the sentinel URL is sufficient and the placeholder is a static asset that will not collide with gallery URLs.

---

## Files to Modify

| File | Change |
|------|--------|
| `client/public/images/placeholder-cover.svg` | **New** — branded placeholder SVG (already created) |
| `client/src/utils/coverPhoto.ts` | **New** — `PLACEHOLDER_COVER_URL`, `getCoverPhotoKind()`, `getCoverPhotoUrl()` |
| `client/src/utils/coverPhoto.test.ts` | **New** — unit tests for helper |
| `client/src/pages/CollectionBuilderPage.tsx` | Photo tab 3-way radio toggle, preview branching, payload logic |
| `client/src/pages/CollectionsPage.tsx` | Card branches on `none` vs `placeholder` vs `gallery` |
| `client/src/pages/CollectionFillPage.tsx` | Banner branches on `none` vs `placeholder` vs `gallery` |
| `client/src/pages/CollectionBranchingPage.tsx` | Optional — same branching if it renders cover |

No server changes required for v1 (sentinel URL is stored as-is).

---

## Acceptance Criteria

* [ ] `GET /images/placeholder-cover.svg` returns the SVG (200, `image/svg+xml`, < 5 KB)
* [ ] New collection defaults to "No cover" — preview shows empty state, save succeeds, card and fill page show no image block (preserves current behavior)
* [ ] Switching to "Use default" shows placeholder in preview and persists sentinel; card and fill page show placeholder banner
* [ ] Switching to "Select gallery image" shows gallery `<select>`; picking an asset updates preview and persists; switching back to "No cover" or "Use default" clears the asset and persists correctly
* [ ] Existing collections with no cover still show no cover in grid and fill banner (no DB change, no visual regression)
* [ ] Collections with a gallery cover still show the gallery image everywhere
* [ ] Empty gallery: "No cover" and "Use default" are still selectable; gallery card shows empty state without blocking save
* [ ] `tsc --noEmit` (client + server) and `npm run build` pass

---

## Risks & Mitigations

* **Sentinel collision** — placeholder URL `/images/placeholder-cover.svg` will not collide with gallery URLs (`/api/collections/public/.../cover-photo`) or legacy direct URLs. Validate on server if needed.
* **Placeholder looks off when cropped** — mitigate by using a centered mark and 2:1 viewBox; test at `h-28`, `h-44`, `h-64`.
* **Caching** — static SVG is cacheable; `public/` is copied as-is. No hashing needed for v1; add `Cache-Control` via server static middleware if needed later.
* **Future custom default** — if orgs want their own default, add a `default_cover_asset_id` per org or a global setting later; current sentinel keeps that path open.

---

## Implementation Order

1. Create helper + test (Phase 1 — SVG already done)
2. Builder Photo tab 3-way toggle (Phase 2)
3. Grid + Fill branching (Phase 3)
4. Polish + build verification (Phase 4)

Estimated effort: ~2–3 hours, no migration, no downtime.
