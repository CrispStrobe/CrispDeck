# Local cache and search

CrispDeck can keep a compact, searchable copy of text on the current device.
The feature is **off by default**. Enable it in **Settings → Local cache & search**,
then choose **Local cache** on the Search page. Local queries use the device's
index and work offline; the existing network search continues to query social
providers.

The cache contains selected text and source links. It is useful for finding a
post or saved article again, including when a provider's remote search cannot
find it. It does not download article images or provide a complete offline
copy of every timeline.

## Choose what to keep

Posts and Wallabag have independent source switches and excerpt settings.

| Setting | Default | Meaning |
| --- | --- | --- |
| Local cache | Off | Enables collection and local search on this device. |
| Posts | Selected when enabling the cache | Capture supported posts encountered in CrispDeck. |
| Wallabag | Selected when enabling the cache | Allow connected Wallabag entries to be indexed. |
| Text to keep | Title and first paragraph | Keep the title, when available, plus the first nonempty paragraph. |
| Post excerpt limit | 1,000 characters | Maximum retained body text per post. |
| Wallabag excerpt limit | 2,000 characters | Maximum retained body text per entry. |
| History window | 90 days | Exclude items older than this window; `0` means all dates. |
| Maximum entries | 10,000 | Keep a bounded collection, removing the oldest items first. |

Each source can use **title only**, **title and first paragraph**, or **title and
a character-limited excerpt**. Posts without a separate title use a short text
heading. HTML is converted to plain text before it is stored or indexed.

Character limits accept 100–50,000 characters, the history window accepts
0–36,500 days, and the entry cap accepts 100–50,000 entries. The entry cap still
applies when all dates are allowed. These are text limits, not disk-space
guarantees: the index and database metadata also occupy storage.

Reducing an excerpt limit or history window removes text or entries that no
longer fit. Increasing a limit cannot recover text that was never retained:
revisit the post or import the Wallabag entry again to collect more text.

## Where indexed content comes from

### Social posts

The cache builds as supported posts are loaded in CrispDeck. It uses content
the connected services have already returned to the app; enabling the cache
does not crawl your accounts or silently download years of timeline history.

The history window is a retention rule, not a claim that all posts within that
period have been downloaded. Older posts can enter the index when you load them,
provided they fit the configured window and entry cap.

### Wallabag

Connect Wallabag in Settings, enable the local cache and Wallabag source, then
use the Wallabag import control. The import requests entries from the configured
Wallabag server, newest first, and applies the same excerpt and retention rules.
An import is bounded and can be cancelled; it does not run a background crawler
while the app is closed.

The browser build requires the Wallabag server to allow the app's origin through
CORS. Native builds use CrispDeck's native HTTP transport. Authentication stays
in the existing Wallabag credential store; the search database contains no
access tokens, refresh tokens, client secrets, or passwords.

## Search behavior

Local search matches indexed words in titles, retained excerpts, and author
metadata. Multiple query words narrow the result set. The final word can match
a word prefix, so you can start typing a word without finishing it. Source
filters narrow results to the selected content type or network.

Results show the retained text and a link to the source. Opening the original
post or article may require a connection. A short excerpt setting means words
beyond that excerpt cannot be found locally.

The local index is independent of providers' search syntax. Network operators
such as `from:` and `has:media` belong to network search; they are not an advanced
query language for the local cache.

## Storage, cleanup, and platform support

The implementation uses IndexedDB in the shared frontend. The same code serves
the web/PWA and Tauri's Windows, macOS, Linux, iOS, and Android builds, without a
native search extension or an additional service. It requires a working
IndexedDB store in the browser or system WebView. Storage restrictions, device
quota, and clearing site/app data can make the cache unavailable or remove it.
Settings shows the cache state rather than treating a failed write as success.

**Clear cache** removes retained snippets and their index. **Rebuild index**
reconstructs search terms from the snippets already retained; it does not fetch
longer content or restore removed entries. The broader cached-data purge also
clears this cache.

Items are scoped to the account or Wallabag connection that supplied them.
Removing a social account or disconnecting Wallabag removes that source's cached
items. The cache is local to each app installation or browser origin; settings
backup includes the preferences, not the IndexedDB contents.

This is a local cache, not an authoritative archive. Remote edits are reflected
when content is loaded again. Remote deletions or visibility changes may not be
observed immediately. Clear the cache whenever a fresh collection is needed.

## Implementation notes

`src/lib/search-cache.ts` owns the validated settings, plain-text records,
retention, storage status, and search. An IndexedDB `multiEntry` index stores
the normalized terms for each record. Queries intersect matching record keys
and load candidate records, avoiding a full document scan for every keystroke.
Record updates and deletes update the corresponding terms through the same
IndexedDB transaction.

Writes settle only after their transaction commits. Connection close and
version-change handlers allow database cleanup and later reopening. Collection
and import paths check the current settings so the feature can remain optional.
There are no raw provider objects, media payloads, or credential fields in a
search record.
