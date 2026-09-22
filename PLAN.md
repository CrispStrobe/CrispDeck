# CrispDeck Development Plan

> Finished work lives in [HISTORY.md](HISTORY.md). This file is what is still
> open, plus reference material that describes how the app works today.


## What is CrispDeck

A unified Mastodon + Bluesky + Threads social media client with:
- Multi-column deck view
- Crossposting with intelligent thread splitting
- Identity matching across platforms (Jaro-Winkler)
- Local analytics, archive, translation (CrispASR/BYOK/MyMemory)
- Desktop (Tauri 2) + Web (SvelteKit 2 SPA on Vercel)

**Tech stack**: SvelteKit 2, Svelte 5 (runes), Tailwind CSS 4, Vite 6, Tauri 2, TypeScript + Rust, Vitest


## Current State (2026-09-21)

v1.2.8 — ~1,953 unit tests across 148 files (plus 62 live-API tests that run nightly rather than on every PR), 126 Rust tests, and 39 Playwright E2E specs including a smoke test of every route.

Recent reliability work (2026-09-18/19), merged as PRs #1–#5:

- **#1/#2** four silent-failure bugs — unlike never decremented the count,
  pull-to-refresh was always armed, voice commands were no-ops, short posts
  from different people merged as crossposts. Plus the `whole_word` muted-word
  filter (punctuation edges, non-Latin scripts) and archive search dropping
  its filters.
- **#3** 53 swallowed errors routed to `swallow()` and the in-app log viewer;
  22 of 23 fixture-only test files rebound to the code they claim to cover,
  pinned by `test-coverage-guard.test.ts`.
- **#4** like/repost no longer lie: the optimistic update is reverted when the
  request fails. Found two more on the way — `haptic()` could throw out of an
  event handler, and an unavailable IndexedDB aborted Post's entire `onMount`.
- **#5** completes item 171 below.

**License**: AGPL-3.0-only

---


## Remaining Work

### Future: Nostr support
- **Status**: Not started
- **Effort**: Very large (multi-week)
- **Description**: Extend to Nostr (NIP-01 relay protocol)
- Requires new crypto-based auth (nsec/npub keys), relay connections, event normalization
- Deferred — evaluate after Threads ships

---


## Known Issues / Future Polish

### i18n coverage
- **All 8 languages at 100%**: EN, DE, ES, FR, JA, PT, ZH, AR
- All 31 sections translated for every language. No fallback to English needed.

### Mastodon API property casing
- `normalizePost()` in `src/lib/api/unified.ts` handles both camelCase (masto library) and snake_case (raw fetch) for: `repliesCount`/`replies_count`, `reblogsCount`/`reblogs_count`, `favouritesCount`/`favourites_count`, `createdAt`/`created_at`, `inReplyToId`/`in_reply_to_id`, `displayName`/`display_name`
- `getMastodonMedia()` handles `mediaAttachments`/`media_attachments`, `previewUrl`/`preview_url`
- `getMastodonCard()` handles `card`/`preview_card`, `providerName`/`provider_name`
- If adding new Mastodon raw-fetch code, always handle both casings.

### Bluesky embed types handled
Post component (`src/lib/components/Post.svelte`) handles:
- `app.bsky.embed.images#view` — image grid (single: full image; multi: square grid)
- `app.bsky.embed.external#view` — link card with thumbnail
- `app.bsky.embed.record#view` — quoted post (clickable, navigates to thread)
- `app.bsky.embed.video#view` — video with thumbnail + play button
- `app.bsky.embed.recordWithMedia#view` — nested: extracts both media and quote

### Threads embed types handled
- `quoted_post` — quoted post (clickable, opens permalink on threads.com)
- Media (images/video) rendered via Mastodon-compatible attachment format

### Bluesky rich text facets
- `app.bsky.richtext.facet#link` — clickable URL
- `app.bsky.richtext.facet#mention` — clickable @handle → in-app profile
- `app.bsky.richtext.facet#tag` — clickable #hashtag → in-app search
- UTF-8 byte-offset indexing for correct positioning with unicode

### Translation providers (5)
- **Lingva Translate** (default) — free Google Translate proxy, no API key, no commercial restriction, public instances
- **LibreTranslate** — self-hosted or public instances, AGPL, optional API key
- **MyMemory** — free fallback, 5K chars/day, personal use only
- **BYOK OpenAI-compatible** — user provides endpoint + key (supports Ollama, llama.cpp, Groq, etc.)
- **CrispASR** (desktop only) — local M2M-100 GGUF models, offline, no API key
- Config stored in localStorage key `crispdeck-translate-config`
- DeepL was reverted — we prefer free/open services.

### Architecture patterns
- **BYOK pattern** (used by translation + AI compose): config in localStorage, `getConfig()`/`setConfig()` helpers, `fetch()` to OpenAI-compatible `/chat/completions` endpoint, settings UI with base URL + API key + model inputs. See `src/lib/translate.ts` and `src/lib/compose/ai.ts`.
- **Dual DB backend**: `src/lib/db.ts` delegates to Rust (Tauri) or IndexedDB (browser) via `isTauri()` check. All DB functions have both implementations.
- **Post normalization**: `src/lib/api/unified.ts` — `normalizePost()` converts platform-specific posts to `UnifiedPost`. Always pass through this when adding new data sources.
- **i18n**: `src/lib/i18n.svelte.ts` — singleton `TranslationService` with Svelte 5 runes. `deepMerge` fills missing keys from English. Add new sections to both `en` and `de` at minimum.

