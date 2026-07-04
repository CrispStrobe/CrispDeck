# CrispDeck v1.2.0 — Deck Parity Release

**Date**: 2026-07-04
**Tag**: `v1.2.0`

The deck is now feature-complete. This release adds 27 features that bring the multi-column experience to full parity with classic deck clients: 5 new column types, a floating compose panel, column keyboard navigation, per-column notifications, display density modes, streaming for all columns, and shareable collections.

---

## Highlights

- **20 column types** (up from 15): Messages/DMs, Trending, Activity, Liked Posts, and New Followers join the deck
- **Floating compose** stays on top of the deck — reply and quote from any column without navigating away
- **Full keyboard-driven workflow**: navigate columns with h/l, posts with j/k, jump with 1-9, compose with n, add column with a
- **Per-column notifications**: configure sound, desktop alerts, or both per column
- **Display density**: single toggle switches the entire UI between Compact, Comfortable, and Spacious

---

## New Deck Column Types

| Column | What it shows | APIs used |
|--------|--------------|-----------|
| Messages | Bluesky chat conversations + Mastodon DM threads | `chat.bsky.convo.listConvos`, `/api/v1/conversations` |
| Trending | Bluesky trending topics + Mastodon trending tags/links | `getTrendingTopics`, `/api/v1/trends/*` |
| Activity | Engagement on your posts (likes, reposts, quotes only) | Notification APIs filtered by engagement type |
| Likes | Posts you've liked, reverse-chronological | `getActorLikes`, `/api/v1/favourites` |
| Followers | Recent new followers | Notification APIs filtered by follow type |

## Deck Column Management

- **Color coding**: 8 preset accent colors rendered as a top border stripe for visual distinction between columns
- **Collapse/minimize**: shrink a column to a 40px icon strip to save space — click to re-expand
- **Pin/lock**: prevent accidental removal or drag-reorder
- **Clear**: wipe rendered content without affecting data — next refresh loads fresh
- **Width presets**: one-click Narrow (280px), Medium (350px), Wide (450px) alongside drag resize
- **Auto-scroll / scroll-lock**: toggle per column — when unlocked, new streaming posts scroll into view automatically
- **Column-level mute filters**: keyword + regex filters scoped to a single column, stacking on top of global mute rules

## Compose & Posting

- **Floating compose panel**: slide-out panel from the right edge, keeps deck visible while composing, focus trap, Escape to close, Ctrl+Enter to post
- **Quick-schedule**: Schedule button with inline date/time picker next to the Post button — saves as a scheduled draft
- **Reply/quote from deck**: clicking reply or quote on any deck post opens the floating compose with context pre-filled

## Keyboard Navigation

| Key | Action |
|-----|--------|
| `h` / `ArrowLeft` | Focus previous column |
| `l` / `ArrowRight` | Focus next column |
| `j` | Next post in focused column |
| `k` | Previous post in focused column |
| `1`-`9` | Jump to column by position |
| `n` | Open floating compose |
| `a` | Toggle add-column menu |
| `o` | Open focused post in thread view |
| `r` | Reply to focused post |
| `Escape` | Clear focus / close menus |

## Search & Discovery

- **Advanced search operators UI**: per-platform syntax help popover showing available operators (Bluesky `from:`, `since:`, `until:`, `lang:`, `has:media`; Mastodon `from:@user@instance`, `#hashtag`)
- **Quick filter buttons**: "Has media", "From me", "Past week" — one-click operator insertion
- **Saved searches**: save queries for one-click re-access via dropdown, delete saved searches

## Display & Settings

- **Display density modes**: Compact / Comfortable / Spacious selector in Settings > Appearance
  - Compact: 28px avatars, 8px padding, 0.9x font scale
  - Comfortable: 40px avatars, 16px padding, 1x font scale (default)
  - Spacious: 48px avatars, 20px padding, 1.05x font scale
- Applied via 7 CSS custom properties on `:root`, initialized on app startup

## Real-Time & Streaming

- **Streaming for all column types**: timeline, mentions, notifications, local, federated, hashtag, list, and user columns now receive live updates via Mastodon WebSocket + Bluesky Jetstream (previously only keyword-monitor columns streamed)
- **Live engagement counters on deck**: Jetstream enabled on the deck page so Bluesky like/repost counts update in real-time on all Post components

## Collections

- **Shareable curated collections**: export any reading list as JSON text or base64 data URL, import from JSON — round-trip preserves all post data including URIs, text, author info, and platform

---

## Stats

- **1,443 frontend unit tests** across 99 test files (up from 1,213 across 86 in v1.1.1)
- **29 Playwright E2E tests**, 15 Rust tests
- **20 deck column types** (up from 15)
- **14 new test files**, 13 new/modified source files
- CI fully green on Linux/macOS/Windows

## New Files

| File | Purpose |
|------|---------|
| `FloatingCompose.svelte` | Slide-out compose panel for deck |
| `column-notify.ts` | Per-column Web Audio beep + desktop Notification API |
| `column-mute.ts` | Per-column keyword + regex mute filtering |
| `density.ts` | Display density modes (CSS custom properties) |
| `saved-searches.ts` | Saved search persistence (localStorage) |

## Breaking Changes

None. All changes are additive. Existing deck layouts, column configs, and settings are forwards-compatible — new fields default to sensible values when not present.
