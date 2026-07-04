# CrispDeck Development Plan

## What is CrispDeck

A unified Mastodon + Bluesky + Threads social media client with:
- Multi-column deck view
- Crossposting with intelligent thread splitting
- Identity matching across platforms (Jaro-Winkler)
- Local analytics, archive, translation (CrispASR/BYOK/MyMemory)
- Desktop (Tauri 2) + Web (SvelteKit 2 SPA on Vercel)

**Tech stack**: SvelteKit 2, Svelte 5 (runes), Tailwind CSS 4, Vite 6, Tauri 2, TypeScript + Rust, Vitest

## Current State (2026-07-04)

v1.2.0 — 1,443 unit tests across 99 files + 29 Playwright E2E tests, 29 pages, 20 deck column types, CI fully green, live at https://crispdeck.vercel.app. Full deck parity release with floating compose, column keyboard navigation, per-column notifications, density modes, streaming for all columns, 5 new column types, and shareable collections. See CHANGELOG.md.

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

### 30. Visual Bluesky feed builder + network publishing
- **Status**: Done (client-side preview + deck integration + network publishing)
- **Effort**: Medium
- **Description**: GUI for creating custom Bluesky algorithmic feeds without coding
- Filter by: keywords, exact phrases, language, has-media, author list, exclude terms, domain, mentions, date range
- Live preview using `app.bsky.feed.searchPosts` (Lucene-like query syntax)
- Save/load/duplicate/delete feed definitions (localStorage)
- Add custom feeds as deck columns
- **Publish to Bluesky network**: creates `app.bsky.feed.generator` record on user's PDS
- **Feed generator server**: Vercel serverless functions at `/xrpc/` endpoints
  - `getFeedSkeleton` looks up feed query from Vercel Blob, caches in-memory 5min + CDN 60s
  - `describeFeedGenerator` returns service metadata
  - `did:web:crispdeck.vercel.app` DID document at `/.well-known/did.json`
  - Feed definitions stored in Vercel Blob (`feeds/<rkey>.json`)
  - Human-readable rkeys (e.g. `my-svelte-feed-mq5qo7ty0`)
  - `api/feed/publish.ts` + `api/feed/unpublish.ts` manage Blob storage
- **Key files**: `src/lib/feed-builder.ts`, `src/routes/feed-builder/+page.svelte`, `api/xrpc/`, `api/feed/`, `static/.well-known/did.json`

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
- **Status**: Done (Mastodon import + official Bluesky app.bsky.bookmark.* since Bluesky 1.108 — write-through on bookmark, paginated import on sync)
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
- **Status**: Done
- **Effort**: Small
- **Description**: Extend templates with {date}, {time}, {day}, {handle} interpolation

### 70. Bluesky starter pack creator
- **Status**: Done
- **Effort**: Medium
- **Description**: Build and publish starter packs from identity database

### 71. Unified trending
- **Status**: Done
- **Effort**: Small
- **Description**: Merge Bluesky + Mastodon trending into one combined view

### 72. PWA install support
- **Status**: Done
- **Effort**: Small
- **Description**: manifest.json + service worker for "Add to Home Screen"

### 73. List management
- **Status**: Done
- **Effort**: Medium
- **Description**: Create/edit/delete Mastodon lists and Bluesky lists from CrispDeck

### 74. Post performance insights
- **Status**: Done
- **Effort**: Medium
- **Description**: Pattern analysis — "image posts get 3x more engagement than text-only"

### 75. Cross-network thread sync
- **Status**: Done
- **Effort**: Large
- **Description**: Post thread on one platform, auto-create on others with optimized formatting

---

## Phase 9: Power-User & Real-Time Features

### 76. Saved deck layouts / workspaces
- **Status**: Done
- **Effort**: Small
- **Description**: Name, save, switch between, rename, duplicate, and delete column layouts
- Quick workspace switching between e.g. "Work", "Personal", "Monitoring"
- Active layout persisted across reloads
- Deep-cloned columns prevent mutation bugs
- **Key files**: `src/lib/deck-layouts.ts`

### 77. AI alt-text generation (multi-provider)
- **Status**: Done
- **Effort**: Medium
- **Description**: Generate image alt-text at compose time with 3 provider backends
- **BYOK (OpenAI-compatible)**: Uses vision API format (image_url content type), works with GPT-4o, Ollama, llama.cpp server, etc.
- **CrispASR (bundled llama.cpp)**: Tauri desktop only, runs LLaVA/multimodal models locally via CrispASR FFI, no API key needed
- **mistral.rs (Rust-native)**: Tauri desktop only, Rust inference engine supporting Phi-3-Vision and similar, no API key needed
- Also refactored AI compose to support provider selection for all actions (correct, shorten, hashtags, alt-text)
- **Key files**: `src/lib/compose/ai.ts`

