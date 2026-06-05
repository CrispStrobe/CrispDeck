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
- [x] CrispASR integration (optional `--features crispasr-metal / -vulkan / -cuda`):
  - Translation: M2M-100 GGUF (100 languages, any-to-any, on-demand download)
  - TTS: kokoro/vibevoice/qwen3-tts/orpheus backends
  - STT: whisper/parakeet/qwen3-asr + 20 more backends (106 models in registry)
  - Lazy-load session with registry auto-download
  - Live-tested: EN↔DE, EN→FR/ES/JA, long text, edge cases
- [x] Multi-provider translation: CrispASR (desktop) + BYOK OpenAI-compatible + MyMemory (free)
- [x] About page with legal info + searchable open-source license list
- [x] License generator script (scripts/generate-licenses.js — NPM + Cargo deps)
- [x] 276 tests (260 frontend + 11 Rust unit + 5 Rust live translation)

- [x] Dictation: mic button in compose (Web Speech API, CrispASR upgrade path)
- [x] Read aloud: speaker button on posts (browser SpeechSynthesis, CrispASR upgrade path)
- [x] Bluesky trending topics (app.bsky.unspecced.getTrendingTopics, numbered list)
- [x] Improved starter packs search (post search + actor search + relevance ranking)
- [x] Bluesky lists (graph lists + feed search via getPopularFeedGenerators)
- [x] Bluesky moderation lists (subscribe/unsubscribe, mute-all)
- [x] Feed scroll position preservation (append without re-sort, deduplicate)
- [x] Feed incremental refresh (prepend new posts, don't reload all)
- [x] Comprehensive i18n (12 sections: translation, tts, stt, analytics, moderation, lists, trending, starterPacks, about)
- [x] Translation preserves newlines from Mastodon HTML
- [x] Full CrispASR model catalog (106 models: NMT + TTS + STT in Settings)

- [x] CrispASR model download manager in Settings UI (registry browser, 106 models)
- [x] Voice commands: "go to feed", "new post", "open settings", "scroll up", etc. (EN + DE)
- [x] Wired all pages to i18n (analytics, drafts, archive, profile, deck, identities, labelers, instance, moderation, compose)
- [x] TTS/STT engine selector: auto / CrispASR / browser (user choice per feature)

- [x] Dark/light theme toggle with persistence
- [x] Voice commands in keyboard shortcuts overlay (14 commands)
- [x] Homepage mode selector: dashboard / feed / deck
- [x] Bluesky 2FA (auth factor token on app-password login)
- [x] Error boundary (per-page crash recovery with retry + stack trace)
- [x] 9 live Bluesky API integration tests
- [x] Portuguese + Chinese i18n (7 languages total)
- [x] Push notifications scaffold (Tauri plugin + Web Notifications API)
- [x] Theme, 2FA, push notification tests

## Remaining

- [ ] Wire push notifications into feed refresh polling
