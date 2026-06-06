# CrispDeck Development Plan

## Current State (2026-06-05)

v0.4.0 — 518 tests, 24 pages, live at https://crispdeck.vercel.app

Items 1–29, 31, 33–40 are **done**. Item 32 (DeepL) was reverted — prefer own services. Remaining: 30, 41–43, and polish items 44–48.

---

## Competitive Position

CrispDeck is the only client combining multi-column deck view + multi-network (Bluesky + Mastodon) + web-first cross-platform + analytics + free/open-source. Closest competitors:

| | CrispDeck | Indigo (May 2026) | Openvibe | deck.blue | Ivory |
|---|---|---|---|---|---|
| Bluesky + Mastodon | Yes | Yes | Yes + Nostr + Threads | Bluesky only | Mastodon only |
| Column/deck view | Yes | No | No | Yes | Mac only |
| Web + desktop + mobile | Yes | Apple only | Mobile only | Web only | Apple only |
| Analytics | Yes | No | No | No | Basic |
| Free to post | Yes | No ($5/mo) | 2 accts free | Yes | No ($2/mo) |
| Open source | Yes (AGPL) | No | No | No | No |

---

## Phase 4: Competitive Feature Gap (v0.4.0)

### Priority 1 — High impact, moderate effort

#### 26. Notification grouping/batching
- **Inspiration**: Elk, Indigo
- Collapse duplicate notifications: "12 people liked your post" → single entry with avatars
- Group by post: all likes/reposts/replies on the same post shown together
- Expandable to see individual actors
- Separate from deck notification column (which remains chronological)

#### 27. Cross-network de-duplication
- **Inspiration**: Indigo
- Extend existing Jaro-Winkler identity matching to detect same-content crossposts
- When the same person (matched identity) posts near-identical text on both networks within a time window, collapse to one entry
- Show "also posted on [Bluesky/Mastodon]" indicator
- Click to expand and see both versions
- Configurable: off / soft (indicator only) / merge (collapse)

#### 28. Catch-up mode
- **Inspiration**: Phanpy
- New view: "Here's what happened in the last N hours" (1h / 3h / 6h / 12h)
- Finite, sortable list — posts ranked by engagement, not chronological
- Clear "You're caught up!" endpoint
- Reduces infinite-scroll anxiety
- Accessible from feed page as a toggle or separate route

#### 29. AI compose assistance
- **Inspiration**: Ice Cubes
- AI-powered features in compose toolbar:
  - **Alt-text generation**: analyze attached image, suggest descriptive alt text
  - **Text correction**: fix typos/grammar
  - **Shorten**: condense text to fit character limits
  - **Hashtag suggestions**: suggest relevant hashtags
- Desktop: use CrispASR vision/language models
- Web: BYOK OpenAI-compatible endpoint (reuse existing translation BYOK pattern)
- All AI features optional, never auto-applied

### Priority 2 — Medium impact, nice differentiators

#### 30. Visual feed builder for Bluesky
- **Inspiration**: Skyfeed
- GUI for creating custom Bluesky algorithmic feeds without coding
- Filter by: keywords, language, has-media, min-likes, author list, exclude terms
- Preview feed results before publishing
- Publish feed to Bluesky network
- Manage/edit/delete own published feeds

#### 31. RSS feed integration
- **Inspiration**: Openvibe
- Subscribe to RSS/Atom feeds alongside social timelines
- Render RSS items as posts in unified feed and deck columns
- New deck column type: RSS
- OPML import/export
- Use cases: follow blogs, newsletters, Substack, news sites

#### 32. DeepL translation option
- **Inspiration**: Graysky
- Add DeepL as a translation provider alongside CrispASR / BYOK / MyMemory
- BYOK DeepL API key in settings
- Higher translation quality for European languages
- Free tier: 500K chars/month

#### 33. Algorithmic "For You" feed
- **Inspiration**: Mammoth
- Personalized timeline using local engagement data from analytics/archive
- Rank posts by: authors you interact with most, topics you engage with, time-of-day patterns
- All computation local — no server-side algorithm
- Privacy-preserving: your engagement data never leaves your device

#### 34. Real-time firehose counters
- **Inspiration**: Skyfeed
- Subscribe to Bluesky Jetstream for live-updating like/repost/reply counts
- Counters animate when updated
- Optional: real-time new post insertion in deck columns
- Toggle in settings (can be noisy)

### Priority 3 — Polish and UX

