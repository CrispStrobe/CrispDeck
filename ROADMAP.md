# CrispDeck Roadmap

## Done

- [x] Multi-account management (Bluesky + Mastodon)
- [x] Bluesky OAuth (PKCE + DPoP) — full access including DMs, works in browser + Tauri
- [x] Timeline feed (posts from followed accounts) + My Posts + "New posts" indicator
- [x] Infinite scroll
- [x] Compose + crosspost with thread splitting (per-platform char limits)
- [x] Quote post compose (Bluesky embed record, Mastodon URL append)
- [x] Reply compose with context
- [x] Like/boost/reply/quote interactions
- [x] Identity map + auto-detection (Jaro-Winkler)
- [x] Smart @-mentions with identity-aware resolution
- [x] Drafts with scheduling + resume editing
- [x] Post templates (save/load reusable compose templates)
- [x] Network search (both platforms)
- [x] Analytics + export (JSON/CSV/MD) with full pagination + clickable stats
- [x] Local post archive with search (IndexedDB)
- [x] Multi-column Deck view (11 column types, per-column filters, saved layouts, auto-refresh)
- [x] Profile pages (view any user, follow/unfollow, block/mute, posts/replies/media gallery/followers/following)
- [x] Notifications (unified Bluesky + Mastodon)
- [x] Direct messages (Bluesky OAuth chat + Mastodon full conversation threading)
- [x] Lists & Feeds (Mastodon lists + Bluesky custom feeds)
- [x] Bluesky Starter Packs (browse, search)
- [x] Trending (Mastodon tags/links/posts with Latin script filter)
- [x] Bluesky Labelers (subscribe, configure hide/warn/show per label, display on posts)
- [x] Moderation (block/mute management, both platforms)
- [x] Cross-platform bookmarks (IndexedDB)
- [x] Thread view (click post → full parent chain + replies)
- [x] Share/copy link to post + Report button
- [x] Mastodon polls (create + vote on existing)
- [x] Bluesky thread gates (Anyone / Mentioned / Followers / Nobody)
- [x] Video upload (MP4/WebM/MOV up to 100MB) + alt text editing
- [x] Emoji picker in compose
- [x] Character count warning thresholds
- [x] Keyboard shortcuts (? for help, g+key navigation)
- [x] Collapsible sidebar + mobile layout (hamburger + bottom tabs)
- [x] Web (Vercel) + Desktop (Tauri) + Tauri OAuth
- [x] CI/CD: tests + builds on Linux/macOS/Windows
- [x] 118 unit + integration tests
- [x] Mastodon instance info/rules display

- [x] GIF picker (Tenor API search/trending in compose)
- [x] Inline post translation (MyMemory API, IndexedDB cache, configurable target language)
- [x] Internationalization (i18n): Svelte 5 runes TranslationService, English + German, language selector
- [x] Share post as image (html2canvas with CrispDeck branding, Web Share API / download)
- [x] Custom PDS resolution (plc.directory for did:plc, .well-known for did:web — federated PDS support)
- [x] Alt text enforcement modes (off/warn/require in settings, visual nudge in compose)
- [x] 256 unit + integration tests (up from 118)

## Remaining

- [ ] Push notifications (Tauri mobile)
