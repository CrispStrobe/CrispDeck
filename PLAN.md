# CrispDeck Development Plan

## What is CrispDeck

A unified Mastodon + Bluesky + Threads social media client with:
- Multi-column TweetDeck-style deck view
- Crossposting with intelligent thread splitting
- Identity matching across platforms (Jaro-Winkler)
- Local analytics, archive, translation (CrispASR/BYOK/MyMemory)
- Desktop (Tauri 2) + Web (SvelteKit 2 SPA on Vercel)

**Tech stack**: SvelteKit 2, Svelte 5 (runes), Tailwind CSS 4, Vite 6, Tauri 2, TypeScript + Rust, Vitest

## Current State (2026-07-03)

v1.0.0 — 977 unit tests + 28 Playwright E2E tests, 29 pages, live at https://crispdeck.vercel.app

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

Key competitive advantages: deck+multi-network+Threads (unique combo), cross-platform analytics (no competitor), catch-up mode, AI compose (3 providers incl. local), "For You" local algorithm, thread un-rolling, real-time Jetstream counters, Threads hybrid reading via ActivityPub, saved deck workspaces, universal cross-network search, streaming timelines, hashtag bank, AI alt-text generation (BYOK + CrispASR/llama.cpp + mistral.rs), keyword monitoring columns with live streaming (TweetDeck refugee #1 ask).

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

## Future Ideas (from Graysky comparison)

### Alt text badge overlay on images
- **Status**: Not started
- **Effort**: Small
- **Description**: Show an "ALT" badge on images that have alt text, click to show full alt text in a popover
- Graysky does this well — surfaces accessibility info without cluttering the UI

### Throttled loading indicators
- **Status**: Not started
- **Effort**: Small
- **Description**: Delay spinner/skeleton display by ~100ms to avoid flicker on fast operations
- Prevents visual jank when API calls complete quickly

### Quick account switcher
- **Status**: Not started
- **Effort**: Medium
- **Description**: Popover/drawer for switching between accounts without navigating to full Identities page
- Show account avatars in sidebar footer, click to switch active account
