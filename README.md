# CrispDeck

Full-featured cross-platform client for **Mastodon** and **Bluesky** with crossposting, identity mapping, and smart mentions.

Works as a **web app** (Vercel), **desktop app** (Windows/macOS/Linux via Tauri 2), and **mobile app** (iOS/Android via Tauri 2 mobile).

**Live**: https://crispdeck.vercel.app
**Repo**: https://github.com/CrispStrobe/CrispDeck

Built with [Tauri 2](https://v2.tauri.app/) + [SvelteKit 2](https://svelte.dev/) + [Svelte 5](https://svelte.dev/) + [Rust](https://www.rust-lang.org/) + [CrispASR](https://github.com/CrispStrobe/CrispASR) (optional, for local translation/TTS/STT).

## Features

### Full Social Client (23 pages)
- **Timeline feed**: posts from everyone you follow, infinite scroll, "new posts" indicator
- **Platform filter**: All / Bluesky only / Mastodon only toggle
- **Multi-column Deck**: TweetDeck-style with 11 column types (timeline, mentions, notifications, hashtag, user, local, federated, search, list, feed, my-posts), per-column filters, saved layouts, auto-refresh
- **Like, boost, reply, quote, bookmark, share, report** interactions
- **Thread view**: click any post to see full parent chain + replies
- **Profile pages**: any user — avatar/banner/bio/stats, follow/unfollow, block/mute, posts/replies/media gallery/followers/following tabs
- **Cross-platform bookmarks**: stored locally in IndexedDB

### Compose & Crosspost
- Write once, post to both platforms — **thread auto-splitting** per platform (300 bsky / 500 masto)
- **Bluesky OAuth** (PKCE + DPoP) for full access including DMs
- Quote posts, reply chains, Bluesky RichText facets (mentions, URLs, hashtags)
- Media: images + video (up to 100MB), **alt text editing**, emoji picker, **GIF picker** (Tenor)
- **Alt text enforcement**: off / warn / require modes in settings
- **Mastodon polls** (create with 2-4 options + vote on existing)
- **Bluesky thread gates** (Anyone / Mentioned / Followers / Nobody)
- Content warnings, visibility controls, **post templates**
- Character count warnings (gray → orange → red → thread indicator)
- Drafts: save, edit, schedule, post now
- **Smart @-mentions**: autocomplete from identity DB, resolves per platform

### Identity & Moderation
- **Identity map**: auto-detect cross-platform accounts via Jaro-Winkler matching
- **Bluesky labelers**: subscribe, configure hide/warn/show per label, labels shown on posts
- **Custom PDS resolution**: federated Bluesky PDS instances work out of the box (resolves via plc.directory / did:web)
- **Moderation**: view/manage blocked + muted accounts (both platforms)
- Block/mute from any profile

### Discovery & Social
- **Notifications**: unified Bluesky + Mastodon feed
- **Direct messages**: Bluesky OAuth chat + Mastodon full conversation threading
- **Lists & Feeds**: Mastodon lists + Bluesky custom feeds
- **Bluesky Starter Packs**: browse, search by creator
- **Trending**: Mastodon tags/links/posts with Latin script filter
- **Mastodon instance info**: rules, stats, contact, description
- **Network search**: full-text across both platforms
- **Inline translation**: translate any post (MyMemory API, cached in IndexedDB)
- **Share post as image**: render any post as branded PNG

### Analytics & Archive
- **Analytics**: full pagination, date range filter, clickable stats (top 5 by likes/reposts/engagement), hourly chart, platform breakdown
- **Local archive**: IndexedDB store of all your posts + likes, full-text search, filters, export
- **Export**: JSON, CSV, Markdown

### Platform & UX
- **Bluesky OAuth** (recommended) or app passwords
- **Mastodon OAuth** with redirect callback
- **Internationalization**: 5 languages (English, German, French, Spanish, Japanese) with fallback
- **Keyboard shortcuts**: ? for help, g+key navigation, Ctrl+Enter to post
- **Collapsible sidebar** + mobile hamburger menu + bottom tab bar
- Safe area insets, touch targets, responsive design
- **Emoji picker** + **GIF picker** (Tenor) in compose
- **About page** with legal info + searchable open-source license list
- 276 tests (260 frontend + 11 Rust unit + 5 Rust live translation)

## Architecture

```
+-----------------------------------------------------------+
|  SvelteKit Frontend (Svelte 5 runes, 23 pages)            |
|  +---------+---------+----------+---------+--------+      |
|  | Feed    | Compose | Identity | Deck    | More...|      |
|  +---------+---------+----------+---------+--------+      |
|       |          |          |          |                   |
|  +----v----------v--+  +---v----------v--------+          |
|  | @atproto/api     |  | client-factory.ts      |         |
|  | @atproto/oauth   |  | (OAuth + app-password) |         |
|  | masto (JS libs)  |  +---+---------------+---+          |
|  +------------------+      |               |              |
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
npm test              # 260 frontend tests (unit + integration)
npm run test:watch    # watch mode

# Rust tests (requires CrispASR sibling checkout for --features crispasr)
cd src-tauri
cargo test                              # 5 unit tests (no CrispASR needed)
cargo test --features crispasr          # 11 tests (registry, cache, config)
cargo test --features crispasr -- --ignored  # 5 live translation tests (downloads m2m100 model)
```

Frontend tests hit real Bluesky/Mastodon APIs. Rust live tests download and run M2M-100 translation models via CrispASR.

## Project Structure

```
src/
  routes/              23 pages: dashboard, feed, deck, compose, drafts, notifications,
                       messages, bookmarks, lists, starterpacks, identities, search,
                       trending, labelers, instance, archive, moderation, analytics,
                       settings, profile, thread, oauth/callback, oauth/bsky-callback
  lib/
    api/               bluesky.ts, mastodon.ts, unified.ts, bluesky-oauth.ts, client-factory.ts
    compose/           adapter.ts, thread.ts, mentions.ts, media.ts
    components/        Post, CrosspostGroup, AdvancedFilters, AccountPicker,
                       MentionAutocomplete, EmojiPicker, GifPicker, KeyboardShortcuts, DeckColumn
    utils/             export.ts (JSON, CSV, Markdown)
    types.ts           UnifiedPost, Account, Identity, Filters, etc.
    db.ts              Platform dispatcher (Tauri invoke or browser IndexedDB)
    browser-db.ts      IndexedDB implementation of all DB operations
    platform.ts        Tauri vs browser detection
    archive.ts         Local post archive (IndexedDB)
    bookmarks.ts       Cross-platform bookmarks (IndexedDB)
    templates.ts       Post templates (localStorage)
    translate.ts       Multi-provider translation (CrispASR / BYOK OpenAI / MyMemory)
    i18n.svelte.ts     TranslationService (Svelte 5 runes, en + de)
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

static/
  client-metadata.json Bluesky OAuth client metadata
```

## CI/CD

- **CI** (`ci.yml`): 260 frontend tests + frontend build + Rust check on Linux/macOS/Windows — every push and PR
- **Mobile** (`mobile.yml`): iOS + Android builds via Tauri 2 — triggers on `v*` tags
- **Release** (`release.yml`): Cross-platform Tauri builds — triggers on `v*` tags, creates GitHub Releases with `.deb`, `.dmg`, `.msi`

### Creating a release

```bash
# Bump version in package.json + src-tauri/tauri.conf.json + src-tauri/Cargo.toml
git tag v0.2.0
git push origin v0.2.0
```

## Stats

- 61 commits
- 74 source files (25 pages, 9 components, 20 frontend + 1 Rust test files)
- 276 tests (260 frontend + 11 Rust unit + 5 Rust live translation)
- 23 sidebar navigation items
- 11 deck column types
- Bluesky: OAuth + app password auth, public API reading
- Mastodon: OAuth, full REST API

## License

[AGPL-3.0](LICENSE) — free for commercial use, attribution required, derivatives must be open source.
