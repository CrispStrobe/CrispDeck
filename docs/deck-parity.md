# Deck workflows and competitive coverage

Reviewed 6 November 2026. This document distinguishes working client features
from services and network capabilities that CrispDeck does not provide.

## Reference products

The comparison uses official product documentation and creator announcements:

- [X Pro usage and column types](https://help.x.com/en/using-x/how-to-use-x-pro)
- [X Pro advanced features](https://help.x.com/en/using-x/advanced-xpro-features)
- [Deck.Blue 2.20 release notes](https://www.patreon.com/deckblue/posts/deck-blue-v2-20-154420498)
- [Deck.Blue 2.23 announcement](https://bsky.app/profile/deck.blue/post/3mnxl6l5wp522)
- [Deck.Blue scheduling FAQ](https://www.patreon.com/deckblue/posts/deck-blues-faq-94014314)
- [Bluesky gallery embed announcement](https://github.com/bluesky-social/atproto/discussions/5032)

X Pro documents account-specific columns, advanced filtering, workspaces,
bookmarks, messages, and a scheduled-post column. Deck.Blue's release notes
establish account refresh, native bookmark synchronization, live chat fixes,
portable columns/settings, and ten-image posting. Product-specific claims
should be checked against these sources again when planning a later release.

## Implemented in this change

### Columns as complete workflows

CrispDeck now has 23 column types, adding **Bookmarks**, **Drafts**, and
**Scheduled** to its existing 20 types. The column settings dialog can edit a
column's title, source query, source accounts, network, filters, and refresh
interval. It includes a list picker for Mastodon lists and Bluesky graph lists.
The feed picker correctly opens a Bluesky list as a list, rather than asking
the feed-generator endpoint to load it.

Account selection is persistent. A missing/disconnected imported account or an
explicitly empty selection stays empty; it never silently falls back to another
account. Source account names appear in the column. Network loaders and actions
keep the account which fetched a row, including OAuth Bluesky accounts. Failed
likes/reposts are not retried under a different identity, and undo operations
use the matching unlike/unrepost endpoint.
Pending actions are serialized, and reconnecting a socket cannot let its older
connection deliver stale events or close the replacement connection.
Open columns, inboxes, and thread views also respond to account reconnects and
membership changes. Late responses from retired clients cannot replace current
content. Reuse of a local account ID does not reuse another actor's rows,
conversation drafts, or cached follow graph.

The network loader supports independent cursors for each selected account and
each tag/keyword source. Timeline, own posts, search, hashtags, users, lists,
custom feeds, local/federated feeds, likes, mentions, notifications, activity,
and follower columns can load older results when their provider supplies a
usable next page. Searches include the selected supported networks. Mastodon
favourites use the provider's favourite cursor instead of confusing it with a
status ID; provider-supplied URLs cannot redirect authenticated pagination to
another origin. Threads search is paginated only if Meta returns a cursor.

Refreshing prepends new rows, updates existing rows, and keeps older pages.
Account failures are shown in the affected column while already-loaded results
remain. Removed columns, workspace switches, and edited sources invalidate
outstanding requests. Each column offers pause/resume, configurable polling,
a new-items indicator, duplicate, and keyboard-operable position controls.
Paused columns do not accept automatic refreshes.

### Filtering and live updates

Filters are saved with the column and workspace: included text, excluded
phrases, author, language, media, replies/reposts, minimum likes/reposts,
notification types, and local muted words/regular expressions. Global post
mutes continue to apply. Notification filters operate on grouped notification
content and actors. Stateful regular expressions reset between posts so a
`/pattern/g` mute does not accidentally alternate between matching rows.

Live updates refresh the authoritative account feed. An unfiltered Jetstream
record is no longer treated as a complete feed post. Home/user/mention signals
are scoped to the selected identity/follow graph; keyword signals use their
configured matcher. Mastodon notification events are distinguished from home
posts. Accounts on the same Mastodon instance use separate authenticated
streams, and unused subscriptions close when their last column goes away.
Deletion events cannot be undone by an older request completing later.

### Workspaces and portability

The Workspaces dialog exposes save/update, switch, rename, duplicate, delete,
and individual/all-workspace export. Imports validate version, shape, column
types, identifiers, bounds, and size before a storage mutation. Existing
workspaces are retained; duplicate imported names receive a distinct name.
Export contains an allowlist of column settings and stable account identities;
it omits stored account credentials and local numeric account IDs. Missing destination accounts are
reported and must be selected explicitly on the receiving device.

Storage failures remain errors instead of reporting a successful save. Named
workspaces retain column edits. Dialogs support keyboard focus, Escape, and
small viewports. New interface strings are supplied in all eight UI languages.

### Composing and publishing

The floating deck composer has explicit **Save Draft** and **Schedule** actions
using the same durable snapshots and delivery system as the full composer.
Media bytes, alt text, destination overrides, visibility, reply roots, quote
context, and restored advanced options survive saving and reopening. Starting
a different reply/quote preserves unsent work first. Replies/quotes from a
scoped row select its source account; continuing a restored draft keeps its
saved destinations. Pending/partially delivered content remains locked until
an explicit new draft is created.
Delivery jobs freeze remote account identities, verify them before publishing,
and allow a reconnected account with a new local ID only when that remote
identity matches. Mastodon reply targets are verified or resolved on each
destination instance before writing, because status IDs differ between servers.

Draft and scheduled columns show local publishing state, account targets,
schedule/timezone, and edit/review links. They support scheduling, rescheduling,
cancelling, and confirmed deletion through the existing scheduler/draft/outbox
locks. Merely opening a queue column never publishes a post.

Media selection and publishing validate each destination before upload. The
Bluesky gallery record supports five to ten images, while one to four keep the
compatible image embed; gallery views are rendered as media. Attachments are
not silently truncated to four. The selected networks' limits are visible,
and incompatible media/URL combinations are rejected before delivery.

### Direct messages

Deck conversation cards open the relevant inbox thread instead of a public
post/thread route. The message inbox, message reads, sends, and new conversations
retain account identity. Bluesky chat uses that account's own agent and chat
proxy. An expired account cannot fall back to a different account's OAuth
session. Delayed responses cannot replace another selected conversation, and
unsent message text is kept separately per conversation.

Thread navigation retains the source account and uses its authenticated view,
including OAuth Bluesky and private Mastodon threads. Post bookmark writes,
poll votes, and server translations also retain the source identity. Native
bookmark imports keep media and account metadata in the local saved-post view.

## Existing features retained

The app already provides crossposting and thread splitting; images/video and
alt text; drafts and delivery retries; content warnings, polls where supported,
Bluesky reply/quote controls; global moderation; saved search; custom feeds;
reading collections and export; analytics/archive; keyboard navigation;
dark/light/OLED display; and desktop/mobile/PWA shells. These are independent
of the new deck controls and remain available on their existing pages.

## Deliberate service and platform boundaries

| Capability | Current boundary |
|---|---|
| Scheduling while the app/device is closed | Scheduling is still on-device. Keep CrispDeck open. A trusted posting backend, secure token custody/refresh, delivery ownership, and monitoring would be a separate service project. |
| Automatic cross-device synchronization | Workspace/settings files provide portable setup; they are not automatic cloud synchronization. |
| Shared team roles and account delegation | Not implemented. Exporting a layout does not grant account access or create a team workspace. |
| X-specific Explore/Communities/Delegate | CrispDeck does not connect to X. Analogous capabilities require support from the selected network's API. |
| Threads home timeline, chat, and notification API | Unavailable through the integrated public API. The column picker/account eligibility excludes unsupported combinations. |
| Network-wide regex search | Provider searches cannot execute arbitrary client regular expressions. Keyword columns combine supported search/timeline backfill with locally matched live signals. |
| Live delivery timing | Streaming triggers account-authoritative refreshes; provider indexing, polling intervals, reconnects, and background tab suspension affect arrival time. |
| External accounts and physical devices | Automated tests mock remote boundaries. Real account sign-in/posting and native-device behavior remain subject to the existing validation matrix. |

## Verification and implementation map

- `deck-loader.test.ts`: OAuth/account scoping, source cursors, retries, response
  normalization, mention hydration, network search and pagination.
- `deck-power.test.ts`: filter combinations, live-event scoping, source-account
  interactions, deleted-row handling, stream isolation and cleanup.
- `deck-live-retry.test.ts`: recovery from failed live setup and cancellation
  during a retry or pending identity lookup.
- `deck-workspaces.test.ts` and `WorkspaceManager.test.ts`: validated import,
  identity remapping, failure handling and actual UI actions.
- `deck-publishing.test.ts` and `PublishingColumn.test.ts`: local queue state,
  mutation locks, lifecycle, filtering and explicit actions.
- `FloatingCompose.test.ts` and compose/media tests: mounted composer workflow,
  snapshot preservation and destination media rules.
- Message service/route tests: inbox and send identity, deep links, draft text,
  and stale asynchronous responses.
- Thread, bookmark and delivery tests: authenticated account context, native
  bookmark writes/imports, stable retry identities and instance-local replies.
- `e2e/deck-workflows.test.ts`: real browser storage and UI with mocked remote
  networks, pagination/refresh, persisted filters, source-account undo,
  workspace export/import, empty selections, and mobile dialog geometry.
- The complete frontend suite, Svelte check, production build, and existing
  GitHub browser/native CI provide the broader regression gates.
