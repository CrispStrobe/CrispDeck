# CrispDeck Roadmap

## Done

- [x] Multi-account management (Bluesky + Mastodon)
- [x] Bluesky OAuth (PKCE + DPoP) — full access including DMs
- [x] Timeline feed (posts from followed accounts) + My Posts
- [x] Infinite scroll + "New posts available" indicator
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
- [x] Multi-column Deck view (TweetDeck-style) with 11 column types
- [x] Profile pages (view any user, follow/unfollow, posts/replies/media/followers/following tabs)
- [x] Block/mute on profiles
- [x] Notifications (unified Bluesky + Mastodon)
- [x] Direct messages (Bluesky OAuth chat + Mastodon conversations with full threading)
- [x] Lists & Feeds (Mastodon lists + Bluesky custom feeds)
- [x] Bluesky Starter Packs (browse, search)
- [x] Trending (Mastodon tags/links/posts with Latin script filter)
- [x] Moderation (block/mute management, both platforms)
- [x] Cross-platform bookmarks (IndexedDB)
- [x] Thread view (click post → full parent chain + replies)
- [x] Share/copy link to post
- [x] Report button (opens platform reporting)
- [x] Mastodon polls (create + vote on existing)
- [x] Bluesky thread gates (Anyone / Mentioned / Followers / Nobody)
- [x] Video upload support (MP4/WebM/MOV up to 100MB)
- [x] Alt text editing for images
- [x] Emoji picker in compose
- [x] Post templates
- [x] Character count warning thresholds (gray/orange/red/yellow)
- [x] Keyboard shortcuts (? for help, g+key navigation, Ctrl+Enter to post)
- [x] Collapsible sidebar + mobile hamburger menu + bottom tab bar
- [x] Web (Vercel) + Desktop (Tauri) + Mobile responsive layout
- [x] CI/CD: tests + builds on Linux/macOS/Windows
- [x] 118 unit + integration tests

## Remaining

- [ ] GIF search and insert (via Tenor/Giphy API)
- [ ] Push notifications (Tauri mobile)
- [ ] Bluesky labeler interaction
- [ ] Instance info/rules display (Mastodon)
- [ ] Media gallery view (all media from an account)
- [ ] Bluesky OAuth for Tauri desktop (not just browser)