### 78. Hashtag bank for compose
- **Status**: Done
- **Effort**: Small
- **Description**: Save named sets of hashtags for one-click insertion into compose
- Auto-prefixes # on bare tags
- Format sets as space-separated strings for insertion
- CRUD with localStorage persistence
- **Key files**: `src/lib/hashtag-bank.ts`

### 79. Universal cross-network search
- **Status**: Done
- **Effort**: Medium
- **Description**: Single search querying Bluesky + Mastodon + Threads simultaneously
- Bluesky: `app.bsky.feed.searchPosts` API
- Mastodon: `/api/v2/search?type=statuses`
- Threads: `graph.threads.net/search`
- Merges results with engagement/recency scoring, URI-based dedup
- Crosspost grouping via existing `detectCrossposts` at UI layer
- **Key files**: `src/lib/universal-search.ts`

### 80. Streaming timelines for deck columns
- **Status**: Done
- **Effort**: Medium-Large
- **Description**: Real-time live-push of new posts in deck columns
- Bluesky: Extends Jetstream WebSocket for `app.bsky.feed.post` events, filters by followed DIDs
- Mastodon: `/api/v1/streaming` WebSocket (user, public, local, hashtag, list streams)
- Stream manager coordinates per-column streams with shared connections
- Opt-in toggle per column via `streaming` flag
- Auto-reconnect with 5s backoff
- **Key files**: `src/lib/streaming.ts`

### 81. BYOK provider presets with model discovery
- **Status**: Done
- **Effort**: Medium
- **Description**: Provider preset system with /models endpoint polling for model selection
- 10 presets: OpenRouter, Scaleway, Nebius, Mistral, Poe, Groq, Ollama, llama.cpp, OpenAI, Custom
- Each preset stores: base URL, models endpoint, default model, default vision model, auth config, docs URL
- `fetchAvailableModels()` polls `/models` endpoint and parses OpenAI-format response
- Session-scoped model cache (5 min TTL) avoids re-fetching on settings revisit
- Vision model selection for alt-text (e.g. GPT-4o, Pixtral, LLaVA, Phi-3-Vision)
- Wired into AI compose config: `presetId` + `visionModel` fields
- **Key files**: `src/lib/byok-providers.ts`, `src/lib/compose/ai.ts`

---

## Phase 10: Keyword Monitoring & Polish

### 82. Keyword monitoring deck columns
- **Status**: Done
- **Effort**: Medium
- **Description**: New `keyword-monitor` column type that searches all 3 networks for keyword matches and streams live updates
- Comma-separated keywords with `/regex/` pattern support (OR logic)
- Initial load searches Bluesky `searchPosts`, Mastodon `/api/v2/search`, and Threads search
- Real-time streaming: Bluesky Jetstream firehose (unfiltered, client-side keyword filter) + Mastodon public WebSocket
- Saved keyword sets in localStorage with CRUD (Settings UI + deck add-column picker)
- Posts capped at 200 per column, deduped by URI
- **Key files**: `src/lib/keyword-monitor.ts`, `src/routes/deck/+page.svelte`

### 83. Live streaming indicator on deck columns
- **Status**: Done
- **Effort**: Small
- **Description**: Pulsing green "LIVE" badge in column header when streaming is active
- Driven by `streamCleanups` map tracking active stream subscriptions per column
- Applies to any streaming column, not just keyword monitors
- **Key files**: `src/lib/components/deck/DeckColumn.svelte`

### 84. Keyword monitor management in Settings
- **Status**: Done
- **Effort**: Small
- **Description**: CRUD UI for saved keyword sets in Settings page
- Create named sets with comma-separated keywords + regex patterns
- List existing sets with delete buttons
- Keyword sets included in settings export/import automatically (wildcard `crispdeck-*` pattern)
- i18n: EN + DE
- **Key files**: `src/routes/settings/+page.svelte`, `src/lib/keyword-monitor.ts`

### 85. Media lightbox overlay
- **Status**: Done
- **Effort**: Small
- **Description**: Images in posts open in fullscreen lightbox overlay instead of browser
- Keyboard navigation (Escape, arrows), image counter, alt text display
- "Open in browser" fallback button in overlay
- Settings preference: lightbox (default) vs open-in-browser
- Works for Bluesky images, Mastodon images, and quoted post images
- Gallery page refactored to use shared MediaLightbox component
- **Key files**: `src/lib/components/MediaLightbox.svelte`, `src/lib/components/Post.svelte`