---


## Competitive Position

CrispDeck is the only client combining multi-column deck view + multi-network (Bluesky + Mastodon) + web-first cross-platform + analytics + free/open-source.

| | CrispDeck | Indigo (May 2026) | Openvibe | deck.blue | Ivory |
|---|---|---|---|---|---|
| Bluesky + Mastodon + Threads | Yes (3 networks) | Yes (2) | Yes + Nostr + Threads | Bluesky only | Mastodon only |
| Column/deck view | Yes | No | No | Yes | Mac only |
| Web + desktop + mobile | Yes | Apple only | Mobile only | Web only | Apple only |
| Analytics | Yes | No | No | No | Basic |
| Free to post | Yes | No ($5/mo) | 2 accts free | Yes | No ($2/mo) |
| Open source | Yes (AGPL) | No | No | No | No |

Key competitive advantages: deck+multi-network+Threads (unique combo), cross-platform analytics (no competitor), catch-up mode, AI compose (3 providers incl. local), "For You" local algorithm, thread un-rolling, real-time Jetstream counters, Threads hybrid reading via ActivityPub, saved deck workspaces, universal cross-network search, streaming timelines, hashtag bank, AI alt-text generation (BYOK + CrispASR/llama.cpp + mistral.rs), keyword monitoring columns with live streaming.

---


## Competitive Gap-Closing Plan

CrispDeck has three competitive weaknesses vs dedicated native single-network clients:
1. **Not native-feeling** — no haptics, no swipe gestures, fade-only transitions
2. **Shallower platform features** — missing Mastodon custom emoji/filters, Bluesky video upload/self-labels, Threads like/repost
3. **Cognitive overload** — 16-item sidebar always shown, 2065-line settings page, no progressive disclosure

### Phase A — Simplicity & Onboarding

| # | Item | Status | Effort | Priority |
|---|------|--------|--------|----------|
| 138 | Redirect to feed after first account connect | Done | Small | Must-have |
| 139 | Network-first onboarding (replace feature carousel with 3 network buttons → inline auth) | Done | Medium | Must-have |
| 140 | Configurable sidebar with simple mode (hide 7 advanced items, gear icon to customize) | Done | Medium | Must-have |
| 141 | Split settings into 6 tabbed sections (Account/Appearance/Content/Compose/Advanced/About) | Done | Medium | Must-have |
| 142 | Dashboard progressive disclosure (5 primary tiles, "More" expands secondary) | Done | Small | Nice-to-have |
| 143 | Fix safe-area-bottom CSS bug + tap-highlight + overscroll-behavior | Done | Small | Must-have |

### Phase B — Native Feel (Gestures, Animations, Haptics)

| # | Item | Status | Effort | Priority |
|---|------|--------|--------|----------|
| 144 | Haptic feedback module (navigator.vibrate on like/repost) | Done | Small | Must-have |
| 145 | Directional slide transitions (slide left forward, slide right back, via View Transitions API) | Done | Small | Must-have |
| 146 | Touch swipe in MediaLightbox (horizontal prev/next, translateX animation) | Done | Small | Must-have |
| 147 | Touch-compatible deck reorder (long-press to pick up, touchmove drag, floating preview) | Done | Medium | Must-have |
| 148 | Heart-burst like animation (CSS pop + 6 particle spans) | Done | Small | Nice-to-have |
| 149 | Shimmer skeleton loaders (replace animate-pulse with gradient shimmer) | Done | Small | Nice-to-have |
| 150 | Pull-to-refresh on all scroll views (extract to reusable util, apply to notifications/thread/deck) | Done | Small | Must-have |
| 151 | Mobile menu exit animation (slide-out-left + backdrop fade-out) | Done | Small | Nice-to-have |

### Phase C — Platform Depth: Bluesky

| # | Item | Status | Effort | Priority |
|---|------|--------|--------|----------|
| 152 | Video upload pipeline (video.bsky.app upload → poll job → embed, progress bar) | Done | Large | Must-have |
| 153 | Self-labeling on posts (graphic-media/nudity/porn/gore in compose UI) | Done | Small | Must-have |
| 154 | Server-synced muted words (fetch/merge/sync via app.bsky.actor.putPreferences) | Done | Medium | Must-have |
| 155 | Post gates / quote restrictions (disable quoting via app.bsky.feed.postgate) | Done | Small | Nice-to-have |
| 156 | Profile-pinned post (update app.bsky.actor.profile pinnedPost field) | Done | Small | Nice-to-have |

### Phase D — Platform Depth: Mastodon

| # | Item | Status | Effort | Priority |
|---|------|--------|--------|----------|
| 157 | Custom emoji rendering (populate emojis array, replace :shortcode: with <img> post-sanitize) | Done | Medium | Must-have |
| 158 | Server-side filters with expiry/context (GET /api/v2/filters, apply in filterPosts, CRUD UI) | Done | Medium | Must-have |
| 159 | Follow requests (handle follow_request notif type, Accept/Reject buttons, badge count) | Done | Small | Must-have |
| 160 | Announcements (GET /api/v1/announcements, pinned card on notifications, dismiss) | Done | Small | Nice-to-have |
| 161 | Post edit history (edited badge on posts with edited_at) | Done | Small | Nice-to-have |
| 162 | List membership management (getLists, addToList, removeFromList API methods) | Done | Small | Nice-to-have |
| 163 | Server-side translation (try POST /api/v1/statuses/:id/translate first, fall back to third-party) | Done | Small | Nice-to-have |

