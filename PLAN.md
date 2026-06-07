# CrispDeck Development Plan

## What is CrispDeck

A unified Mastodon + Bluesky social media client with:
- Multi-column TweetDeck-style deck view
- Crossposting with intelligent thread splitting
- Identity matching across platforms (Jaro-Winkler)
- Local analytics, archive, translation (CrispASR/BYOK/MyMemory)
- Desktop (Tauri 2) + Web (SvelteKit 2 SPA on Vercel)

**Tech stack**: SvelteKit 2, Svelte 5 (runes), Tailwind CSS 4, Vite 6, Tauri 2, TypeScript + Rust, Vitest

## Current State (2026-06-06)

v0.7.0 — 659 tests (55 test files), 29 pages, live at https://crispdeck.vercel.app

**License**: AGPL-3.0-only

---

## Completed Items (1–48, except 32)

All items below are **done** and committed. This section exists as reference for context only.

### Phase 1–3 (v0.1–v0.3): Core features (items 1–25)
Analytics with full pagination, local post archive (IndexedDB), deck columns (11 types), feed improvements, DM support, profile pages, bookmarks, thread view, compose with crossposting/threading/polls/templates/drafts, emoji/GIF picker, keyboard shortcuts, i18n (8 languages), RTL, accessibility, CrispASR integration (TTS/STT/translation), starter packs, Bluesky lists/labelers/moderation lists, custom PDS resolution, alt text enforcement, cargo-license integration, voice commands, share-as-image, feed scroll/refresh performance.

### Phase 4 (v0.4.0): Competitive features (items 26–41, 44–48)

| # | Feature | Key files |
|---|---------|-----------|
| 26 | Notification grouping/batching | `src/lib/notification-grouping.ts`, notifications page, deck column |
| 27 | Cross-network dedup (identity-enhanced) | `src/lib/api/unified.ts` (`detectCrossposts` + `buildIdentityPairs`) |
| 28 | Catch-up mode | `src/lib/catchup.ts`, `src/routes/catchup/+page.svelte` |
| 29 | AI compose assistance (BYOK) | `src/lib/compose/ai.ts`, compose page toolbar |
| 31 | RSS feed integration + OPML import | `src/lib/rss.ts`, deck RSS column, settings UI |
| 33 | "For You" algorithmic feed | `src/lib/for-you.ts`, feed page "For You" mode |
| 34 | Bluesky Jetstream real-time counters | `src/lib/jetstream.ts`, Post component subscription |
| 35 | OLED dark theme | `src/app.css` `[data-theme="oled"]`, layout toggle |
| 36 | Tag groups | `src/lib/tag-groups.ts`, deck tag-group column, settings UI |
| 37 | Post scheduling calendar view | drafts page week grid |
| 38 | Hide engagement counts | Post component + settings toggle |
| 39 | Thread un-rolling | thread page "Read as article" mode |
| 40 | Cross-platform analytics comparison | analytics page: best times, day-of-week chart, hourly chart |
| 41 | Optimal crosspost timing | `src/lib/posting-times.ts`, compose page timing hint |
| 42 | Follower graph visualization | identities page overlap bar chart |
| 44–48 | Polish fixes | snake_case media/cards, shortcuts dialog, For You hint, AI menu close |

**Item 32 (DeepL) was implemented then reverted** — we prefer own services (CrispASR local, BYOK, MyMemory free fallback).

---

## Remaining Work

### 30. Visual Bluesky feed builder
- **Status**: Done (client-side preview + deck integration; network publishing deferred)
- **Effort**: Medium
- **Description**: GUI for creating custom Bluesky algorithmic feeds without coding
- Filter by: keywords, exact phrases, language, has-media, author list, exclude terms, domain, mentions, date range
- Live preview using `app.bsky.feed.searchPosts` (Lucene-like query syntax)
- Save/load/duplicate/delete feed definitions (localStorage)
- Add custom feeds as deck columns
- **Key files**: `src/lib/feed-builder.ts`, `src/routes/feed-builder/+page.svelte`
- **Note**: Publishing to the Bluesky network via `app.bsky.feed.generator` requires a running feed generator server (implements `getFeedSkeleton`). The client-side preview and deck column integration work fully without a server. Network publishing is a future enhancement.

