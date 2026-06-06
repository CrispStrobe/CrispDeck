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

v0.4.1 — 552 tests (46 test files), 24 pages, live at https://crispdeck.vercel.app

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
- **Status**: Not started
- **Effort**: Large
- **Description**: GUI for creating custom Bluesky algorithmic feeds without coding
- Filter by: keywords, language, has-media, min-likes, author list, exclude terms
- Preview feed results before publishing
- Publish feed to Bluesky network via `app.bsky.feed.generator`
- Manage/edit/delete own published feeds
- **Note**: Publishing requires a running feed generator service. A client-side preview + rule editor is doable; actual network publishing needs a server component.

### 43. Nostr and Threads support
- **Status**: Not started
- **Effort**: Very large (multi-week per protocol)
- **Description**: Extend multi-network architecture to Nostr (NIP-01 relay protocol) and Threads (ActivityPub)
- Would make CrispDeck the most comprehensive open-social client with a deck view
- Requires new API clients, auth flows, post normalization, compose adapters

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
| Bluesky + Mastodon | Yes | Yes | Yes + Nostr + Threads | Bluesky only | Mastodon only |
| Column/deck view | Yes | No | No | Yes | Mac only |
| Web + desktop + mobile | Yes | Apple only | Mobile only | Web only | Apple only |
| Analytics | Yes | No | No | No | Basic |
| Free to post | Yes | No ($5/mo) | 2 accts free | Yes | No ($2/mo) |
| Open source | Yes (AGPL) | No | No | No | No |

Key competitive advantages: deck+multi-network (unique combo), cross-platform analytics (no competitor), catch-up mode, AI compose, "For You" local algorithm, thread un-rolling, real-time Jetstream counters.