### 86. Media Gallery fix
- **Status**: Done
- **Effort**: Small
- **Description**: Gallery was hanging with too many images
- Added pagination (24 items at a time, "Load more" button)
- Fixed video play icon positioning (missing `relative` on parent)
- Replaced inline lightbox with shared MediaLightbox component
- **Key files**: `src/routes/gallery/+page.svelte`

---

## Phase 11: Navigation Consolidation & UX Polish

Goal: reduce sidebar from 25 items to ~14 by merging related views into tabbed pages, and fix several UX issues with in-app linking and navigation.

### 87. Sidebar navigation consolidation
- **Status**: Done
- **Effort**: Large
- **Description**: The sidebar has 25 items — too many for usable navigation. Consolidate related views:

#### Merges:

| Current items | Merged into | How |
|---|---|---|
| Catch Up + Trending | **Discover** | Two tabs in one view |
| Compose + Drafts | **Compose** | Drafts as collapsible panel/tab within compose |
| Lists + Starter Packs + Feed Builder | **Lists & Feeds** | Tabs: Mastodon Lists, Bluesky Feeds, Starter Packs, Feed Builder |
| Gallery + Archive | **Archive** | Gallery as a tab alongside archive search/export |
| Reading Lists + Bookmarks | **Bookmarks** | Reading Lists as a tab within Bookmarks |
| Calendar | Move into **Analytics** as a tab (past posts + scheduled = calendar, analytics = charts) |
| Instance Info | Move into **Settings** as a section |
| Labelers + Moderation | **Moderation** | Tabs: Blocked/Muted, Labelers |

#### Resulting sidebar (~14 items):
1. Dashboard
2. Feed (incl. For You tab)
3. Discover (Catch Up + Trending tabs)
4. Deck
5. Compose (incl. Drafts tab)
6. Notifications
7. Messages
8. Bookmarks (incl. Reading Lists tab)
9. Lists & Feeds (Lists + Starter Packs + Feed Builder tabs)
10. Identities
11. Search
12. Archive (incl. Gallery tab)
13. Analytics (incl. Calendar tab)
14. Moderation (Blocked/Muted + Labelers tabs)
15. Settings (incl. Instance Info section)
16. About

#### Implementation notes:
- Each merge creates a tabbed container page that imports existing page content as components
- Route redirects: old routes (e.g. `/gallery`) redirect to new tab routes (e.g. `/archive?tab=gallery`)
- Mobile bottom bar stays at 5 icons: Feed, Compose, Notifications, Search, Messages
- Preserve deep-link support: `/bookmarks?tab=reading-lists` should open the right tab

### 88. In-app link routing for @handles and #hashtags in posts
- **Status**: Done
- **Effort**: Medium
- **Description**: Post HTML content contains `<a>` tags pointing to external Mastodon/Bluesky URLs for @mentions and #hashtags. These should route in-app instead.
- **Mastodon**: Intercept `<a>` clicks in rendered HTML, match `/@user` and `/tags/tagname` patterns, route via `goto()`
- **Bluesky**: Parse AT Protocol facets (mentions, links, tags) from post records to render rich HTML with clickable links. Fallback regex linkification for posts without facets
- **@handles**: Click `@user@instance.social` → open CrispDeck profile page `/profile?handle=user@instance.social`
- **#hashtags**: Click `#svelte` → open CrispDeck search `/search?q=%23svelte` or add as deck column
- External links (URLs to articles etc.) still open in browser
- In-app href links (starting with `/`) routed via `goto()` without full page reload
- **Key files**: `src/lib/components/Post.svelte` (post text rendering, `getBskyHtml()`, `handlePostLinkClick()`)

### 89. Platform filter shows only logged-in platforms
- **Status**: Done
- **Effort**: Small
- **Description**: The All/Bluesky/Mastodon/Threads filter appears even when only one platform has a logged-in account
- Only show filter buttons for platforms that have at least one connected account
- If only one platform is connected, hide the filter entirely
- **Key files**: `src/routes/feed/+page.svelte`, possibly deck and search pages

### 90. "Back to feed" scroll position restore
- **Status**: Done
- **Effort**: Small
- **Description**: Navigating from a post/thread back to feed should return to the scroll position where the user was
- Thread and profile page back buttons use `history.back()` instead of hardcoded `/feed` link
- Preserves scroll position regardless of navigation source (feed, deck, search, etc.)
- `src/lib/read-position.ts` already exists — wire it into feed/deck navigation
- **Key files**: `src/routes/thread/+page.svelte`, `src/routes/profile/+page.svelte`, `src/lib/read-position.ts`

