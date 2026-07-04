# Changelog

## Unreleased

- **Official Bluesky bookmarks** (`app.bsky.bookmark.*`, Bluesky 1.108+): bookmarking a Bluesky post writes through to the server; the bookmarks page sync imports server bookmarks alongside Mastodon
- **GIF playback fixed**: klipy GIF embeds played a guessed MP4 URL that 404'd, leaving a blank box — now uses klipy's real sibling-file URL scheme (mp4 + webm) with a plain-GIF fallback on error
- **Starter pack search fixed**: Bluesky's public appview now 403s unauthenticated search, silently killing the fallback — search now goes through the authenticated agent and reports auth problems instead of "no packs found"
- **Media sizing rebuilt on the official app's model**: images/videos/GIFs fill the column width at their native aspect ratio (from the embed's `aspectRatio`, klipy `ww`/`hh` params, or Mastodon `meta.original`), clamped to never exceed square with center-crop like bsky.app, plus a `min(32rem, 80svh)` viewport cap — responsive from small phones (portrait/landscape) to wide desktop and narrow deck columns
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
