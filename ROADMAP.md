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

- [x] Push notifications wired into feed refresh (fires when tab hidden + permission granted)

- [x] Analytics overhaul: visual progress bar, engagement rate metric, detailed platform breakdown (likes/boosts/replies/engagement per platform)
- [x] Archive improvements: CSV/MD export, auto-refresh on visit (append new posts), full Mastodon likes pagination
- [x] Deck improvements: column width adjustment (280-600px drag resize), drag-and-drop column reorder
- [x] Feed improvements: post source indicator in multi-account mode, pull-to-refresh on mobile (touch gesture)
- [x] Messages improvements: unread count badge in sidebar, corrected Bluesky OAuth DM guidance
- [x] Profile improvements: "Follows you" badge (Bluesky + Mastodon), paginated followers/following lists with Load More
- [x] Drafts: post preview with per-platform thread splitting and CW display
- [x] Accessibility: ARIA labels on all post interaction buttons, skip-to-content link, focus-visible indicators, RTL support (CSS + dir attribute)
- [x] Arabic i18n (8 languages total: en, de, fr, es, ja, pt, zh, ar) with RTL layout support
- [x] Cargo-license fallback: Cargo.toml parser generates Rust dep licenses when cargo-license not installed (50 total: 12 NPM + 38 Rust)
- [x] About page: source filter (All / NPM / Rust) for license browser

## Shipped in v1.1.0 (July 2026)

- [x] Sprint 1 — native feel: haptics, directional slide transitions, lightbox swipe, PWA shortcuts/share target, safe-area fixes; Threads like/repost/quote
- [x] Sprint 2 — configurable sidebar + simple mode, Mastodon follow requests, Bluesky self-labels, pull-to-refresh
- [x] Sprint 3 — Mastodon custom emoji, Bluesky server-synced muted words, like animation, shimmer skeletons, PWA badge
- [x] Sprint 4 — Bluesky post gates, Mastodon server translation / edit history / announcements, dashboard progressive disclosure
- [x] Sprint 5 — Bluesky profile-pinned posts, Mastodon list membership management
- [x] Sprint 6 — Bluesky video upload pipeline, web push (VAPID + cron), Mastodon v2 filters, touch deck reorder, network-first onboarding, tabbed settings
- [x] Performance phases 17–21 — parallelized APIs, SWR caching, IDB singletons, leak fixes, vendor chunk splitting, SW cache auto-versioning
- [x] Reliability — self-healing Bluesky OAuth sessions (restore by DID, transient-error retries, silent re-auth), deck fixes for OAuth accounts, starter pack search on official API
- [x] CI fully green — 1,177 frontend + 29 E2E + 15 Rust tests

## Next (candidates)

- [ ] Measure and tune post-media loading on the live deploy (eager vs. below-fold lazy)
- [ ] Longer-lived OAuth sessions via a confidential-client backend (atproto `private_key_jwt`)
- [ ] Threads home-timeline workarounds as the API evolves