#### 35. OLED dark theme
- **Inspiration**: Moshidon
- True black (#000) background variant of dark theme
- Reduces battery usage on OLED/AMOLED screens
- Three theme options: light / dark / OLED black

#### 36. Tag groups
- **Inspiration**: Ice Cubes
- Save sets of hashtags as named groups
- Each group becomes a custom mini-timeline combining posts from all tags
- Usable as deck column source
- Quick-insert tag group into compose

#### 37. Post scheduling with calendar view
- **Enhancement of existing drafts**
- Visual calendar showing scheduled posts
- Drag to reschedule
- Preview how post will look on each platform
- Timezone-aware

#### 38. Hide engagement counts
- **Inspiration**: Skeets
- Toggle in settings to hide like/repost/reply counts on all posts
- Mental health feature — focus on content, not numbers
- Applies to feed, deck, thread view, and profile

#### 39. Thread un-rolling
- **Blue ocean**: no competitor does this
- Render a multi-post thread as a single readable article
- Clean typography, no repeated avatars/timestamps
- "Read as article" button on any thread
- Share un-rolled thread as image or text

---

## Blue Ocean Opportunities (v0.5.0+)

These features have **no equivalent in any competitor**:

#### 40. Cross-platform analytics comparison
- Side-by-side Bluesky vs Mastodon audience insights
- "Your Bluesky audience engages more on weekdays, Mastodon on weekends"
- Best posting times per platform
- Audience overlap visualization (how many followers are on both?)

#### 41. Optimal crosspost timing
- Analyze follower activity patterns from archive data
- Suggest best time to post on each platform
- Option to auto-delay crosspost: post to platform A now, schedule platform B for its optimal time

#### 42. Unified follower graph visualization
- Interactive graph showing follower overlap across platforms
- Identify: who follows you on both, who's only on Bluesky, who's only on Mastodon
- Uses existing identity matching infrastructure
- Exportable data

#### 43. Nostr and Threads support
- **Inspiration**: Openvibe
- Extend multi-network architecture to Nostr (NIP-01 relay protocol) and Threads (ActivityPub)
- Unified compose, feed, notifications across 4 networks
- Would make CrispDeck the most comprehensive open-social client with a deck view

---

## Architecture Notes

### Notification grouping (item #26) design

```
Group notifications by target post URI + type:
  Map<postUri, {
    type: 'like' | 'repost' | 'reply' | 'follow' | 'mention',
    actors: Actor[],
    post: Post,
    latestAt: Date,
    count: number
  }>

Sort groups by latestAt descending.
Render: "[avatar1, avatar2, +10] liked your post" with expandable actor list.
Follows are grouped separately: "15 new followers" with list.
```

### Cross-network dedup (item #27) design

```
For each post in unified feed:
  1. Check if author has a matched cross-platform identity
  2. If yes, look for posts from their other identity within ±5 minutes
  3. Compare text similarity (Jaro-Winkler > 0.85 = likely same post)
  4. If match found, merge into single feed entry with platform indicators
  5. Store dedup decisions in session cache (Map<uri, mergedUri>)
```

### Catch-up mode (item #28) design

```
Route: /catchup?hours=6

1. Fetch posts from last N hours (use existing feed pagination with date cutoff)
2. Score each post: likes × 2 + reposts × 3 + replies × 1
3. Sort by score descending
4. Show in scrollable list with "You're all caught up!" footer
5. Mark as read when user reaches bottom
6. Badge in sidebar: "Catch up (42 posts)"
```

---

## Phase 5: Polish & Robustness (v0.4.1)

#### 44. Fix Mastodon snake_case media properties
- Raw `fetch()` responses use `media_attachments`, `preview_url`, `remote_url` — not camelCase
- `getMastodonMedia()` in Post.svelte needs to handle both
- Same for deck columns that construct Mastodon posts from raw fetch

#### 45. Fix Mastodon link card snake_case properties
- `provider_name` vs `providerName` in card rendering
- Ensure `getMastodonCard()` handles both formats

#### 46. Add `g+u` (catch-up) to keyboard shortcuts dialog
- The `?` overlay lists all shortcuts but doesn't include the new catch-up shortcut

#### 47. Show hint in "For You" mode when archive is empty
- Currently shows empty feed with no explanation
- Should show: "Build your archive first to enable personalized ranking" with link to /archive

#### 48. Close AI compose menu on click-outside
- Currently the Sparkles dropdown stays open when clicking elsewhere
- Add click-outside handler (same pattern as other dropdowns in compose)