### 43. Threads support (hybrid: official API + ActivityPub federation)
- **Status**: Done
- **Effort**: Medium (single session)
- **Description**: Add Threads as a third network using a hybrid approach

#### Why hybrid?
- The official Threads API has **no home timeline/feed endpoint** — you can post, read your own posts, search, and get insights, but cannot scroll a feed
- However, Threads has opt-in ActivityPub federation — Threads users appear as `@user@threads.net` and their posts flow through Mastodon instances
- **Reading**: Already works via existing Mastodon columns (federated Threads posts). Add UI to discover/follow `@user@threads.net` accounts
- **Writing**: Use the official Threads API for crossposting from compose

#### Official Threads API details
- **Free**, no paid tiers — just rate limits
- **Auth**: OAuth 2.0 via `threads.net/oauth/authorize`, token exchange at `graph.threads.net`
- **Token management**: Short-lived token → immediately swap for long-lived (58-day). Refresh via `th_refresh_token` grant type (uses access token itself, no separate refresh token)
- **Scopes**: `threads_basic`, `threads_content_publish`, `threads_manage_replies`, `threads_manage_insights`
- **Publishing**: Container-then-publish flow (all major clients use this pattern):
  1. Create container: `POST /{user_id}/threads` with text/media/reply context
  2. Poll status until "FINISHED" / "PUBLISHED"
  3. Trigger publication: `POST /{user_id}/threads_publish`
- **Carousel posts**: Create individual item containers with `is_carousel_item=true`, then parent CAROUSEL container referencing children IDs, then publish
- **Media**: Threads does NOT accept direct uploads — requires publicly accessible HTTPS URLs
- **Rate limits**: 250 posts/day, 1000 replies/day, 200 requests/hour
- **Limits**: 500-char caption max
- **Analytics**: Per-post insights (views, likes, replies, reposts, quotes) via `/{post_id}/insights`

#### Implementation plan
1. **Threads OAuth login** — new provider in auth, store long-lived token in localStorage
2. **Threads API client** — `src/lib/api/threads.ts` wrapping official REST API directly (existing TS SDKs are thin/unmaintained)
3. **Crosspost adapter** — add Threads to compose page alongside Mastodon + Bluesky, handle 500-char limit, container publish flow
4. **Identity matching** — detect `@user@threads.net` in Mastodon federation, link to Threads identity for dedup
5. **"Find on Threads" helper** — UI to search/follow Threads users via their federated ActivityPub address
6. **Analytics integration** — Threads post insights in analytics page alongside Mastodon + Bluesky metrics
7. **Deck column** — "Threads" column type showing user's own Threads posts (via API) and federated Threads content (via Mastodon)

#### Meta error codes to handle
- Error code 24: API propagation delay (retry with exponential backoff)
- Error 2207051: Community restriction
- Error 4279013: Account block

#### Reference implementations (all AGPL-3.0, license-compatible)
- **OpenPost** (SvelteKit + Go) — cleanest adapter pattern, 3-step container flow
- **BrightBean Studio** (Django/Python) — best carousel implementation, clean provider abstraction
- **Postiz** (Next.js + NestJS, 31.5k stars) — most complete Threads integration with account-level + per-post analytics, 30+ platforms

### Future: Nostr support
- **Status**: Not started
- **Effort**: Very large (multi-week)
- **Description**: Extend to Nostr (NIP-01 relay protocol)
- Requires new crypto-based auth (nsec/npub keys), relay connections, event normalization
- Deferred — evaluate after Threads ships

---

## Phase 5: New Features

### 49. Muted words / content filters
- **Status**: Done
- **Effort**: Small
- **Description**: User-defined keyword mute list that hides posts containing those words across all platforms
- localStorage list of muted words/phrases
- Filter applied in feed rendering pipeline (filterPosts in unified.ts)
- Settings UI to manage muted words
- Support regex patterns for advanced users

