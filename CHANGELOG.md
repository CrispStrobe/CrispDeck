# Changelog

## Unreleased

## v1.2.4 — 2026-07-06

### Downloads

All platforms available on the release page:
- **macOS**: ARM (.dmg) + Intel (.dmg)
- **Linux**: .deb
- **Windows**: .exe + .msi
- **Android**: signed debug APK (sideloadable)
- **iOS**: unsigned .ipa (requires re-signing for device install)

### Infrastructure

- **iOS .ipa builds**: patch generated xcodeproj to disable code signing in CI; `tauri ios build` produces a real .app from xcarchive, packaged as .ipa
- **Android installable APK**: debug build is auto-signed and sideloadable; release APK signed with CI-generated keystore via zipalign + apksigner

## v1.2.3 — 2026-07-06

### Infrastructure

- **Mobile binaries on release page**: Android APKs and iOS simulator builds now upload directly to GitHub Releases via `gh release upload` (were only in Actions artifacts before)

## v1.2.2 — 2026-07-06

### Infrastructure

- **Android builds produce APK**: switched `reqwest` from OpenSSL to `rustls-tls` for Android cross-compilation; APK artifact (33 MB) now downloadable from GitHub Actions
- **iOS builds on Xcode 16**: upgraded CI runner to `macos-15` (Xcode 16) to support Tauri 2 project format 77; dynamic xcodeproj/scheme discovery
- **Artifact uploads**: both mobile builds now upload artifacts via `actions/upload-artifact@v4`

## v1.2.1 — 2026-07-04

### Features

- **Account switcher**: stacked avatars in sidebar footer with popover listing all connected accounts by platform, quick link to add accounts
- **Multi-select posts**: immutable state module for bulk post selection with toggle, range select (Shift+click), select/deselect all
- **Quick add-to-list**: ListPlus button on every post opens reading list picker popover for one-click add-to-list
- **Bluesky lists API**: `getLists`, `getList`, `getListFeed`, `getListMutes`, `getListBlocks` methods in BlueskyClient
- **Offline feed cache**: PWA users see cached feed with "Offline — cached from [time]" banner when network is unavailable; retry button to reload
- **Page-error helpers**: `tryLoad`/`tryAction`/`tryWrite` utilities with automatic toast feedback for consistent error handling

### Fixes

- **Mastodon poll voting**: now sends Authorization header (was silently failing); shows toast on success/failure
- **Error feedback**: bookmark failure, bookmark server sync, TTS, translation errors now show user-facing toasts instead of silent `console.error`
- **Accessibility**: post text divs have `role="article"` + keyboard Enter handler; quoted post images have `role="button"` with Enter/Space; list picker closes on Escape
- **Silent error audit**: lists page and moderation page silent catches now log errors and show toasts

### Performance

- **Parallel crosspost pipeline**: mention resolution + posting to all platforms via `Promise.all` instead of sequential loop (2-3x faster for 3-platform crossposts)
- **Parallel Mastodon media uploads**: 4 files upload concurrently via `Promise.all` (2-3x faster for multi-image posts), alt text sent in upload FormData
- **Parallel deck column loads**: timeline and my-posts columns fetch all accounts concurrently instead of platform-by-platform sequential loops
- **Cached HTML stripping**: `normalizePost` caches regex results by URI+length key (avoids 50+ regex executions per feed re-render)
- **Cached Mastodon handle normalization**: avoids `new URL()` parsing per-post for handle construction
- **Session-scoped Post prefs cache**: removes 10s TTL and `Date.now()` overhead — invalidated via window event from settings page

### Tests

- 1,546 frontend unit tests across 110 files (up from 1,443 in v1.2.0), 44 Playwright E2E tests (up from 29)

## v1.2.0 — 2026-07-04

Full deck parity release — 27 new features bringing the multi-column deck experience to feature-complete status.

### Deck Features (20 column types, up from 15)

- **5 new column types**: Messages/DMs (Bluesky chat + Mastodon conversations), Trending (topics + tags + links), Activity (engagement on your posts), Liked Posts, New Followers
- **Floating compose panel**: slide-out compose overlay stays on top of deck columns — reply/quote from any column without navigating away; `n` keyboard shortcut to open
- **Column-aware keyboard navigation**: `h`/`l` or arrow keys between columns, `j`/`k` within focused column, `1`-`9` jump to column by position, `o` to open post, `r` to reply, `a` to add column, visual focus indicators
- **Per-column notifications**: configure sound, desktop alerts, or both per column — cycles via bell icon in column header
- **Column color coding**: 8 preset colors + clear, rendered as colored accent bar at column top
- **Column collapse/minimize**: shrink to 40px icon strip, click to expand
- **Column pin/lock**: prevent accidental removal or drag-reorder
- **Column clear**: wipe rendered content and start fresh on next refresh
- **Column width presets**: one-click Narrow (280px) / Medium (350px) / Wide (450px) alongside drag resize
- **Auto-scroll / scroll-lock**: toggle per column — when unlocked, new streaming posts auto-scroll into view
- **Column-level mute filters**: per-column keyword + regex filters stacking on top of global mutes
- **Streaming for all column types**: timeline, mentions, notifications, local, federated, hashtag, list, and user columns now stream via Mastodon WS + Bluesky Jetstream (was keyword-monitor only)
- **Live engagement counters on deck**: Jetstream enabled on deck page for real-time like/repost count updates

### Compose & Search

- **Quick-schedule from compose**: Schedule button with inline date/time picker, saves as scheduled draft
- **Advanced search operators UI**: per-platform syntax help popover (Bluesky `from:`, `since:`, `until:`, `lang:`, `has:media`; Mastodon `from:@user@instance`, `#hashtag`), quick filter buttons
- **Saved searches**: save queries for one-click re-access, dropdown with delete