### Phase E — Platform Depth: Threads

| # | Item | Status | Effort | Priority |
|---|------|--------|--------|----------|
| 164 | Like / Unlike (POST /{userId}/likes, DELETE /{userId}/likes/{mediaId}) | Done | Small | Must-have |
| 165 | Repost (container with media_type: REPOST + repost_id) | Done | Small | Must-have |
| 166 | Quote post (container with quote_post_id) | Done | Small | Must-have |

### Phase F — PWA & Notifications

| # | Item | Status | Effort | Priority |
|---|------|--------|--------|----------|
| 167 | Web push with VAPID (PushManager.subscribe, SW push/notificationclick handlers, Vercel cron) | Done | Large | Must-have |
| 168 | PWA manifest shortcuts + share_target (Compose/Feed/Notifications shortcuts, share → compose) | Done | Small | Must-have |
| 169 | Register Tauri notification plugin (add to Cargo.toml + lib.rs — was silently broken) | Done | Small | Must-have |
| 170 | Notification badge API (navigator.setAppBadge on unread count) | Done | Small | Nice-to-have |

### Implementation Order (by competitive impact per effort)

**Sprint 1 — Quick wins (all small):** 143, 169, 138, 144, 164, 165, 166, 145, 146, 168

**Sprint 2 — Core UX (medium):** 140, 141, 157, 159, 153, 150, 147

**Sprint 3 — Platform depth (medium/large):** 154, 158, 152, 139

**Sprint 4 — Advanced (large + nice-to-haves):** 167, 148, 149, 151, 142, 155, 156, 160, 161, 162, 163, 170

### Remaining Items — Detailed Implementation Notes

#### 139. Network-first onboarding (medium / must-have) — DONE
- Two-stage component: Stage 1 = 3 large network buttons (Bluesky/Mastodon/Threads with brand colors + taglines), Stage 2 = per-network inline auth forms
- Bluesky: OAuth button + app password form; Mastodon: instance URL input; Threads: redirect to settings
- Dashboard passes 4 auth callbacks implementing real connection logic (mirrors settings page patterns)
- Sets `crispdeck-first-run-complete` in localStorage after first account, redirects to `/feed`
- i18n: 12 strings in EN + DE
- **Key files**: `src/lib/components/Onboarding.svelte`, `src/routes/+page.svelte`

#### 141. Split settings into tabbed sections (medium / must-have) — DONE
- 6 tabs: Account, Appearance, Content, Compose, Advanced, About
- Tab bar with active indicator, URL-driven (`?tab=content` deep links)
- All state stays in single file — template sections wrapped in `{#if activeTab}` blocks
- Account: Bluesky/Mastodon/Threads account management
- Appearance: Language, theme, home mode, display (font/size/spacing/width), compact posts, media preview
- Content: Muted Words, Server Filters, Tag Groups, RSS, Feed cache, Keyword Monitors
- Compose: Alt text, Translation, AI Compose, Hashtag Bank
- Advanced: Notifications, TTS/STT, Model Manager, Cache, Debug Log
- About: Version, license, Settings Export/Import
- i18n: 6 tab labels in all 8 languages
- **Key files**: `src/routes/settings/+page.svelte`

#### 147. Touch-compatible deck reorder (medium / must-have) — DONE
- Long-press (500ms) to pick up with `haptic('medium')`, touchmove to drag with floating title indicator, touchend to drop with `haptic('light')`
- 10px movement threshold cancels long-press (allows normal scroll)
- Dragged column: `opacity-40 scale-[0.95]`; drop target: `ring-2 ring-[var(--color-primary)]`
- Mouse HTML5 DnD path unchanged — desktop unaffected
- 4 new unit tests
- **Key files**: `src/routes/deck/+page.svelte`

#### 152. Bluesky video upload pipeline (large / must-have) — DONE
- `BlueskyClient.uploadVideo()`: service auth → POST to video.bsky.app → poll getJobStatus every 2s (max 120s) → return blob ref
- Handles direct blob response (no job), JOB_STATE_FAILED, timeout, progress callback
- Compose adapter: detects video MIME type, builds `app.bsky.embed.video` embed, handles video+quote via `recordWithMedia`
- Compose page: `videoUploadStatus` state with progress indicator, video preview in media grid
- 15 tests with fake timers
- **Key files**: `src/lib/api/bluesky.ts`, `src/lib/compose/adapter.ts`, `src/routes/compose/+page.svelte`

