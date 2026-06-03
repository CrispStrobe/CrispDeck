# CrispDeck Roadmap

## Done

- [x] Multi-account management (Bluesky + Mastodon)
- [x] Timeline feed (posts from followed accounts)
- [x] My Posts feed
- [x] Infinite scroll
- [x] Compose + crosspost with thread splitting
- [x] Identity map + auto-detection
- [x] Smart @-mentions
- [x] Like/boost/reply interactions
- [x] Drafts with scheduling
- [x] Network search
- [x] Analytics + export (JSON/CSV/MD)
- [x] Web (Vercel) + Desktop (Tauri) support
- [x] CI/CD + release builds (Linux/macOS/Windows)
- [x] 115 unit + integration tests

## In Progress

- [ ] Profile views (click avatar → see full profile with bio, stats, posts)
- [ ] Reply compose (reply-to context from feed)

## Planned — Full Client Features

### Profiles
- [ ] Profile page: avatar, banner, bio, follower/following counts
- [ ] View anyone's posts, replies, media, likes
- [ ] Follow/unfollow from profile
- [ ] Block/mute from profile
- [ ] View followers/following lists

### Notifications
- [ ] Bluesky notifications (listNotifications)
- [ ] Mastodon notifications (/api/v1/notifications)
- [ ] Unified notification feed
- [ ] Notification badge in sidebar

### Lists & Feeds
- [ ] Bluesky custom feeds / algorithm feeds
- [ ] Bluesky starter packs (view, join, create)
  - Prior art: CrispStrobe/starter-pack-explorer, CrispStrobe/bluesky-starterpacks-index
- [ ] Mastodon lists (create, manage, view timeline)
- [ ] Multi-column deck view (TweetDeck style)

### Moderation
- [ ] Block list management (both platforms)
- [ ] Mute management
- [ ] Content filtering / labeling (Bluesky labels)
- [ ] Report post/account

### Direct Messages
- [ ] Bluesky DMs (chat.bsky.convo)
- [ ] Mastodon DMs (direct visibility statuses)

### Media
- [ ] Video upload support
- [ ] Alt text editing for images
- [ ] Media gallery view (all media from an account)

### Mobile
- [ ] Tauri 2 iOS build target
- [ ] Tauri 2 Android build target
- [ ] Responsive mobile-optimized layout
- [ ] Push notifications

### Bluesky-specific
- [ ] Starter pack explorer (integrate/revive CrispStrobe/starter-pack-explorer)
- [ ] Labeler interaction
- [ ] Thread gate settings
- [ ] Quote post compose

### Mastodon-specific
- [ ] Polls (create + vote)
- [ ] Announcements
- [ ] Trending tags/links
- [ ] Instance info/rules display
