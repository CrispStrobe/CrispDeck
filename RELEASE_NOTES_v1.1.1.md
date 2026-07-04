# CrispDeck v1.1.1

Bug fixes, official Bluesky bookmarks, and media reliability improvements.

**Live**: https://crispdeck.vercel.app

---

## Highlights

- **Official Bluesky bookmarks** via the new `app.bsky.bookmark.*` API
- **GIF playback fixed** -- klipy embeds actually play now
- **Starter pack search fixed** -- works again after Bluesky's auth change
- **Media sizing rebuilt** on the official bsky.app model -- responsive, aspect-ratio-aware
- **1,192 unit tests** + **29 Playwright E2E tests** + **15 Rust tests**, CI green on all platforms

---

## What's New

### Official Bluesky Bookmarks

Bluesky 1.108 introduced server-side bookmarks (`app.bsky.bookmark.createBookmark`, `deleteBookmark`, `getBookmarks`). CrispDeck now writes through to these endpoints:

- **Bookmark toggle** on any Bluesky post writes to local store first, then does a best-effort write-through to the server -- local state is always reliable even if the API call fails
- **Sync button** on the Bookmarks page imports all server-side Bluesky bookmarks (paginated, up to 1,000 items) alongside existing Mastodon bookmarks
- Uses `agent.call()` directly since `@atproto/api` doesn't yet include these lexicons

### GIF Playback Fix

Klipy GIF embeds were broken -- the old code guessed a `/v/{token}.mp4` URL pattern that 404'd, leaving a blank box where the GIF should be. The fix:

- Klipy `.gif` URLs carry `mp4=` and `webm=` query params with token strings
- New `variant()` helper replaces only the filename in the existing pathname, producing correct sibling-file URLs (`{token}.mp4`, `{token}.webm`)
- Added `gifVideoFailed` state flag -- if all video sources error, falls back gracefully to a plain `<img>` tag showing the original GIF

### Starter Pack Search Fix

Bluesky's public appview started returning 403 for unauthenticated search requests, silently killing the starter pack search fallback. The fix routes all search through the authenticated agent with a three-strategy cascade:

1. **Direct lookup** if the query looks like a handle (contains `.` or `@`) -- calls `getActorStarterPacks`
2. **Official search** via `searchStarterPacks` API (up to 3 pages, 25 results each)
3. **Post-based fallback** -- searches posts mentioning "starter pack", extracts author handles and `bsky.app/starter-pack/` URLs via regex, resolves each to their packs (up to 20 handles in parallel)

Results are deduplicated by URI and sorted by name/description match score then member count.

### Media Sizing Rebuilt

Replaced ad-hoc fixed heights (`max-h-64`, `aspect-video`) with a unified `mediaBoxStyle()` helper that matches the official bsky.app web behavior:

- Computes `aspect-ratio` from the embed's native dimensions (`aspectRatio` for Bluesky images/videos, `ww`/`hh` URL params for klipy GIFs, `meta.original` for Mastodon)
- Portrait images clamped to never exceed square (center-crop, matching bsky.app)
- Viewport cap: `max-height: min(32rem, 80svh)` -- responsive from small phones (portrait/landscape) to wide desktop columns and narrow deck columns

---

## Infrastructure

### Release CI: macOS Intel Cross-Compile

GitHub retired the `macos-13` Intel hosted runners -- jobs targeting them queued indefinitely. The Intel build now cross-compiles on `macos-14` (ARM64) with `--target x86_64-apple-darwin`. The ARM64 native build continues unchanged.

---

## Test Suite

| Category | Count |
|----------|-------|
| Frontend unit tests | 1,192 across 86 files |
| Playwright E2E tests | 29 |
| Rust tests | 15 |
| **Total** | **1,236** |

CI green on Linux (ubuntu-24.04), macOS (macos-14), and Windows (windows-latest).

---

## Install

- **Web**: https://crispdeck.vercel.app
- **Desktop**: Download from the [GitHub release assets](https://github.com/CrispStrobe/CrispDeck/releases/tag/v1.1.1) (macOS ARM64, macOS Intel, Windows x64, Linux x64 .deb)

## Upgrade

If you're already on v1.1.0, this is a safe patch upgrade. No breaking changes, no migration needed.