#### 158. Mastodon server-side filters (medium / must-have) — DONE
- `MastodonClient`: `getFilters()`, `createFilter()`, `updateFilter()`, `deleteFilter()` (v2 API, graceful 404 fallback)
- `mastodon-filters.ts`: `buildFilterMatcher(filters, context)` with whole-word regex, substring match, expiry check, compiled matcher cache
- Feed page: fetches filters on load (5-min TTL cache), applies `hide` (exclude) and `warn` (content warning collapse) to Mastodon posts in `home` context
- `Post.svelte`: CW collapse UI when `post.contentWarning` is set
- Settings: "Server Filters (Mastodon)" section with CRUD UI — title, contexts, action, expiry, keywords
- i18n: 20 strings in EN + DE
- 21 new unit tests
- **Key files**: `src/lib/mastodon-filters.ts`, `src/lib/api/mastodon.ts`, `src/routes/feed/+page.svelte`, `src/routes/settings/+page.svelte`, `src/lib/components/Post.svelte`

#### 167. Web push with VAPID (large / must-have) — DONE
- **Service worker**: `push` event handler (showNotification with actions) + `notificationclick` handler (focus/navigate existing window or open new)
- **Client**: `subscribeWebPush()`, `unsubscribeWebPush()`, `getPushSubscription()`, `urlBase64ToUint8Array()` in push-notifications.ts
- **Server**: `api/push/vapid-key.ts` (returns public key from env), `api/push/subscribe.ts` (POST/DELETE subscription to Vercel Blob), `api/push/send.ts` (cron stub for notification delivery)
- **Cron**: `vercel.json` cron job every 2 minutes at `/api/push/send`
- **Settings UI**: Web Push section in Advanced tab with subscribe/unsubscribe + VAPID status
- **i18n**: 6 strings EN + DE
- 15 tests
- **Key files**: `static/sw.js`, `src/lib/push-notifications.ts`, `api/push/`, `vercel.json`

---


## Future Ideas (from Graysky comparison)

### Alt text badge overlay on images
- **Status**: Done
- **Effort**: Small
- **Description**: "ALT" badge overlay on post images with non-empty alt text, click to toggle popover showing full text
- Works for both Bluesky (`image.alt`) and Mastodon (`attachment.description`) images
- **Key files**: `src/lib/components/Post.svelte`

### Throttled loading indicators
- **Status**: Done
- **Effort**: Small
- **Description**: `DelayedSpinner` component delays spinner display by 100ms to prevent flicker
- Applied to feed, deck, and notifications pages
- **Key files**: `src/lib/components/DelayedSpinner.svelte`

### Quick account switcher
- **Status**: Done
- **Effort**: Medium
- **Description**: Popover/drawer for switching between accounts without navigating to full Identities page
- AccountSwitcher component in sidebar footer shows stacked avatars, popover lists all accounts with platform indicator, links to Settings > Account
- **Key files**: `src/lib/components/AccountSwitcher.svelte`, `src/routes/+layout.svelte`

---


## Deck Feature Parity Audit (2026-07-04)

Where CrispDeck still falls behind the classic multi-column deck experience. Organized by theme, prioritized by user impact, scoped to be individually shippable.

### TD-A. Missing Deck Column Types

The classic deck principle: **everything is a column**. CrispDeck has 15 column types but is missing several staples.

#### TD-A1. DM / Messages column
- **Status**: Done
- **Effort**: Medium
- **Gap**: Direct messages exist only as a standalone page (`/messages`). A proper deck client pins a DM column alongside the timeline so conversations stay visible without navigation.
- [ ] Add `messages` column type to `COLUMN_TYPES` in deck page
- [ ] Render Bluesky chat convos + Mastodon conversations inline
- [ ] Show unread badge per-column
- [ ] Click a conversation to open thread in a slide-over or modal (not full page nav)
- **Key files**: `src/routes/deck/+page.svelte`, `src/routes/messages/+page.svelte`

#### TD-A2. Trending / Explore column
- **Status**: Done
- **Effort**: Small–Medium
- **Gap**: Trending is a page only. A trending column lets you watch what's happening without leaving the deck.
- [ ] Add `trending` column type
- [ ] Merge Bluesky trending topics + Mastodon trending tags/links into the column
- [ ] Auto-refresh on the same interval as the trending page (SWR, 10-min TTL)
- [ ] Click a trend to open search results inline or spawn a new search column
- **Key files**: `src/routes/deck/+page.svelte`, `src/routes/trending/+page.svelte`

#### TD-A3. Activity / Engagement column
- **Status**: Done
- **Effort**: Medium
- **Gap**: Classic deck clients had an "Activity" column showing real-time engagement on your posts (who liked, reposted, replied). CrispDeck's notifications page groups these, but there's no deck column filtered to engagement-on-your-content.
- [ ] Add `activity` column type (filtered notifications: likes, reposts, quotes on your posts only)
- [ ] Group by post ("Post X got 5 new likes" not 5 separate cards)
- [ ] Wire to streaming (Jetstream + Mastodon WS notification events)
- **Key files**: `src/routes/deck/+page.svelte`, `src/lib/notification-grouping.ts`

#### TD-A4. Likes column
- **Status**: Done
- **Effort**: Small
- **Gap**: Multi-column clients typically offer a "likes" column. CrispDeck has bookmarks but no "my likes" view.
- [ ] Add `likes` column type showing liked posts in reverse-chron
- [ ] Paginate via `app.bsky.feed.getActorLikes` + Mastodon `GET /api/v1/favourites`
- **Key files**: `src/routes/deck/+page.svelte`, `src/lib/api/bluesky.ts`, `src/lib/api/mastodon.ts`

