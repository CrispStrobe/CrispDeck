# CrispDeck

Full-featured cross-platform client for **Mastodon**, **Bluesky**, and **Threads** with crossposting, identity mapping, and smart mentions.

Works as a **web app** (Vercel), **desktop app** (Windows/macOS/Linux via Tauri 2), and **mobile app** (iOS/Android via Tauri 2 mobile).

**Live**: https://crispdeck.vercel.app
**Repo**: https://github.com/CrispStrobe/CrispDeck

Built with [Tauri 2](https://v2.tauri.app/) + [SvelteKit 2](https://svelte.dev/) + [Svelte 5](https://svelte.dev/) + [Rust](https://www.rust-lang.org/) + [CrispASR](https://github.com/CrispStrobe/CrispASR) (optional, for local translation/TTS/STT).

## Features

### Full Social Client (29 pages)
- **3-network client**: Bluesky + Mastodon + Threads
- **Timeline feed**: Bluesky + Mastodon home timelines merged, Threads own posts (Threads API has no home timeline), infinite scroll, "new posts" indicator, multi-account merge
- **Platform filter**: All / Bluesky / Mastodon / Threads toggle
- **Multi-column Deck**: TweetDeck-style with 15 column types (timeline, mentions, notifications, hashtag, user, local, federated, search, list, feed, my-posts, tag-group, RSS, keyword-monitor, threads-search), per-column filters, saved layouts/workspaces, drag-reorder, column width control, platform-aware column picker
- **Keyword monitoring columns**: real-time streaming filtered by user-defined keywords + regex, with Bluesky Jetstream firehose + Mastodon WebSocket, LIVE indicator
- **Streaming timelines**: live-push of new posts via Bluesky Jetstream + Mastodon WebSocket
- **Like, boost, reply, quote, bookmark, share, report** interactions (Bluesky + Mastodon + Threads)
- **Thread view**: click any post to see full parent chain + replies, thread un-rolling ("Read as article") — Bluesky + Mastodon; Threads posts open on threads.com
- **Profile pages**: any user — avatar/banner/bio/stats, follow/unfollow, block/mute, posts/replies/media gallery/followers/following tabs
- **Cross-platform bookmarks**: stored locally in IndexedDB, Mastodon import
- **Mastodon custom emoji**: inline rendering of instance-specific custom emoji in posts
- **Mastodon follow requests**: Accept/Reject buttons on notification cards for locked accounts
- **Bluesky muted words sync**: server-side muted words synced from Bluesky preferences
- **Bluesky post gates**: disable quoting on individual posts via `app.bsky.feed.postgate`
- **Mastodon announcements**: instance announcements shown as pinned cards on notifications page with dismiss
- **Mastodon edit history**: "(edited)" badge on modified posts with timestamp
- **Mastodon server-side translation**: tries instance translation first (free, private), falls back to third-party
- **Notification badge**: PWA app icon badge count via Badging API
- **Dashboard progressive disclosure**: 5 primary tiles, "More actions" expands advanced features

### Compose & Crosspost
- Write once, post to all 3 platforms — **thread auto-splitting** per platform (300 bsky / 500 masto / 500 threads)
- **Bluesky OAuth** (PKCE + DPoP) for full access including DMs
- **Threads OAuth** with server proxy or direct BYOK credentials, or manual token paste
- Quote posts, reply chains, Bluesky RichText facets (mentions, URLs, hashtags)
- Media: images + video (up to 100MB), **alt text editing**, **AI alt-text generation** (BYOK + CrispASR + mistral.rs), emoji picker, **GIF picker** (Tenor)
- **Alt text enforcement**: off / warn / require modes in settings
- **Mastodon polls** (create with 2-4 options + vote on existing)
- **Bluesky thread gates** (Anyone / Mentioned / Followers / Nobody)
- Content warnings, visibility controls, **Bluesky self-labels** (graphic-media/nudity/porn/gore), **post templates with variables** ({date}, {time}, {handle})
- **AI compose**: correct, shorten, hashtag suggestions — 3 providers (BYOK OpenAI-compatible, CrispASR, mistral.rs), 10 BYOK presets with /models discovery
- **Hashtag bank**: saved sets for one-click insertion
- Character count warnings (gray → orange → red → thread indicator)
- Drafts: save, edit, schedule, post now, **auto-save** (survives crashes)
- **Smart @-mentions**: autocomplete from identity DB, resolves per platform

### Identity & Moderation
- **Identity map**: auto-detect cross-platform accounts via Jaro-Winkler matching
- **Bluesky labelers**: subscribe, configure hide/warn/show per label, labels shown on posts
- **Custom PDS resolution**: federated Bluesky PDS instances work out of the box (resolves via plc.directory / did:web)
- **Moderation**: view/manage blocked + muted accounts (all platforms)
- **Muted words / content filters**: keyword + regex filtering across all feeds
- Block/mute from any profile

### Discovery & Social
- **Bluesky Feed Generator**: build custom feeds visually, publish to the Bluesky network (Vercel serverless, `did:web`)
- **Notifications**: unified 3-network feed with grouping/batching
- **Direct messages**: Bluesky OAuth chat + Mastodon full conversation threading
- **Lists & Feeds**: Mastodon lists + Bluesky custom feeds + Bluesky feed builder (GUI)
- **Bluesky Starter Packs**: browse, search, create from identity DB
- **Trending**: unified Bluesky + Mastodon trending
- **Universal search**: queries all 3 networks simultaneously with engagement/recency scoring (Threads: keyword search via official API)
- **Catch-up mode**: AI-ranked missed posts
- **"For You" algorithm**: local engagement-based ranking
- **RSS feeds**: subscribe + OPML import, RSS deck columns
- **Mastodon instance info**: rules, stats, contact, description
- **Inline translation**: 5 providers (Lingva Translate, LibreTranslate, MyMemory, BYOK OpenAI-compatible, CrispASR local), cached in IndexedDB
- **Share post as image**: render any post as branded PNG
- **Quick-follow** from anywhere (feed, deck, search, trending)
- **Notification sounds + desktop alerts**

### Analytics & Archive
- **Cross-platform analytics comparison**: side-by-side charts, best times, day-of-week, hourly heatmaps
- **Post performance insights**: pattern analysis ("image posts get 3x more engagement")
- **Engagement milestones**: configurable threshold alerts
- **Post analytics history**: engagement snapshots with growth curves
- **Local archive**: IndexedDB store of all your posts + likes, full-text search, filters, export
- **Content calendar**: month/week view of past posts + scheduled drafts
- **Media gallery**: masonry grid view for browsing media
- **Reading lists**: themed post collections
- **Export**: JSON, CSV, Markdown + full settings export/import

### Threads Integration (API limitations)

The Threads API is significantly more limited than Bluesky/Mastodon. Here's what works and what doesn't:

| Feature | Status | Notes |
|---------|--------|-------|
| **OAuth login** | Works | Server proxy, BYOK credentials, or manual token paste |
| **View own posts** | Works | Text, images, videos, carousels |
| **Crosspost to Threads** | Works | Text + media, 500-char limit, container-then-publish flow |
| **Keyword search** | Works | Requires `threads_keyword_search` permission |
| **View reposts** | Partial | Shows original author via permalink redirect; full content requires Advanced Access |
| **View other users' posts** | Limited | `profile_posts` endpoint requires Advanced Access (App Review) |
| **Home timeline** | Not available | Meta does not expose a feed/timeline API endpoint |
| **DMs** | Not available | No messaging API |
| **Notifications** | Not available | No notifications API |
| **Like/reply/boost** | Not available | No interaction API from third-party apps |
| **Follow/unfollow** | Not available | No social graph API |
| **Streaming/real-time** | Not available | No WebSocket or firehose |

Threads users' posts can also be read via **Mastodon federation** (`@user@threads.net`) if the Threads user has opted into fediverse sharing.

### Platform & UX
- **Bluesky OAuth** (recommended) or app passwords
- **Mastodon OAuth** with redirect callback
- **Threads OAuth** with server proxy, BYOK credentials, or manual token paste
- **Internationalization**: 8 languages (EN, DE, ES, FR, JA, PT, ZH, AR — all 100%) with RTL support
- **Keyboard shortcuts**: ? for help, g+key navigation, j/k post scrolling, vim-style deck navigation
- **Collapsible sidebar** + mobile hamburger menu + bottom tab bar
- Dark + light + **OLED dark** themes
- **Display settings**: font family (system/Inter/Georgia/mono), font size, line spacing, content max width
- **Cache management**: view localStorage/IndexedDB usage, clear feed cache, purge all cached data
- **PWA install support** (manifest.json + service worker + maskable icons + apple-touch-icon + home screen shortcuts + share target)
- **Haptic feedback**: vibration on like/repost for native-feeling interactions
- **Skeleton loading screens**: shimmer-animated placeholders for feed and notifications
- **Like animation**: heart-burst pop with particle effect on like
- **Configurable sidebar**: simple mode hides advanced items, per-item customization via gear icon
- **Toast notifications**: global success/error/warning/info toasts with auto-dismiss
- **Page transitions**: directional slide transitions via View Transitions API (forward=slide-left, back=slide-right)
- **Welcome onboarding**: feature carousel for first-time users with guided setup
- **Reduced motion**: respects `prefers-reduced-motion` across all animations
- **Micro-interactions**: hover scale + press feedback on engagement buttons, mobile menu slide animation, deck drag visual feedback, lightbox touch swipe
- **Safe area support**: proper notch/home-indicator handling on iOS, tap-highlight suppression, scroll-chaining prevention
- **Compose autofocus**: textarea focused on page load, Ctrl+Enter to post, SVG progress rings per platform
- **Alt-text UX**: character count + fill indicator on media alt-text inputs
- **Scroll-to-top button**: floating FAB after scrolling on any page
- **Search suggestions**: hashtag chips shown before first search
- **Messages auto-scroll**: scroll to latest on load and after sending
- **Profile skeleton**: banner + avatar + bio placeholder during load
- **Thread skeleton**: parent chain + main post + replies placeholder during load
- **Notification actions**: refresh + clear all buttons in header
- **Dashboard**: 3-platform account summary, keyboard shortcut tips, 11 quick-action cards
- **Deck empty states**: "Refresh column" action when no posts loaded
- **Custom error page**: branded 404 with navigation links
- **Open Graph / Twitter Card** meta tags for social link sharing
- **Focus trap** in keyboard shortcuts modal
- **favicon.ico** for legacy browser tab support
- **Lazy i18n**: only active language loaded; 7 others split into async chunks (~80KB savings)
- **Dynamic DOMPurify**: loaded on first use, not bundled into every page (~30KB savings)
- **Service worker**: cache-first for immutable chunks, stale-while-revalidate for assets, offline shell, auto-versioned from git hash
- **Mobile**: viewport-fit=cover, text-size-adjust, smooth scrolling, image CLS prevention
- Safe area insets, touch targets, responsive design

### Performance (Phases 16–21)
- **Parallel API loading**: all network requests across accounts fire concurrently (Promise.allSettled) on every page
- **Stale-while-revalidate**: trending + profile pages show cached data instantly, refresh in background
- **IDB singletons**: all 4 IndexedDB databases (main, archive, bookmarks, engagement) use cached connections
- **Batched IDB writes**: follows cache, bookmark imports use single transactions (N+1 → 1)
- **PBKDF2 key caching**: 600k-iteration derived key cached after first use (~100-300ms saved per call)
- **Crosspost detection**: O(N²) Jaro-Winkler with result caching, platform-indexed lookup, order-independent hash key
- **Visibility-aware**: all polling/WebSockets pause when tab hidden, resume on focus
- **WebSocket backoff**: exponential reconnect (5s base, 2× per attempt, 60s cap)
- **Deck virtualization**: 50-post cap per column with "Show more" pagination
- **Build**: es2022 target, lightningcss minification, vendor chunk splitting, preconnect hints
- **CSS**: `content-visibility: auto` on post cards, `loading="lazy"` + `decoding="async"` on images
- **Svelte reactivity**: all `$derived` computations properly memoized (no function-returning anti-patterns)
- **Template efficiency**: all expensive computations (URL parsing, time formatting, thread splitting) hoisted to `$derived`
- **Emoji picker** + **GIF picker** (Tenor) in compose
- **About page** with legal info + searchable open-source license list
- **Log viewer**: CrispLens-style modal with level filters, search, auto-follow, export to .txt
- **About page**: git commit hash (linked), real app icon, Logs button
- **HTML sanitization**: DOMPurify on all Mastodon HTML (XSS prevention)
- **Security headers**: CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
- **Encryption**: AES-256-GCM with 600k PBKDF2 iterations + per-device random salt
- 1032 unit tests across 77 test files + 28 Playwright E2E tests

## Architecture

```
+-----------------------------------------------------------+
|  SvelteKit Frontend (Svelte 5 runes, 29 pages)            |
|  +---------+---------+----------+---------+--------+      |
|  | Feed    | Compose | Identity | Deck    | More...|      |
|  +---------+---------+----------+---------+--------+      |
|       |          |          |          |                   |
|  +----v----------v--+  +---v----------v--------+          |
|  | @atproto/api     |  | client-factory.ts      |         |
|  | @atproto/oauth   |  | (OAuth + app-password) |         |
|  | masto (JS libs)  |  | Threads Graph API      |         |
|  +------------------+  +---+---------------+---+          |
+----------------------------|---------------|---------------+
                             |               |
              +--------------v--+   +--------v-----------+
              | Tauri (Desktop) |   | Browser (Web/Vercel)|
              | SQLite/rusqlite |   | IndexedDB           |
              | AES-GCM+Argon2 |   | Web Crypto AES-GCM  |
              | Rust strsim     |   | JS jaro-winkler     |
              | CrispASR (opt.) |   | BYOK OpenAI / MyMem.|
              |  NMT/TTS/STT   |   |  (translation only) |
              +-----------------+   +--------------------+
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri 2.x |
| Frontend | SvelteKit 2 + Svelte 5 + Tailwind CSS 4 |
| Bluesky API | @atproto/api + @atproto/oauth-client-browser |
| Mastodon API | masto + direct REST |
| Threads API | Direct REST (official Graph API) |
| Database (desktop) | SQLite via rusqlite |
| Database (web) | IndexedDB |
| Encryption | AES-256-GCM (Argon2 on desktop, PBKDF2 on web) |
| Identity matching | strsim (Rust) / JS jaro-winkler (browser) |
| Translation (desktop) | CrispASR M2M-100 GGUF (optional `--features crispasr`) |
| Translation (web) | BYOK OpenAI-compatible / MyMemory free API |
| TTS (desktop) | CrispASR kokoro/vibevoice/qwen3-tts backends |
| STT (desktop) | CrispASR whisper/parakeet/qwen3-asr backends |
| Icons | @lucide/svelte |
| CI/CD | GitHub Actions (3 platforms) |
| Hosting | Vercel (static SPA) |

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- [Rust](https://rustup.rs/) (for desktop builds only)
- Tauri system dependencies (desktop only):
  - **Linux**: `sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev`
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Visual Studio Build Tools + WebView2

### Setup

```bash
git clone https://github.com/CrispStrobe/CrispDeck.git
cd CrispDeck
npm install
```

### Run web version (no Rust needed)

```bash
npm run dev
```

Opens at http://localhost:1420. Uses IndexedDB for storage — fully functional including Bluesky OAuth.

### Run desktop version

```bash
npm run tauri dev
```

### Build for production

```bash
# Web only (static SPA)
npm run build

# Desktop (platform-native installers)
npm run tauri build
```

### Deploy to Vercel

The repo auto-deploys on push via GitHub integration. Manual deploy:

```bash
npx vercel deploy --prod
```

### Run tests

```bash
npm test              # 947 frontend unit tests
npm run test:watch    # watch mode
npm run test:e2e      # 28 Playwright E2E browser tests (requires build first)

# Rust tests (requires CrispASR sibling checkout for --features crispasr)
cd src-tauri
cargo test                              # 5 unit tests (no CrispASR needed)
cargo test --features crispasr          # 11 tests (registry, cache, config)
cargo test --features crispasr -- --ignored  # 5 live translation tests (downloads m2m100 model)
```

Frontend unit tests hit real Bluesky/Mastodon APIs. E2E tests use Playwright with Chromium against the production build. Rust live tests download and run M2M-100 translation models via CrispASR.

## Project Structure

```
src/
  routes/              29 pages: dashboard, feed, deck, compose, drafts, notifications,
                       messages, bookmarks, lists, feed-builder, starterpacks, identities,
                       search, gallery, calendar, reading-lists, trending, archive,
                       labelers, instance, moderation, analytics, settings, profile,
                       thread, catchup, about, oauth/callback, oauth/bsky-callback
  lib/
    api/               bluesky.ts, bluesky-oauth.ts, mastodon.ts, threads.ts, unified.ts, client-factory.ts
    compose/           adapter.ts, thread.ts, mentions.ts, media.ts, ai.ts
    components/        Post, CrosspostGroup, AdvancedFilters, AccountPicker,
                       MentionAutocomplete, EmojiPicker, GifPicker, KeyboardShortcuts, DeckColumn
    utils/             export.ts (JSON, CSV, Markdown)
    types.ts           UnifiedPost, Account, Identity, Platform, Filters, etc.
    db.ts              Platform dispatcher (Tauri invoke or browser IndexedDB)
    browser-db.ts      IndexedDB implementation of all DB operations
    platform.ts        Tauri vs browser detection
    streaming.ts       StreamManager, Bluesky Jetstream + Mastodon WebSocket
    keyword-monitor.ts Keyword matching + saved keyword sets for deck monitoring
    byok-providers.ts  10 BYOK provider presets with /models discovery
    universal-search.ts Cross-network search with merge/dedup
    archive.ts         Local post archive (IndexedDB)
    bookmarks.ts       Cross-platform bookmarks (IndexedDB)
    templates.ts       Post templates with variables (localStorage)
    translate.ts       Multi-provider translation (CrispASR / BYOK OpenAI / MyMemory)
    hashtag-bank.ts    Saved hashtag sets for compose
    deck-layouts.ts    Saved deck layouts / workspaces
    i18n.svelte.ts     TranslationService (Svelte 5 runes, 8 languages)
    store.ts           tauri-plugin-store settings wrapper

src-tauri/
  src/
    lib.rs             AppState, plugin registration, 30+ command handlers
    asr.rs             CrispASR integration (translate, transcribe, synthesize)
    db/                accounts, identities, crossposts, drafts, follows (SQLite CRUD)
    auth/              credentials (AES-GCM), mastodon_oauth (ephemeral localhost server)
    commands/          db_commands, auth_commands, detect_commands (identity matching)
  tests/               crispasr_integration.rs (registry + live translation tests)
  migrations/          001_initial.sql (7-table schema)

api/
  feed/                Feed definition storage (publish.ts, unpublish.ts — Vercel Blob)
  threads/             Threads OAuth proxy (auth-url.ts, token.ts)
  xrpc/                Bluesky feed generator (getFeedSkeleton, describeFeedGenerator)

static/
  .well-known/did.json Feed generator DID document (did:web:crispdeck.vercel.app)
  client-metadata.json Bluesky OAuth client metadata
  favicon.png          App icon (192x192)
  favicon.ico          Legacy browser tab icon (16+32px)
  icon-512.png         PWA icon (512x512)
  icon-1024.png        Hi-res source icon (1024x1024)
  apple-touch-icon.png iOS home screen icon (180x180)
  icon-*-maskable.png  Android adaptive icons (192+512)
  manifest.json        PWA manifest
  sw.js                Service worker (versioned cache)

scripts/
  generate-icon.mjs         Icon generator (Node.js canvas, source of truth)
  generate-tauri-icons.mjs  Resize to Tauri icon sizes
```

## CI/CD

- **CI** (`ci.yml`): 947 frontend tests + frontend build + Rust check on Linux/macOS/Windows — every push and PR
- **Mobile** (`mobile.yml`): iOS + Android builds via Tauri 2 — triggers on `v*` tags
- **Release** (`release.yml`): Cross-platform Tauri builds — triggers on `v*` tags, creates GitHub Releases with `.deb`, `.dmg`, `.msi`

### Creating a release

```bash
# Bump version in package.json + src-tauri/tauri.conf.json + src-tauri/Cargo.toml
git tag v1.0.0
git push origin v1.0.0
```

### Mobile builds (Tauri 2)

Mobile support uses Tauri 2's iOS/Android targets. Desktop-only plugins (shell, process) are feature-gated and excluded from mobile builds:

```bash
# Build for mobile (requires tauri android init / tauri ios init first)
cargo tauri android build --no-default-features
cargo tauri ios build --no-default-features
```

OAuth on mobile uses the `crispdeck://` URL scheme (registered in AndroidManifest.xml and Info.plist) instead of the desktop localhost TCP listener.

## Stats

- 1032 frontend unit tests + 28 Playwright E2E tests + 15 Rust tests
- 29 pages, 15 deck column types
- 3 networks: Bluesky (OAuth + app password), Mastodon (OAuth), Threads (OAuth with server proxy)
- 8 UI languages (EN, DE, ES, FR, JA, PT, ZH, AR — all 100%) with RTL support
- Dark + light + OLED dark themes
- 10 BYOK AI provider presets with /models discovery
- 5 translation providers (Lingva, LibreTranslate, MyMemory, BYOK OpenAI, CrispASR local)
- CrispASR: 106 models (NMT/TTS/STT) via optional Cargo feature

## License

[AGPL-3.0](LICENSE) — free for commercial use, attribution required, derivatives must be open source.