### 50. Platform bookmarks sync
- **Status**: Done (Mastodon import; Bluesky lacks public bookmarks API)
- **Effort**: Medium
- **Description**: Sync local bookmarks with platform-native bookmarks
- Import from Bluesky bookmarks API and Mastodon bookmarks API
- Two-way sync or at least import/export
- Currently bookmarks are local-only IndexedDB

### 51. Multi-account timeline merge
- **Status**: Done
- **Effort**: Medium
- **Description**: Merge timelines from multiple accounts of the same platform
- If user has 2 Mastodon accounts or 2 Bluesky accounts, merge their timelines
- Account-source indicator on each post
- Currently picks one client per platform in deck/feed

### 52. Keyboard navigation (vim-style)
- **Status**: Done
- **Effort**: Medium
- **Description**: Power-user keyboard navigation for posts and deck
- j/k to scroll through posts, n/p for next/previous column in deck
- o to open post, r to reply, l to like, b to boost/repost
- ? to show keyboard shortcut overlay
- Differentiates from mobile-first competitors

### 53. Post statistics overlay
- **Status**: Done
- **Effort**: Small
- **Description**: Click a post to see detailed engagement breakdown
- Historical engagement curve if archive data exists
- Per-platform comparison for crossposts
- Engagement rate calculation

### 54. Draft auto-save
- **Status**: Done
- **Effort**: Small
- **Description**: Periodically save compose text to localStorage
- Survives page reloads and browser crashes
- Restore prompt on compose page load if unsent draft exists
- Clear on successful post

### 55. Quick-follow from anywhere
- **Status**: Done
- **Effort**: Small
- **Description**: One-click follow button on post author avatars
- Available in feed, deck, search, trending — not just profile pages
- Shows follow/unfollow state
- Works across all platforms

### 56. Export/import settings
- **Status**: Done
- **Effort**: Small
- **Description**: Backup all localStorage config to JSON file and restore
- Includes: deck layouts, tag groups, RSS feeds, feed builder definitions, custom feeds, preferences
- Excludes: account credentials (security)
- Useful for device migration or backup

### 57. Muted words wired into feed/deck pipelines
- **Status**: Done
- **Effort**: Small
- **Description**: applyMuteFilter() integrated into feed page and deck column rendering

### 58. Quick-follow API callback
- **Status**: Done
- **Effort**: Small
- **Description**: Follow button on Post avatar calls onfollow callback prop for API integration

### 59. Pinned posts
- **Status**: Done
- **Effort**: Small
- **Description**: Pin/unpin posts to top via localStorage, pin button on Post component

### 60. Read position sync
- **Status**: Done
- **Effort**: Small
- **Description**: Remember scroll position per context (feed, deck columns), find "left off" marker

### 61. Notification sounds + desktop alerts
- **Status**: Done
- **Effort**: Small
- **Description**: Web Audio API beep + Notification API, toggle in settings

### 62. Threads media posting
- **Status**: Done
- **Effort**: Small
- **Description**: Support image/video URLs + carousel in Threads container-then-publish flow

### 63. Post analytics history (engagement snapshots)
- **Status**: Done
- **Effort**: Medium
- **Description**: IndexedDB storage for periodic engagement snapshots, growth curve data per post

---

## Phase 7: Analytics & Content Management

### 64. Media gallery view
- **Status**: Done
- **Effort**: Medium
- **Description**: Masonry grid view for browsing all media from a user or hashtag
- Click to expand, swipe through images
- Filter by media type (images, video, links)
- Works with existing post data, new rendering mode

### 65. Content calendar
- **Status**: Done
- **Effort**: Medium
- **Description**: Full month/week calendar showing past posts + scheduled drafts
- Combines archive data with draft scheduling
- Color-coded by platform
- Click day to see posts, click post to open