#### TD-A5. Followers column
- **Status**: Done
- **Effort**: Small
- **Gap**: No "Followers" column showing new follows in real-time. Useful for community accounts.
- [ ] Add `followers` column type showing recent followers
- [ ] Pull from notification stream filtered to `follow` type
- [ ] Show follow-back / "follows you" status inline
- **Key files**: `src/routes/deck/+page.svelte`

---

### TD-B. Column UX & Management

Column chrome in mature deck clients was polished over years. Several ergonomic features are missing.

#### TD-B1. Per-column notifications (sound + desktop alert)
- **Status**: Done
- **Effort**: Medium
- **Gap**: Classic deck clients let you enable sound/desktop notifications per column (e.g., sound on mentions, silent on timeline). CrispDeck's notification alerts are global only.
- [ ] Add per-column notification toggle in column header menu (off / sound / desktop / both)
- [ ] Play configurable sound when a column receives new posts (if enabled)
- [ ] Fire desktop notification with post preview for high-signal columns
- [ ] Persist settings in column config within deck layout
- **Key files**: `src/lib/components/deck/DeckColumn.svelte`, `src/routes/deck/+page.svelte`

#### TD-B2. Column color coding / visual identity
- **Status**: Done
- **Effort**: Small
- **Gap**: Columns lack colored top borders for visual distinction. All CrispDeck columns look identical.
- [ ] Add color picker in column settings (8–10 preset colors + custom hex)
- [ ] Render colored top border or accent stripe on each column
- [ ] Persist color in layout config
- **Key files**: `src/lib/components/deck/DeckColumn.svelte`

#### TD-B3. Column collapse / minimize
- **Status**: Done
- **Effort**: Small
- **Gap**: No way to collapse a column to a narrow icon strip to save space without removing it.
- [ ] Add collapse toggle (double-click header or chevron button)
- [ ] Collapsed state: column icon + title vertically, ~40px wide
- [ ] Click to expand; persist collapsed state in layout
- **Key files**: `src/lib/components/deck/DeckColumn.svelte`

#### TD-B4. Column pin / lock
- **Status**: Done
- **Effort**: Small
- **Gap**: No way to pin columns to prevent accidental removal or reorder.
- [ ] Add "Pin column" option in column header menu
- [ ] Pinned columns skip drag-reorder and hide the remove button
- [ ] Show pin icon indicator
- **Key files**: `src/lib/components/deck/DeckColumn.svelte`, `src/routes/deck/+page.svelte`

#### TD-B5. Column clear / mark-as-read
- **Status**: Done
- **Effort**: Small
- **Gap**: No "Clear" button to wipe a column's rendered content and start fresh.
- [ ] Add "Clear column" action in column header menu
- [ ] Clears rendered posts but doesn't affect underlying data
- [ ] Next refresh loads fresh posts from the cleared point forward
- **Key files**: `src/lib/components/deck/DeckColumn.svelte`

#### TD-B6. Auto-scroll / scroll-lock toggle
- **Status**: Done
- **Effort**: Small–Medium
- **Gap**: Streaming columns in classic deck clients auto-scrolled new posts into view, with a toggle to lock scroll. CrispDeck shows a "New posts" pill but never auto-scrolls.
- [ ] Add scroll-lock toggle icon in column header
- [ ] Unlocked + streaming: new posts push into view automatically
- [ ] Locked: show "N new posts" pill (current behavior)
- [ ] Default to locked; let power users unlock
- **Key files**: `src/lib/components/deck/DeckColumn.svelte`

#### TD-B7. Column width presets (narrow / medium / wide)
- **Status**: Done
- **Effort**: Small
- **Gap**: No quick width presets. CrispDeck has pixel-drag resize but no one-click presets.
- [ ] Add width presets in column header menu: Narrow (280px) / Medium (350px) / Wide (450px) / Custom
- [ ] Keep existing drag-resize for custom widths
- [ ] "Apply to all columns" shortcut
- **Key files**: `src/lib/components/deck/DeckColumn.svelte`

---

### TD-C. Compose & Posting

#### TD-C1. Pop-out / floating compose panel
- **Status**: Done
- **Effort**: Medium
- **Gap**: Compose is full-page navigation away from the deck. A deck-native compose should float as a side panel or pop-out so you can draft while reading columns.
- [ ] Add floating compose panel option (slide-out from right, or bottom sheet on mobile)
- [ ] Keep deck visible while composing
- [ ] Open compose from any column's reply/quote action without leaving deck view
- [ ] Keyboard shortcut `n` to open compose overlay from deck
- **Key files**: `src/routes/deck/+page.svelte`, `src/routes/compose/+page.svelte` (extract compose form to shared component)

#### TD-C2. Quick-schedule from compose
- **Status**: Done
- **Effort**: Small
- **Gap**: No schedule picker in the compose box. CrispDeck scheduling lives in the drafts page, adding friction.
- [ ] Add "Schedule" button next to "Post" in compose UI
- [ ] Show date/time picker inline
- [ ] Scheduled posts go to drafts with scheduled state (reuse existing draft scheduler)
- **Key files**: `src/routes/compose/+page.svelte`, `src/lib/drafts.ts`

