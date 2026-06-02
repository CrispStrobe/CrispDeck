# CrispDeck

Cross-platform desktop client for **Mastodon** and **Bluesky** with crossposting, identity mapping, and smart mentions.

Built with [Tauri 2](https://v2.tauri.app/) + [SvelteKit](https://svelte.dev/) + [Rust](https://www.rust-lang.org/).

## Features

### Multi-Account Feed Reader
- Connect multiple Bluesky and Mastodon accounts simultaneously
- Unified timeline merging posts from all accounts
- Crosspost detection via Jaro-Winkler similarity (groups matching posts across platforms)
- Advanced filters: search, sort (newest/likes/engagement), hide replies/reposts, min likes, media-only
- Paginated loading with "Load More" per account and "Load All"

### Compose & Crosspost
- Write once, post to both platforms with one click
- **Thread auto-splitting**: long text is intelligently split at paragraph/sentence/word boundaries
  - Bluesky: 300 grapheme limit per post
  - Mastodon: 500 character limit per post
  - Each platform gets its own optimal split — a 450-char post becomes 1 Mastodon post but 2 Bluesky posts
- Live per-platform preview showing exactly how threads will split
- Bluesky RichText facet detection (mentions, URLs, hashtags auto-linked)
- Media upload (up to 4 images) to both platforms
- Mastodon visibility controls (public/unlisted/private/direct) and content warnings
- Draft saving
- Crosspost history logging in SQLite
- Keyboard shortcut: Ctrl+Enter / Cmd+Enter to post

### Identity Map & Auto-Detection
- Scan follows from all connected accounts
- Rust-powered identity matching (O(n*m) Jaro-Winkler on display names + handles + bio cross-references)
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

### Security
- Credentials encrypted at rest with AES-256-GCM (Argon2id key derivation)
- Mastodon OAuth2 flow with ephemeral localhost redirect server
- All data stored locally in SQLite — nothing leaves your machine

## Architecture

```
+--------------------------------------------------+
|  SvelteKit Frontend (Svelte 5 runes)             |
|  +----------+----------+----------+-----------+  |
|  | Feed     | Compose  |Identities| Settings  |  |
|  | (read)   | (write)  | (map)    | (accounts)|  |
|  +----+-----+----+-----+----+-----+-----+-----+  |
|       |          |          |           |         |
|  +----v----------v--+  +---v-----------v---+      |
|  | @atproto/api     |  | Tauri IPC invoke()|     |
|  | masto (JS libs)  |  | (DB, auth, detect)|     |
|  +------------------+  +---------+---------+      |
+----------------------------------|-----------------+
                                   |
+----------------------------------v-----------------+
|  Rust Backend (src-tauri/)                         |
|  +----------+-----------+---------------------+   |
|  | SQLite   | Credential| Identity Detection  |   |
|  | (rusqlite| Encryption| (strsim jaro-winkler|   |
|  | 7 tables)| (aes-gcm) | on follows lists)   |   |
|  +----------+-----------+---------------------+   |
+----------------------------------------------------+
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri 2.x |
| Frontend | SvelteKit 2 + Svelte 5 + Tailwind CSS 4 |
| Bluesky API | @atproto/api (RichText, facets, blob upload) |
| Mastodon API | masto + direct REST |
| Database | SQLite via rusqlite |
| Encryption | AES-256-GCM + Argon2id |
| Identity matching | strsim (Jaro-Winkler) in Rust |
| Icons | @lucide/svelte |

### SQLite Schema

7 tables: `accounts`, `identities`, `identity_links`, `identity_tags`, `crosspost_history`, `draft_posts`, `follows_cache`

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- [Rust](https://rustup.rs/)
- Tauri system dependencies:
  - **Linux**: `sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev`
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Visual Studio Build Tools + WebView2

### Setup

```bash
git clone https://github.com/CrispStrobe/CrispDeck.git
cd CrispDeck
npm install
```

### Run in development

```bash
npm run tauri dev
```

### Build for production

```bash
npm run tauri build
```

Produces platform-native installers in `src-tauri/target/release/bundle/`.

### Frontend-only (web preview)

```bash
npm run build
npm run preview
```

The frontend builds as a static SPA. Tauri IPC calls won't work without the desktop shell, but the UI is fully navigable.

### Vercel deployment

The project includes a `vercel.json` for static SPA deployment. Link the GitHub repo in the Vercel dashboard or:

```bash
npx vercel
```

## Project Structure

```
src/
  routes/           7 pages: dashboard, feed, compose, identities, search, analytics, settings
  lib/
    api/            bluesky.ts, mastodon.ts, unified.ts (normalizePost, crosspost detection)
    compose/        adapter.ts (post/thread), thread.ts (platform-aware splitting), mentions.ts, media.ts
    components/     Post, CrosspostGroup, AdvancedFilters, AccountPicker, MentionAutocomplete
    types.ts        UnifiedPost, Account, Identity, Filters, etc.
    db.ts           Tauri invoke() wrappers for all Rust commands
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

- **CI** (`ci.yml`): Frontend build + Rust check on Linux/macOS/Windows — runs on every push and PR
- **Release** (`release.yml`): Cross-platform Tauri builds via `tauri-apps/tauri-action` — triggers on `v*` tags, creates draft GitHub Releases with `.deb`, `.dmg`, `.msi` installers

### Creating a release

```bash
# Bump version in package.json + src-tauri/tauri.conf.json + src-tauri/Cargo.toml
git tag v0.1.0
git push origin v0.1.0
```

## License

MIT