### Display & Settings

- **Display density modes**: Compact / Comfortable / Spacious selector in Appearance settings — sets 7 CSS custom properties controlling avatar size, padding, gap, card padding, font scale, and line clamp across the entire UI

### Collections

- **Shareable curated collections**: export reading lists as JSON text or data URL, import from JSON — round-trip preserves all post data

### Tests

- 1,443 frontend unit tests across 99 files (up from 1,213 across 86 files in v1.1.1), 29 Playwright E2E tests, 15 Rust tests

## v1.1.1 — 2026-07-04

### Features

- **Official Bluesky bookmarks** (`app.bsky.bookmark.*`, Bluesky 1.108+): bookmarking a Bluesky post writes through to the server; the bookmarks page sync imports server bookmarks alongside Mastodon

### Fixes

- **GIF playback fixed**: klipy GIF embeds played a guessed MP4 URL that 404'd, leaving a blank box — now uses klipy's real sibling-file URL scheme (mp4 + webm) with a plain-GIF fallback on error
- **Starter pack search fixed**: Bluesky's public appview now 403s unauthenticated search, silently killing the fallback — search now goes through the authenticated agent and reports auth problems instead of "no packs found"
- **Media sizing rebuilt on the official app's model**: images/videos/GIFs fill the column width at their native aspect ratio (from the embed's `aspectRatio`, klipy `ww`/`hh` params, or Mastodon `meta.original`), clamped to never exceed square with center-crop like bsky.app, plus a `min(32rem, 80svh)` viewport cap — responsive from small phones (portrait/landscape) to wide desktop and narrow deck columns

### Infrastructure

- **Release CI**: macOS Intel build cross-compiles on `macos-14` (GitHub retired the `macos-13` Intel runners; jobs targeting them queued forever)

## v1.1.0 — 2026-07-03

Six feature sprints, a deep performance pass, and major reliability fixes since v1.0.0.

### Highlights

- **Bluesky video upload** — full pipeline (service auth → video.bsky.app upload → processing job polling) wired into compose
- **Web push notifications** — VAPID subscribe/unsubscribe, service-worker handlers, Vercel API routes + daily cron
- **Self-healing Bluesky OAuth sessions** — sessions restore by DID, transient network failures no longer log you out, and a dead refresh token silently re-authenticates via `prompt=none` (no login screen while your bsky.social cookie lives)
- **Network-first onboarding** — pick Bluesky / Mastodon / Threads, connect inline with OAuth or app password
- **Tabbed settings** — six sections: Account / Appearance / Content / Compose / Advanced / About

### Features

- Mastodon server-side filters (v2 API: context, expiry, whole-word, full CRUD UI)
- Mastodon list membership management (add/remove accounts, list browsing)
- Mastodon follow requests (Accept/Reject on notification cards), instance announcements as dismissible pinned cards, post edit-history badge, server-side translation (instance API first, third-party fallback)
- Mastodon custom emoji rendered inline in posts
- Bluesky post gates ("No quotes" via `app.bsky.feed.postgate`), self-labels (graphic-media/nudity/porn/gore), profile-pinned posts, server-synced muted words
- Bluesky starter pack search rebuilt on the official `searchStarterPacks` API with multi-strategy public fallback and relevance ranking
- Threads engagement: like/unlike, repost, quote wired into the feed
- GIF embeds render inline (autoplay muted video for MP4 variants) instead of blank link cards
- Alt-text badge overlay on post images with popover
- Configurable sidebar with simple mode; dashboard progressive disclosure (5 primary tiles + "More actions")
- Touch deck column reorder (long-press + haptics), pull-to-refresh, heart-burst like animation, shimmer skeletons, directional slide transitions, PWA notification badge, share target + shortcuts, safe-area fixes
- Dynamic version + git hash shown in Settings → About

### Performance

- Five optimization phases: parallelized API calls across gallery/trending/lists/notifications/deck, SWR caching, IndexedDB singletons, O(1) notification dedup, archive index queries, vendor chunk splitting, DNS prefetch/preconnect (incl. cdn.bsky.app), service-worker cache auto-versioning, fixed memory leaks and `$derived` anti-patterns
- Account clients now initialize in parallel — first feed fetch starts sooner
- Post media loads eagerly (lazy-load and `content-visibility` removed after they caused 20–60s image delays); images capped at consistent heights

### Fixes

- **Bluesky OAuth sessions no longer die silently** (the cause of "No posts yet" decks, "timeline unavailable" feeds, and DMs demanding reconnect): sessions restore directly by DID, only genuine token revocations count as expired, transient failures retry with backoff, and re-auth updates the existing account instead of duplicating it
- Deck columns work for OAuth accounts (timeline/mentions/notifications use the OAuth agent)
- Deck duplicate-key crash fixed (posts deduped by URI)
- Stale client cache invalidated after OAuth reconnect
- Vercel API routes converted to Web API Request/Response (fixes build-time TS errors); cron schedule fixed for Hobby plan
- `$state` runtime error fixed (pull-to-refresh moved to `.svelte.ts`)
- CI: Rust checks unblocked (unpinned optional `crispasr` git dependency), vitest unhandled-rejection failures fixed, onboarding E2E tests updated for the redesigned welcome screen

### Tests

- 1,177 frontend unit tests across 86 files (up from 962 at v1.0.0), 29 Playwright E2E tests, 15 Rust tests — CI fully green on Linux/macOS/Windows

## v1.0.0 — 2026-06-12

First stable release. See the [v1.0.0 release notes](https://github.com/CrispStrobe/CrispDeck/releases/tag/v1.0.0).