#### TD-C3. Prominent account selector in compose
- **Status**: Done
- **Effort**: Small
- **Gap**: Account avatars aren't shown directly in compose for per-post account switching. CrispDeck has multi-account compose but the UX is less discoverable.
- [ ] Show account avatar chips in compose header (one per connected account)
- [ ] Toggle accounts on/off per post with a single click
- [ ] Greyed-out = not posting; colored = active
- **Key files**: `src/routes/compose/+page.svelte`

---

### TD-D. Display & Density

#### TD-D1. Display density modes (compact / comfortable / spacious)
- **Status**: Done
- **Effort**: Small–Medium
- **Gap**: No holistic density setting. CrispDeck has compact-post mode + font-size + line-spacing, but no single density toggle that adjusts avatars, padding, and card height together across the entire UI (not just post cards).
- [ ] Unify into a single density selector in Appearance settings: Compact / Comfortable / Spacious
- [ ] Compact: smaller avatars (28px), tighter padding (8px), single-line usernames, reduced margins — extend current compact mode beyond Post.svelte to all page cards, sidebar, deck headers
- [ ] Spacious: larger avatars (48px), more breathing room, full display names + handles
- [ ] Apply via CSS custom properties on `:root` for easy global toggling
- **Key files**: `src/routes/settings/+page.svelte`, `src/app.css`, `src/lib/components/Post.svelte`

---

### TD-E. Bulk & Power-User Actions

#### TD-E1. Multi-select posts for bulk actions
- **Status**: Done
- **Effort**: Medium
- **Gap**: No multi-select for batch operations on posts. CrispDeck operates one post at a time.
- [ ] Add multi-select mode toggle (checkbox appears on each post card)
- [ ] Bulk action toolbar: Like All / Bookmark All / Add to Reading List
- [ ] Select all visible / deselect all
- [ ] Shift+click for range select
- **Key files**: `src/lib/components/Post.svelte`, `src/routes/feed/+page.svelte`, `src/routes/deck/+page.svelte`

#### TD-E2. Quick add-to-list from post menu
- **Status**: Done
- **Effort**: Small
- **Gap**: Can't add a user to a list from the post's action menu. List management requires navigating to settings or profile.
- [ ] Add "Add to list..." option in post overflow menu (three-dot)
- [ ] Show list picker popup (Mastodon lists + reading lists)
- [ ] Create new list inline from the picker
- **Key files**: `src/lib/components/Post.svelte`, `src/lib/list-management.ts`

#### TD-E3. Column-level mute / filter overrides
- **Status**: Done
- **Effort**: Small
- **Gap**: No per-column keyword filters. CrispDeck's muted-word filters are global only.
- [ ] Add "Column filters" section in each column's settings menu
- [ ] Allow keyword + regex filters scoped to that column only
- [ ] Column filters stack on top of global mute rules
- **Key files**: `src/lib/components/deck/DeckColumn.svelte`, `src/lib/muted-words.ts`

---

### TD-F. Keyboard & Navigation

#### TD-F1. Column-aware keyboard navigation in deck
- **Status**: Done
- **Effort**: Medium
- **Gap**: No column-aware keyboard navigation in deck — arrow keys between columns, up/down within. CrispDeck's j/k/o/l shortcuts work on the feed page but aren't column-aware in deck mode.
- [ ] Left/Right arrows (or h/l) to move focus between deck columns
- [ ] j/k to navigate posts within the focused column
- [ ] Column focus indicator (subtle highlight on focused column header)
- [ ] Number keys (1–9) to jump to column by position
- [ ] `n` to open compose overlay from deck
- **Key files**: `src/routes/deck/+page.svelte`, `src/routes/+layout.svelte`

#### TD-F2. Keyboard shortcut for "add column"
- **Status**: Done
- **Effort**: Small
- **Gap**: No keyboard shortcut to add a new column. Requires mouse interaction with the + button.
- [ ] `a` or `+` key opens the column type picker when deck is focused
- [ ] Arrow keys + Enter to select column type
- **Key files**: `src/routes/deck/+page.svelte`

---

### TD-G. Real-Time & Streaming

#### TD-G1. Live-updating engagement counters
- **Status**: Done
- **Effort**: Small
- **Gap**: Like/repost counts don't update in real-time across all deck columns. CrispDeck has Jetstream counters but they may not cover all visible posts in deck columns.
- [ ] Ensure Jetstream counter updates work in all deck column types (not just feed page)
- [ ] Animate count changes (subtle flash or count-up)
- [ ] For Mastodon: poll engagement counts for visible posts every 60s (no streaming API for counts)
- **Key files**: `src/lib/jetstream.ts`, `src/lib/components/Post.svelte`

#### TD-G2. Streaming for all column types
- **Status**: Done
- **Effort**: Medium
- **Gap**: Not all column types stream. CrispDeck streams timeline + keyword-monitor but mentions, notifications, list, and user columns rely on manual/interval refresh.
- [ ] Wire mentions column to streaming (filter notification stream for mention type)
- [ ] Wire notifications column to streaming
- [ ] Wire list/feed columns to Mastodon WS list streaming endpoint
- [ ] Wire user column to filtered Jetstream events for that DID
- **Key files**: `src/routes/deck/+page.svelte`, `src/lib/streaming.ts`

---

### TD-H. Search & Filtering