### 66. Cross-platform analytics comparison
- **Status**: Done (already existed — best times, day-of-week, hourly charts)
- **Effort**: Medium
- **Description**: Side-by-side charts comparing engagement per platform
- Bar charts for likes/reposts/replies per platform
- Best-performing content analysis
- Day-of-week and hourly heatmaps per platform

### 67. Engagement milestones
- **Status**: Done
- **Effort**: Small
- **Description**: Alert when a post hits engagement thresholds
- Configurable thresholds (10, 50, 100, 500 likes)
- Uses engagement-history snapshots + notification-alerts system
- Optional sound + desktop notification

### 68. Reading lists
- **Status**: Done
- **Effort**: Medium
- **Description**: Themed post collections beyond flat bookmarks
- Create named lists ("AI articles", "Svelte tips", "Read later")
- Add posts to lists from Post component
- Browse and manage lists on dedicated page

## Phase 8: Future Enhancements

### 69. Post templates with variables
- **Status**: Not started
- **Effort**: Small
- **Description**: Extend templates with {date}, {time}, {day}, {handle} interpolation

### 70. Bluesky starter pack creator
- **Status**: Not started
- **Effort**: Medium
- **Description**: Build and publish starter packs from identity database

### 71. Unified trending
- **Status**: Not started
- **Effort**: Small
- **Description**: Merge Bluesky + Mastodon trending into one combined view

### 72. PWA install support
- **Status**: Not started
- **Effort**: Small
- **Description**: manifest.json + service worker for "Add to Home Screen"

### 73. List management
- **Status**: Not started
- **Effort**: Medium
- **Description**: Create/edit/delete Mastodon lists and Bluesky lists from CrispDeck

### 74. Post performance insights
- **Status**: Not started
- **Effort**: Medium
- **Description**: Pattern analysis — "image posts get 3x more engagement than text-only"

### 75. Cross-network thread sync
- **Status**: Not started
- **Effort**: Large
- **Description**: Post thread on one platform, auto-create on others with optimized formatting

---

## Known Issues / Future Polish

### i18n coverage
- **EN and DE**: 100% complete
- **ES**: 100% complete
- **FR, JA, PT, ZH**: ~30% coverage (nav, compose, feed, settings basics only)
- **AR**: ~20% coverage (minimal)
- All missing keys fall back to English via `deepMerge`.

### Mastodon API property casing
- `normalizePost()` in `src/lib/api/unified.ts` handles both camelCase (masto library) and snake_case (raw fetch) for: `repliesCount`/`replies_count`, `reblogsCount`/`reblogs_count`, `favouritesCount`/`favourites_count`, `createdAt`/`created_at`, `inReplyToId`/`in_reply_to_id`, `displayName`/`display_name`
- `getMastodonMedia()` handles `mediaAttachments`/`media_attachments`, `previewUrl`/`preview_url`
- `getMastodonCard()` handles `card`/`preview_card`, `providerName`/`provider_name`
- If adding new Mastodon raw-fetch code, always handle both casings.

### Bluesky embed types handled
Post component (`src/lib/components/Post.svelte`) handles:
- `app.bsky.embed.images#view` — image grid
- `app.bsky.embed.external#view` — link card with thumbnail
- `app.bsky.embed.record#view` — quoted post
- `app.bsky.embed.video#view` — video with thumbnail + play button
- `app.bsky.embed.recordWithMedia#view` — nested: extracts both media and quote

### Translation providers
- **CrispASR** (desktop only) — local M2M-100 GGUF models, offline, no API key
- **BYOK OpenAI-compatible** — user provides endpoint + key (supports Ollama, llama.cpp, Groq, etc.)
- **MyMemory** — free fallback, no registration, 5K chars/day, anonymous API
- Config stored in localStorage key `crispdeck-translate-config`
- We do NOT use commercial translation services (DeepL was reverted).

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

Key competitive advantages: deck+multi-network+Threads (unique combo), cross-platform analytics (no competitor), catch-up mode, AI compose, "For You" local algorithm, thread un-rolling, real-time Jetstream counters, Threads hybrid reading via ActivityPub.