### 91. Share-as-image error visibility
- **Status**: Done
- **Effort**: Small
- **Description**: `handleShareAsImage()` in Post.svelte silently catches errors — user sees nothing on failure
- Show a toast/inline error message when html2canvas fails (commonly CORS issues with cross-origin images)
- Consider: fall back to capturing without images if CORS blocks them
- **Key files**: `src/lib/components/Post.svelte`

### 92. "For You" auto-load on visit
- **Status**: Done
- **Effort**: Small
- **Description**: "For You" feed requires manual refresh before showing content — should auto-load on page visit
- Ensure the For You ranking algorithm runs on initial mount, not just on refresh
- **Key files**: `src/routes/feed/+page.svelte`, `src/lib/for-you.ts`

---

## Phase 12: Test Coverage

Goal: close gaps in unit test coverage for untested TypeScript modules. Current: 805 tests, 63 files, 31/38 lib/ files tested (81.6%). Target: 95%+ lib/ file coverage.

### 94. Tests for engagement-history.ts
- **Status**: Done
- **Effort**: Small
- **Description**: Engagement snapshot storage, growth curves, periodic capture (10 tests)
- **Key file**: `src/lib/engagement-history.ts`

### 95. Tests for list-management.ts
- **Status**: Done
- **Effort**: Small
- **Description**: Create/edit/delete Mastodon lists and Bluesky lists (11 tests)
- **Key file**: `src/lib/list-management.ts`

### 96. Tests for starter-pack-creator.ts
- **Status**: Done
- **Effort**: Small
- **Description**: Build and publish Bluesky starter packs from identity DB (8 tests)
- **Key file**: `src/lib/starter-pack-creator.ts`

### 97. Tests for browser-db.ts
- **Status**: Done
- **Effort**: Medium
- **Description**: Core IndexedDB implementation — data model, credential formats, dispatch (9 tests)
- **Key file**: `src/lib/browser-db.ts`

### 98. Tests for bluesky-oauth.ts
- **Status**: Done
- **Effort**: Small
- **Description**: Client_id construction, metadata shape, OAuth scopes (7 tests)
- **Key file**: `src/lib/api/bluesky-oauth.ts`

### 99. Tests for compose/mentions.ts
- **Status**: Done
- **Effort**: Small
- **Description**: @mention autocomplete, platform-specific handle resolution (11 tests)
- **Key file**: `src/lib/compose/mentions.ts`

### 100. Tests for db.ts (platform dispatcher)
- **Status**: Done
- **Effort**: Small
- **Description**: Platform dispatch delegation, function signatures (8 tests)
- **Key file**: `src/lib/db.ts`

### 101. Tests for store.ts
- **Status**: Done
- **Effort**: Small
- **Description**: Tauri plugin-store settings wrapper (5 tests)
- **Key file**: `src/lib/store.ts`

---

---

## Phase 13: Responsive UI & Polish

### 102. Condensed mobile layout
- **Status**: Done
- **Effort**: Small
- **Description**: Mobile top bar condensed to single row (hamburger + title + theme toggle + notification bell). Bottom tab bar slimmer with smaller icons/text. Reduced content padding offsets.
- **Key files**: `src/routes/+layout.svelte`

### 103. Inline relative timestamps in posts
- **Status**: Done
- **Effort**: Small
- **Description**: Post timestamp moved from bottom of post into author line as relative time (now/5m/2h/3d/Jun 3). Full date on hover. Bottom row shows platform name on hover instead of redundant date.
- **Key files**: `src/lib/components/Post.svelte`

### 104. Compact post mode
- **Status**: Done
- **Effort**: Small
- **Description**: Optional compact post view with smaller avatars (w-7 vs w-10), tighter spacing (p-2.5 vs p-4, gap-2 vs gap-3). Settings toggle persisted in localStorage.
- i18n: EN + DE
- **Key files**: `src/lib/components/Post.svelte`, `src/routes/settings/+page.svelte`

### 105. Identity scan follow cap
- **Status**: Done
- **Effort**: Small
- **Description**: Mastodon/Bluesky follow fetching capped at 2000 per platform to prevent UI hang when user follows hundreds of thousands of accounts.
- **Key files**: `src/routes/identities/+page.svelte`

### 106. Layout and responsive UI tests
- **Status**: Done
- **Effort**: Small
- **Description**: 39 tests covering sidebar nav structure, merged route matching, mobile tab bar, relativeTime formatting, compact mode, media preview mode, platform filter visibility, formatDate.
- **Key files**: `src/lib/layout.test.ts`