#### TD-H1. Advanced search operators UI
- **Status**: Done
- **Effort**: Small
- **Gap**: No search operator guidance. CrispDeck has a plain text search box with no help for platform-specific operators (from:user, since:date, filter:media).
- [ ] Add search syntax help tooltip/popover showing available operators per platform
- [ ] Bluesky: `from:handle`, `since:date`, `until:date`, `lang:xx`
- [ ] Mastodon: document server-supported operators
- [ ] Quick filter buttons: "Has media", "From me", "Date range"
- **Key files**: `src/routes/search/+page.svelte`

#### TD-H2. Saved searches
- **Status**: Done
- **Effort**: Small
- **Gap**: No saved searches. CrispDeck has search columns but no "saved searches" concept with quick re-access.
- [ ] Add "Save this search" button on search results
- [ ] Saved searches appear in dropdown on search page + column picker
- [ ] One-click to open a saved search as a new deck column
- [ ] Persist in localStorage
- **Key files**: `src/routes/search/+page.svelte`, `src/routes/deck/+page.svelte`

---

### TD-I. Collections & Curation

#### TD-I1. Shareable curated collections
- **Status**: Done
- **Effort**: Medium
- **Gap**: Reading lists are local-only, not shareable. Classic deck clients had curated post collections shareable via URL.
- [ ] Add export-to-URL for reading lists (generate shareable link with post URIs)
- [ ] Support importing a collection by URL
- [ ] Consider publishing as a Bluesky custom feed for discoverability
- **Key files**: `src/lib/reading-lists.ts`

---

### TD-J. Multi-Account & Teams

#### TD-J1. Account indicator on deck columns
- **Status**: Done
- **Effort**: Small
- **Gap**: When multiple accounts are connected, it's unclear which account a column belongs to. Column headers should show the source account avatar.
- [ ] Show source account avatar in column header (small, next to title)
- [ ] For merged columns (multi-account timeline), show stacked avatars
- [ ] Click avatar to open account-specific settings for that column
- **Key files**: `src/lib/components/deck/DeckColumn.svelte`

#### TD-J2. Team / shared deck collaboration
- **Status**: Not started
- **Effort**: Very Large (design doc first)
- **Gap**: CrispDeck is single-user only. No team accounts or role-based permissions.
- [ ] Phase 1: Shared deck layouts via cloud sync (export/import as starting point)
- [ ] Phase 2: Read-only shared column links for team monitoring
- [ ] Phase 3: Full team auth with roles (admin/contributor/viewer)
- This is aspirational — scope to a design doc before any implementation

---

### Deck Parity — Priority Tiers

#### P0 — High impact, ship first (core deck differentiators)
| ID | Item | Effort |
|----|------|--------|
| TD-C1 | Pop-out / floating compose panel | Medium |
| TD-B1 | Per-column notifications | Medium |
| TD-F1 | Column-aware keyboard navigation | Medium |
| TD-D1 | Display density modes | Small–Medium |
| TD-G2 | Streaming for all column types | Medium |

#### P1 — High impact, larger scope
| ID | Item | Effort |
|----|------|--------|
| TD-A1 | DM column type | Medium |
| TD-A2 | Trending column type | Small–Medium |
| TD-A3 | Activity / engagement column | Medium |
| TD-B6 | Auto-scroll / scroll-lock | Small–Medium |
| TD-C2 | Quick-schedule from compose | Small |
| TD-H1 | Advanced search operators UI | Small |

#### P2 — Polish & power-user features
| ID | Item | Effort |
|----|------|--------|
| TD-A4 | Likes column | Small |
| TD-A5 | Followers column | Small |
| TD-B2 | Column color coding | Small |
| TD-B3 | Column collapse / minimize | Small |
| TD-B4 | Column pin / lock | Small |
| TD-B5 | Column clear | Small |
| TD-B7 | Column width presets | Small |
| TD-C3 | Account selector in compose | Small |
| TD-E1 | Multi-select bulk actions | Medium |
| TD-E2 | Quick add-to-list | Small |
| TD-E3 | Column-level mute filters | Small |
| TD-F2 | Keyboard shortcut for add-column | Small |
| TD-G1 | Live engagement counters | Small |
| TD-H2 | Saved searches | Small |
| TD-J1 | Account indicator on columns | Small |

#### P3 — Ambitious / long-term
| ID | Item | Effort |
|----|------|--------|
| TD-I1 | Shareable collections | Medium |
| TD-J2 | Team / shared deck collaboration | Very Large |

---


## Phase 18: Hardening & Polish (2026-07-04)

The app is feature-rich (20 column types, 1,520+ tests, streaming, keyboard nav, density modes, shareable collections, Bluesky lists API). Diminishing returns on new features. Focus shifts to reliability, real-world usage, and honest PWA support.

