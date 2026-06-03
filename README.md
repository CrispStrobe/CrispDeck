# CrispDeck

Cross-platform client for **Mastodon** and **Bluesky** with crossposting, identity mapping, and smart mentions.

Works as both a **desktop app** (Tauri 2) and a **web app** (deployed on Vercel).

**Live demo**: https://crispdeck.vercel.app

Built with [Tauri 2](https://v2.tauri.app/) + [SvelteKit 2](https://svelte.dev/) + [Svelte 5](https://svelte.dev/) + [Rust](https://www.rust-lang.org/).

## Features

### Full Social Client
- **Timeline mode** (default): see posts from everyone you follow — just like the native apps
  - Bluesky: `getTimeline()` — your full following feed
  - Mastodon: `/timelines/home` — home timeline
- **My Posts mode**: toggle to see only your own posts
- Connect multiple Bluesky and Mastodon accounts simultaneously
- Unified feed merging posts from all connected accounts
- **Infinite scroll**: auto-loads more posts as you scroll down
- Crosspost detection via Jaro-Winkler similarity (groups matching posts across platforms)
- Advanced filters: search, sort (newest/likes/engagement), hide replies/reposts, min likes, media-only
- Correct date ordering: reposts/reblogs sorted by feed appearance time, not original post time

### Compose & Crosspost
- Write once, post to both platforms with one click
- **Thread auto-splitting**: long text is intelligently split at paragraph/sentence/word boundaries
  - Bluesky: 300 grapheme limit per post
  - Mastodon: 500 character limit per post
  - Each platform gets its own optimal split — a 450-char post becomes 1 Mastodon post but 2 Bluesky posts
- Live per-platform preview showing exactly how threads will split
- Bluesky RichText facet detection (mentions, URLs, hashtags auto-linked)
- Reply chain posting (proper `root` + `parent` refs on Bluesky, `in_reply_to_id` on Mastodon)
- Media upload (up to 4 images) to both platforms
- Mastodon visibility controls (public/unlisted/private/direct) and content warnings
- Draft saving
- Crosspost history logging
- Keyboard shortcut: Ctrl+Enter / Cmd+Enter to post

### Identity Map & Auto-Detection
- Scan follows from all connected accounts
- Identity matching via Jaro-Winkler on display names + handles + bio cross-references
- Side-by-side candidate review with confidence scores and match reasons
- Confirm or dismiss detected matches
- Manual identity creation and account linking
- Tag system for organizing identities

### Smart @-Mentions
- Type `@` in the compose box to trigger autocomplete from the identity database
- Shows both platform handles for each identity
- At post time, mentions are auto-resolved to the correct platform-specific handle:
  - `@alice` becomes `@alice.bsky.social` on Bluesky
  - `@alice` becomes `@alice@mastodon.social` on Mastodon

### Network Search
- Full-text search across all connected accounts
- Bluesky: searchPosts API
- Mastodon: v2/search with authentication
- Results sorted by engagement

### Analytics & Export
- Stats: total posts, likes, boosts, averages
- Platform breakdown (Bluesky vs Mastodon)
- Posting activity by hour (24-bin bar chart)
- Top post by likes
- Export: JSON, CSV, Markdown

### Security
- Credentials encrypted at rest:
  - **Desktop**: AES-256-GCM + Argon2id (machine-bound key)
  - **Web**: AES-256-GCM + PBKDF2 (browser-local key via Web Crypto)
- Mastodon OAuth2 flow (localhost redirect on desktop, popup redirect on web)
- All data stored locally (SQLite on desktop, IndexedDB in browser)

## Architecture

```
+-----------------------------------------------------------+
|  SvelteKit Frontend (Svelte 5 runes)                      |
|  +---------+---------+----------+---------+--------+      |
|  | Feed    | Compose | Identity | Search  | Analyt.|      |
|  +---------+---------+----------+---------+--------+      |
|       |          |          |          |                   |
|  +----v----------v--+  +---v----------v--------+          |
|  | @atproto/api     |  | $lib/db.ts dispatcher |          |
|  | masto (JS libs)  |  +---+---------------+---+          |
|  +------------------+      |               |              |
+----------------------------|---------------|---------------+
                             |               |
              +--------------v--+   +--------v-----------+
              | Tauri (Desktop) |   | Browser (Web/Vercel)|
              | SQLite/rusqlite |   | IndexedDB           |
              | AES-GCM+Argon2 |   | Web Crypto AES-GCM  |
              | Rust strsim     |   | JS jaro-winkler     |
              +-----------------+   +--------------------+
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri 2.x |
| Frontend | SvelteKit 2 + Svelte 5 + Tailwind CSS 4 |
| Bluesky API | @atproto/api (RichText, facets, blob upload) |
| Mastodon API | masto + direct REST |
| Database (desktop) | SQLite via rusqlite |
| Database (web) | IndexedDB |
| Encryption | AES-256-GCM (Argon2 on desktop, PBKDF2 on web) |
| Identity matching | strsim (Rust) / JS jaro-winkler (browser) |
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

Opens at http://localhost:1420. Uses IndexedDB for storage — fully functional.

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
npm test              # 115 tests (unit + integration)
npm run test:watch    # watch mode
```

Tests hit real Bluesky/Mastodon APIs to verify post reading, normalization, ordering, and crosspost detection work end-to-end.

## Project Structure

```
src/
  routes/           7 pages: dashboard, feed, compose, identities, search, analytics, settings
  lib/
    api/            bluesky.ts, mastodon.ts, unified.ts (normalizePost, crosspost detection)
    compose/        adapter.ts (post/thread), thread.ts (splitting), mentions.ts, media.ts
    components/     Post, CrosspostGroup, AdvancedFilters, AccountPicker, MentionAutocomplete
    utils/          export.ts (JSON, CSV, Markdown)
    types.ts        UnifiedPost, Account, Identity, Filters, etc.
    db.ts           Platform dispatcher (Tauri invoke or browser IndexedDB)
    browser-db.ts   IndexedDB implementation of all DB operations
    platform.ts     Tauri vs browser detection
    store.ts        tauri-plugin-store settings wrapper

src-tauri/
  src/
    lib.rs          AppState, plugin registration, 25+ command handlers
    db/             accounts, identities, crossposts, drafts, follows (SQLite CRUD)
    auth/           credentials (AES-GCM), mastodon_oauth (ephemeral localhost server)
    commands/       db_commands, auth_commands, detect_commands (identity matching)
  migrations/       001_initial.sql (7-table schema)
```

## CI/CD

- **CI** (`ci.yml`): 115 tests + frontend build + Rust check on Linux/macOS/Windows — runs on every push and PR
- **Release** (`release.yml`): Cross-platform Tauri builds via `tauri-apps/tauri-action` — triggers on `v*` tags, creates draft GitHub Releases with `.deb`, `.dmg`, `.msi` installers

### Creating a release

```bash
# Bump version in package.json + src-tauri/tauri.conf.json + src-tauri/Cargo.toml
git tag v0.1.0
git push origin v0.1.0
```

## License

MIT