---

### 93. MyMemory commercial use notice
- **Status**: Done
- **Effort**: Tiny (docs only)
- **Description**: MyMemory free tier (5K chars/day) is for personal, non-commercial use only
- If CrispDeck is distributed commercially, need MyMemory paid plan or drop the fallback
- CrispASR (local) and BYOK (user's own key) have no such restriction
- Document this limitation clearly in PLAN.md and Settings UI tooltip
- Done: Settings tooltip now shows personal-use-only notice with link to terms

---

## Phase 14: Infrastructure & Performance

### 107. Stale-while-revalidate view cache
- **Status**: Done
- **Effort**: Medium
- **Description**: Shows cached data instantly on page load, refreshes from API in background
- localStorage cache with per-view keys and timestamps, 5-min TTL
- Wired into: feed, notifications, lists pages
- `swr()` helper for easy adoption in additional views
- 15 tests
- **Key files**: `src/lib/view-cache.ts`

### 108. Debug log viewer
- **Status**: Done
- **Effort**: Small
- **Description**: Captures console.error/warn + unhandled errors/rejections in a ring buffer (200 entries)
- Interceptors installed at app startup in layout
- Viewable in Settings as a scrollable monospace panel with level coloring
- Clear button to reset log
- 9 tests
- **Key files**: `src/lib/debug-log.ts`, `src/routes/settings/+page.svelte`

### 109. Additional translation providers
- **Status**: Done
- **Effort**: Medium
- **Description**: Add free/open translation alternatives alongside MyMemory
- **Lingva Translate**: Google Translate proxy, free, no API key, no commercial restriction, many public instances
- **LibreTranslate**: self-hosted or public instances, AGPL, free, fits BYOK pattern
- **Google Cloud Translation**: 500K chars/month free tier, requires API key (BYOK)
- **Argos Translate**: MIT-licensed, Python/CLI, potential CrispASR desktop integration
- **Key files**: `src/lib/translate.ts`, `src/routes/settings/+page.svelte`

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

## v1.0 Release Plan (2026-06-10)

### R1. Move CSP headers to vercel.json
- **Status**: Done
- **Effort**: Small
- **Description**: `hooks.server.ts` doesn't run with `adapter-static`. Move security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) to `vercel.json` headers config so they're actually served on the live site.

### R2. Add Playwright E2E to GitHub Actions CI
- **Status**: Done
- **Effort**: Small
- **Description**: The 28 E2E tests only run locally. Add a CI job to `.github/workflows/ci.yml` that builds the app, installs Chromium, and runs `npm run test:e2e`.

### R3. Bundle size analysis + optimization
- **Status**: Done (2.8MB total, well-split, no issues found)
- **Effort**: Medium
- **Description**: Run bundle analysis to check for oversized chunks, duplicate dependencies, or tree-shaking failures. Fix any issues found.

### R4. Version bump to v1.0.0
- **Status**: Done
- **Effort**: Small
- **Description**: Update version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`.

### R5. Final docs update for v1.0
- **Status**: Done
- **Effort**: Small
- **Description**: Final README pass — update test counts, version references, stats section. Update PLAN.md and memory file.

---

## Phase 15: Post Interactivity & Notifications (2026-07-03)

### 110. Interactive embedded/quoted posts
- **Status**: Done
- **Effort**: Small
- **Description**: Embedded/quoted posts in feed were static, non-clickable previews. Now:
- **Bluesky quotes**: Clickable button navigating to quoted post's thread view (`/thread?uri=...&platform=bluesky`)
- **Threads quotes**: Clickable button opening quoted post's permalink on threads.com
- Hover states (border brightens, background shifts), cursor pointer
- Larger text (`text-sm` instead of `text-xs`), primary color, 6-line clamp (was 3)
- Larger image previews (`max-h-48`), "+N more" indicator for multi-image quotes
- Image clicks in quotes still open lightbox (stopPropagation prevents navigation)
- **Key files**: `src/lib/components/Post.svelte` (`getBskyQuote()`, `getThreadsQuote()`)

### 111. Better image display in posts
- **Status**: Done
- **Effort**: Small
- **Description**: Images in posts were aggressively cropped to 16:9 aspect-video, cutting off most of the content
- Single images now show full picture scaled down (`object-contain`, `max-h-96`, dark background fill)
- Multi-image grids use square aspect ratio (`aspect-square`) instead of video crop
- Applies to both Bluesky and Mastodon/Threads images
- **Key files**: `src/lib/components/Post.svelte`

### 112. Bluesky rich text rendering with facets
- **Status**: Done
- **Effort**: Medium
- **Description**: Bluesky post text was rendered as plain text with no clickable elements
- Now parses AT Protocol facets from post records for pixel-accurate rich text
- Handles: `app.bsky.richtext.facet#link` (URLs), `#mention` (@handles → profile), `#tag` (#hashtags → search)
- UTF-8 byte-offset indexing for correct facet positioning with unicode text
- Fallback regex linkification for posts without facets (URLs and @handle.bsky.social patterns)
- Same `handlePostLinkClick()` handler routes in-app links via `goto()`
- **Key files**: `src/lib/components/Post.svelte` (`getBskyHtml()`, `escapeHtml()`, `linkifyPlainText()`)

### 113. Fix notifications for OAuth Bluesky accounts
- **Status**: Done
- **Effort**: Small
- **Description**: Notifications page showed empty because OAuth Bluesky accounts used read-only BlueskyClient that threw "Auth required"
- Root cause: `client-factory.ts` creates `BlueskyClient.readOnly()` for OAuth accounts (no `authAgent`), but stores `oauthAgent` in `ClientEntry` — never used
- Fix: notifications page now checks for `entry.oauthAgent` and calls `agent.api.app.bsky.notification.listNotifications()` directly for OAuth accounts
- App-password accounts continue using `BlueskyClient.getNotifications()` as before
- **Key files**: `src/routes/notifications/+page.svelte`, `src/lib/api/client-factory.ts`

---

## Phase 16: Performance Optimizations (2026-07-03)

### 114. detectCrossposts optimization
- **Status**: Done
- **Effort**: Medium
- **Description**: O(n²) Jaro-Winkler crosspost detection was the feed's main bottleneck
- Result caching by URI set (identical posts → instant return)
- Platform-indexed lookup (only compare across platforms, not all-vs-all)
- Pre-computed timestamps, text-length filter (>50% diff → skip)
- Early exit on >0.97 match score
- **Key files**: `src/lib/api/unified.ts`

### 115. Visibility-aware polling and WebSocket management
- **Status**: Done
- **Effort**: Medium
- **Description**: All background activity now pauses when tab is hidden
- Layout polling: 30s→60s, skips when hidden, refreshes on tab focus
- Deck auto-refresh: 3min→5min, skips when hidden, refreshes on focus
- Feed new-post polling: skips when hidden
- Jetstream: WebSocket closes when hidden, reconnects on focus
- Streaming: all deck WebSockets pause/resume on visibility
- Saves ~70% of background API calls
- **Key files**: `src/routes/+layout.svelte`, `src/routes/deck/+page.svelte`, `src/routes/feed/+page.svelte`, `src/lib/jetstream.ts`, `src/lib/streaming.ts`

### 116. Per-component caching (Post, bookmarks, pinned)
- **Status**: Done
- **Effort**: Medium
- **Description**: Eliminated N+1 lookups in feed rendering
- Jetstream: per-URI listener map (O(1) dispatch vs O(n) broadcast)
- Post.svelte: shared preferences cache (3 localStorage reads → 1 cached object)
- Bookmarks: in-memory URI Set cache (50 IndexedDB lookups → 1 batch getAllKeys)
- Pinned posts: cached URI Set (50 JSON.parse → 1 cached Set)
- Label prefs: cached JSON.parse with 10s TTL
- Mute filter: compiled regex cache by word fingerprint
- **Key files**: `src/lib/components/Post.svelte`, `src/lib/bookmarks.ts`, `src/lib/pinned-posts.ts`, `src/lib/muted-words.ts`, `src/lib/jetstream.ts`

### 117. Client initialization dedup + cache invalidation
- **Status**: Done
- **Effort**: Small
- **Description**: Module-level 5min cache in initAllClients() prevents redundant DB reads and OAuth session init on page navigation
- invalidateClientCache() called from settings on account add/remove
- Removed redundant layout-level cache (single source of truth)
- **Key files**: `src/lib/api/client-factory.ts`, `src/routes/settings/+page.svelte`

### 118. Build optimizations
- **Status**: Done
- **Effort**: Small
- **Description**: Vite and HTML optimizations for faster loading
- Manual chunks: @atproto/api, masto, lucide-svelte split into separate cacheable vendor bundles
- DNS prefetch hints for bsky.social, public.api.bsky.app, jetstream2, graph.threads.net
- DOMPurify preloaded at app startup (no HTML-strip fallback on first render)
- sortPosts: Schwartzian transform for date sorts (parse once, not per-comparison)
- rankForYou: inlined scoring to avoid redundant lookups
- **Key files**: `vite.config.js`, `src/app.html`, `src/lib/sanitize.ts`, `src/lib/api/unified.ts`, `src/lib/for-you.ts`

### 119. Feed cache size setting
- **Status**: Done
- **Effort**: Small
- **Description**: Configurable feed cache size (50-500 posts) in Settings UI
- Slider control in Cache & Storage section
- Persisted in localStorage, included in settings export/import
- **Key files**: `src/routes/settings/+page.svelte`, `src/routes/feed/+page.svelte`

### 120. Parallel notification fetching
- **Status**: Done
- **Effort**: Small
- **Description**: Notifications page fetched from accounts sequentially (N serial API calls). Now uses Promise.all() for parallel fetch across all accounts (~4x faster with 5 accounts).
- **Key files**: `src/routes/notifications/+page.svelte`

### 121. Debounced deck column filter
- **Status**: Done
- **Effort**: Small
- **Description**: Deck column filter input was re-filtering all posts on every keystroke. Now debounced at 200ms — only applies filter after user stops typing.
- **Key files**: `src/lib/components/deck/DeckColumn.svelte`

### 122. Throttled read position saves
- **Status**: Done
- **Effort**: Small
- **Description**: Read position saved to localStorage on every scroll event (sync I/O). Now uses in-memory cache with 500ms throttled writes. Added flushReadPositions() for page unload.
- **Key files**: `src/lib/read-position.ts`

### 123. Keyword matcher caching
- **Status**: Done
- **Effort**: Small
- **Description**: buildKeywordMatcher() now caches compiled matchers by entry fingerprint. Avoids re-creating regex objects on repeated calls (e.g., streaming column filtering).
- **Key files**: `src/lib/keyword-monitor.ts`

## Phase 17: Deep Performance Optimizations (2026-07-03)

### 124. Memory leak fixes
- **Status**: Done
- **Effort**: Small
- **Description**: Fixed three memory leaks:
  - `setInterval` in drafts page not cleaned up on navigation (cleanup fn not returned from `onMount`)
  - DeckColumn global `mousemove`/`mouseup` listeners not removed on component destroy mid-drag
  - TTS `audioEl` blob URL not revoked in `onDestroy`
- **Key files**: `src/routes/drafts/+page.svelte`, `src/lib/components/deck/DeckColumn.svelte`, `src/lib/components/Post.svelte`

### 125. PBKDF2 CryptoKey caching
- **Status**: Done
- **Effort**: Small
- **Description**: 600k-iteration PBKDF2 key derivation ran on every encrypt/decrypt call (~100-300ms each). Now cached in module-level variable after first derivation.
- **Key files**: `src/lib/browser-db.ts`

### 126. Feed loading parallelization
- **Status**: Done
- **Effort**: Medium
- **Description**: `loadFeed()`, `checkForNewPosts()`, and `checkUnreadMessages()` all used sequential `for...await` loops across accounts. Converted to `Promise.allSettled` for concurrent execution.
- **Key files**: `src/routes/feed/+page.svelte`, `src/routes/+layout.svelte`

### 127. Fix $derived anti-patterns
- **Status**: Done
- **Effort**: Medium
- **Description**: `$derived(() => ...)` returns a function, not a value — causing redundant re-execution on every access. Fixed across Post.svelte (postLabels: 5×→1×), analytics page (8 derived values), profile page (filteredPosts, mediaGallery), and analytics cutoffDate.
- **Key files**: `src/lib/components/Post.svelte`, `src/routes/analytics/+page.svelte`, `src/routes/profile/+page.svelte`

### 128. IndexedDB batching and singletons
- **Status**: Done
- **Effort**: Medium
- **Description**: Multiple IDB optimizations:
  - `cacheFollows`: N+M sequential writes → single `readwrite` transaction
  - `importPlatformBookmarks`: N sequential `addBookmark` → single batch transaction
  - `openDB()` in browser-db.ts, archive.ts, engagement-history.ts: added module-level singleton caching (avoid repeated `indexedDB.open()`)
- **Key files**: `src/lib/browser-db.ts`, `src/lib/bookmarks.ts`, `src/lib/archive.ts`, `src/lib/engagement-history.ts`

### 129. EmojiPicker search fix
- **Status**: Done
- **Effort**: Small
- **Description**: Search filter computed query `q` but never used it — all emojis always rendered regardless of search. Fixed to filter by category name match.
- **Key files**: `src/lib/components/EmojiPicker.svelte`

### 130. Build and rendering optimizations
- **Status**: Done
- **Effort**: Small
- **Description**: Multiple build and rendering improvements:
  - Vite: `build.target: 'es2022'` + `cssMinify: 'lightningcss'`
  - Svelte: `compilerOptions: { runes: true }` for smaller runtime
  - Deck columns: 50-post cap with "Show more" pagination (prevents 600+ Post components)
  - `jaroWinkler` deduplicated to `$lib/utils/string.ts` (was in browser-db.ts + unified.ts)
  - SW version auto-injected from git hash at build time via Vite plugin
  - `dns-prefetch` upgraded to `preconnect` for Bluesky hosts
  - `content-visibility: auto` on post cards for off-screen rendering skip
  - Image optimization: `loading="lazy"`, `decoding="async"`, `width`/`height` on avatars
- **Key files**: `vite.config.js`, `svelte.config.js`, `src/app.html`, `src/app.css`, `src/lib/components/deck/DeckColumn.svelte`, `src/lib/utils/string.ts`, `static/sw.js`

### 131. Comprehensive API parallelization
- **Status**: Done
- **Effort**: Medium
- **Description**: Every remaining sequential `for...await` loop across the entire app converted to `Promise.allSettled`:
  - `loadMore()`, `loadNewPosts()` in feed page
  - `loadPosts()` in catchup page
  - `loadConversations()` in messages page
  - `handleSearch()` in search page
  - `loadMedia()` in gallery page
  - `loadBskyTrending`/`loadMastoTrending` in trending page (parallel)
  - `loadLists()` in lists page (+ batch Bluesky feeds/lists)
- **Key files**: All route pages

### 132. Template computation optimizations
- **Status**: Done
- **Effort**: Medium
- **Description**: Hoisted expensive computations from Svelte templates to `$derived` state:
  - Compose page: `splitForPlatform` called 3× per render → 3 `$derived` values
  - Post.svelte: `new URL().hostname` and `relativeTime()` → `$derived` values
  - Trending page: `totalUses()` and `new URL().hostname` → pre-computed in `$derived` arrays
  - Post.svelte: `getMastodonHtml()` called 3× → reuse cached `mastodonHtml`
  - Layout keyboard handler: `querySelectorAll('[data-post-uri]')` cached with 2s TTL
  - Settings: inline `localStorage.getItem` in template → `$state` variable
- **Key files**: `src/routes/compose/+page.svelte`, `src/lib/components/Post.svelte`, `src/routes/trending/+page.svelte`, `src/routes/+layout.svelte`, `src/routes/settings/+page.svelte`

### 133. WebSocket exponential backoff
- **Status**: Done
- **Effort**: Small
- **Description**: Fixed 5-second reconnect timer → exponential backoff (5s base, 2× per attempt, 60s cap) with reset on successful connection. Applied to MastodonStream, BlueskyStream, and JetstreamClient.
- **Key files**: `src/lib/streaming.ts`, `src/lib/jetstream.ts`

### 134. Crosspost detection cache improvements
- **Status**: Done
- **Effort**: Small
- **Description**: Two improvements:
  - Cache key changed from O(N) string join to O(N) hash (saves ~10KB string allocation per feed update)
  - Cache key made order-independent (hash-based) so re-sorting the same posts doesn't trigger O(N²) redetection
- **Key files**: `src/lib/api/unified.ts`

### 135. Deck column optimizations
- **Status**: Done
- **Effort**: Small
- **Description**: Three deck improvements:
  - Client groups (allBsky/allMasto/allThreads) precomputed once after init instead of per-column load
  - Staggered column refresh on tab re-focus (150ms between columns) to avoid thundering herd
  - RSS importOPML: N×read+write to localStorage → single batch write
- **Key files**: `src/routes/deck/+page.svelte`, `src/lib/rss.ts`

### 136. Stale-while-revalidate page caching
- **Status**: Done
- **Effort**: Small
- **Description**: Added SWR caching to high-traffic pages for instant display on revisit:
  - Trending page: 10-minute TTL, shows cached data instantly while refreshing
  - Profile page: 5-minute TTL per handle, shows cached profile+posts instantly
- **Key files**: `src/routes/trending/+page.svelte`, `src/routes/profile/+page.svelte`

### 137. Archive stats optimization
- **Status**: Done
- **Effort**: Small
- **Description**: `getArchiveStats()` was doing `getAll()` full IDB scan to compute counts. Replaced with parallel `IDBIndex.count()` calls and cursor-based date range — O(N) → O(1).
- **Key files**: `src/lib/archive.ts`

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