### 172. Offline-first PWA with cached feed
- **Status**: Done (2026-09-21, PR #35), bar one checkbox that should not be built
- **Effort**: Medium
- **Priority**: Must-have
- **Description**: The service worker caches the app shell but not feed data. PWA users who lose connection see a blank feed. The "offline support" claim is not honest.
- [x] Cache last-known feed state in IndexedDB on each successful load —
      `src/lib/offline-cache.ts`, capped at 100 posts
- [x] On offline load: serve cached feed with an "Offline — showing cached data
      from [time]" banner
- [x] Notifications and trending say the same thing. They were already showing
      localStorage-backed SWR data when offline, silently, which is how an
      hour-old page passes for live — the data was there, the honesty was not.
- [x] Clear the indicator when the connection returns, and auto-refresh
- [ ] ~~Stale-while-revalidate for API responses in the service worker~~ —
      **not doing this, and the reason should outlive the checkbox.** The SW
      skips cross-origin requests, and every feed API here *is* cross-origin
      (bsky.social, each Mastodon instance). Caching those would mean storing
      opaque responses it cannot read, keyed by URLs carrying auth, for an
      offline case the IndexedDB snapshot already covers properly. The only
      same-origin `/api/` route is the Threads proxy, which is an auth
      exchange and must not be cached at all.
- **The bug this turned up**: there were two pieces of offline state and only
  one reacted to reconnecting. The layout cleared its own `offline` flag on the
  `online` event; the feed's `offlineBanner` was separate and nothing cleared
  it. A reconnected user went on reading cached posts under an "Offline" sign
  until they noticed the Retry link — worse than showing nothing, because it
  looks like a working feed that has gone quiet.
- **Key files**: `src/lib/offline-cache.ts`, `src/lib/offline-status.ts`,
  `src/routes/{feed,notifications,trending}/+page.svelte`

### 174. Live user testing pass
- **Status**: Open — this is yours to run; the checklist is ready
- **Effort**: Small (but high value)
- **Priority**: Must-have
- **Description**: Connect real accounts, use the deck for a full day, document friction.
- **Work through [TESTING.md](TESTING.md)**, which is generated from the source
  by `scripts/testing-checklist.mjs` and pinned by
  `src/lib/testing-checklist.test.ts`. It covers all 20 column types, all 31
  routes, every shortcut the help dialog claims, and the flows that cross
  pages. A hand-written checklist goes stale the way `deck.test.ts` did when it
  asserted "all 14 column types" against an app that had grown to 20 — except
  quietly, because nothing runs a checklist.
- [ ] All 20 column types with real data
- [ ] Floating compose with real reply/quote workflows
- [ ] Keyboard navigation end-to-end on deck
- [ ] Mobile PWA (install, offline, notifications)
- [ ] Multi-account (2 Bluesky + 1 Mastodon)
- [ ] Export the in-app log viewer at the end — a day of use should leave a
      file, not impressions
- [ ] Document: what's confusing, what's broken, what's unused
- This is the highest-value activity — code is ahead of the product

### 175. Nostr support (design doc)
- **Status**: Not started
- **Effort**: Very Large (multi-week)
- **Priority**: Nice-to-have (new network = new users)
- **Description**: The only remaining item that expands the market. NIP-01 relay protocol, crypto-based auth (nsec/npub), event normalization into UnifiedPost.
- [ ] Write design doc: relay connection model, key management, NIP support matrix
- [ ] Define: which NIPs to support (NIP-01, NIP-02 contacts, NIP-04 DMs, NIP-07 browser extension signing)
- [ ] Design: how nsec/npub key auth maps to existing Account model (no server, no OAuth)
- [ ] Prototype: relay connection + event parsing in isolation before wiring into UI
- [ ] The AT Protocol and ActivityPub abstractions are solid — adding a third protocol backend is architecturally clean but the auth paradigm is fundamentally different

### 188. Drive the macOS keychain settings on a real Mac
- **Status**: Open — and now blocking the macOS TestFlight, not just tidiness
- **Blocks**: a `platform: MAC_OS` run of `.github/workflows/testflight.yml`.
  iOS was safe to ship because `os_store_compiled_in()` excludes iOS, so an
  iOS build never touches this code. A macOS build does.
- **Effort**: Small
- **Priority**: Should-have
- **Description**: The Rust in item 185 is tested against real keychains on CI
  and the accessors against a mocked invoke, but nobody has clicked the radio
  button on a Mac and watched a credential land in the keychain they chose.
  The path is tested in pieces, not end to end, and the pieces are where it
  would work while the join does not.
- [ ] Point the build at a keychain created with `security create-keychain`,
      add an account, and confirm with `security find-generic-password` that
      the secret is in that keychain and not the login one
- [ ] Confirm the error when the chosen keychain is locked says so

### Branch cleanup (2026-09-19)

Four stale remote branches deleted. Three were fully merged
(`fix/scroll-gate-and-unlike-counts` `31fa781`,
`fix/surface-swallowed-errors` `a4edd35`, `test/component-mounting`
`225c5bf`). The fourth, `perf/bundle-and-hot-paths` `a7ac9f4`, was built on a
base `main` is now 275 commits past: its 96-file diff was mostly main's newer
work being absent rather than new content, and every feature it named
(incremental crosspost detection, index-driven archive search, client caching,
the Jetstream worker, per-language i18n, settings extraction, working unlike
counts) is in main already. SHAs recorded here in case anything is wanted back.

### What to skip (and why)

- **Team collaboration (TD-J2)**: enterprise feature for a product without enterprise users. Build it when someone asks.
- **More column types**: 20 is already more than most users will discover. Better discoverability of existing types matters more than adding column type #21.
- **More perf optimizations**: hot paths are parallel, caches are in place. Further gains require profiling real usage data, not code-level guessing.
- **More unit tests for their own sake**: 1,539 tests is already extensive. Add tests when fixing bugs or adding features, not as a standalone goal.
