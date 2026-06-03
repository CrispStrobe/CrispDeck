# CrispDeck Development Plan

## Current State (2026-06-03)

32 commits, 118 tests, 16 pages, live at https://crispdeck.vercel.app

## Immediate Fixes Needed

### 1. Analytics overhaul
- **Problem**: Only loads first page of posts (50 bsky + 40 masto), so "top post" is often an old repost
- **Fix**:
  - Load ALL posts (paginate fully) before computing analytics, with progress bar
  - Show top 5 posts by likes, not just 1
  - Show top 5 by reposts, top 5 by engagement
  - Make stat cards clickable → expand to show the posts behind the number
  - Add platform breakdown per stat (Bluesky likes vs Mastodon likes)
  - Add date range filter (last 7d / 30d / 90d / all time)

### 2. Local post index / archive
- **Problem**: Search only hits live APIs. No way to search your own historical posts, likes, reposts
- **Solution**: Build a local IndexedDB archive that stores:
  - All your own posts (fetched via Load All)
  - Posts you've liked
  - Posts you've reposted
  - Posts you've replied to
  - Indexed by text, author, date, platform
- **Features**:
  - "Build Archive" button that paginates through your full history
  - Progress indicator (fetched X of ~Y posts)
  - Search within archive (full text, by author, date range)
  - Filter archive (only liked, only reposted, only replies)
  - Export from archive (JSON/CSV/MD) with filters applied
  - Archive stats (total posts, date range, platform breakdown)
  - Auto-refresh: append new posts on each visit

### 3. Deck improvements
- Add filters per deck column (search, hide replies/reposts, min likes)
- Add Mastodon-specific columns (local timeline, federated timeline)
- Column width adjustment
- Column reorder via drag

### 4. Feed improvements
- Show post source (which account loaded it) in multi-account mode
- "New posts available" indicator at top when new content arrives
- Pull-to-refresh on mobile

### 5. Messages improvements
- Fix Bluesky DMs (withProxy approach may need further debugging)
- Full conversation thread loading for Mastodon (currently shows only last message)
- Send new conversation (not just reply to existing)
- Unread badge in sidebar

### 6. Profile improvements
- Show who a user follows / is followed by (follower lists)
- "Posts and replies" vs "Posts" vs "Media" should paginate
- Add block/mute buttons on profile
- Show if user is following you (follows you badge)

## Medium-term Features

### 7. Post interactions expansion
- Bookmark posts locally (cross-platform bookmarks in IndexedDB)
- Thread view: click a post → see full thread with context
- Share/copy link to post
- Report post/account

### 8. Multi-column deck enhancements
- Saved column layouts (name and switch between layouts)
- Column for specific user's posts
- Column for a hashtag
- Column for a Bluesky custom feed
- Column for a Mastodon list timeline
- Auto-refresh columns on interval

### 9. Compose enhancements
- Emoji picker
- GIF search and insert
- Schedule posts with preview of what they'll look like
- Post templates (save reusable templates)
- Character count warning thresholds (80%, 90%, 100%)

### 10. Accessibility & i18n
- Screen reader improvements (ARIA labels throughout)
- Keyboard navigation for all interactive elements
- Language selector
- RTL support

## Architecture Notes

### Local Archive (item #2) design

```
IndexedDB store: 'archive'
Schema:
  id: auto
  uri: string (unique)
  platform: 'bluesky' | 'mastodon'
  type: 'post' | 'like' | 'repost' | 'reply'
  text: string
  author_handle: string
  author_name: string
  created_at: string (ISO)
  like_count: number
  repost_count: number
  reply_count: number
  has_media: boolean
  raw: object
  indexed_at: string (ISO)

Indexes:
  - platform
  - type
  - author_handle
  - created_at
  - text (for search — may need a separate FTS approach)

For full-text search in IndexedDB, use:
  - Simple: filter + includes() on text field
  - Better: maintain a separate word→uri inverted index
  - Best: use a WASM-based search lib like minisearch
```

### Analytics pagination (item #1) design

```
Current: loads 1 page per account
New: async generator that yields pages, updates stats progressively

async function* fetchAllPosts(accounts, clients) {
  for (const acct of accounts) {
    let cursor;
    do {
      const { feed, cursor: next } = await fetchPage(acct, cursor);
      yield { posts: feed, acct, progress: ... };
      cursor = next;
    } while (cursor);
  }
}

// In component: iterate and update stats reactively
for await (const batch of fetchAllPosts(...)) {
  posts = [...posts, ...batch.posts];
  // $derived stats update automatically
}
```
