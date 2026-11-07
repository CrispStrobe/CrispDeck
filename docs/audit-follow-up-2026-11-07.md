# CrispDeck integration audit follow-up — 2026-11-07

## Integration status and scope

This follow-up reviewed the code after the original audit was combined with the current feed, thread, Wallabag, translation, and release work. It found additional account-selection bugs, asynchronous lifecycle races, credential-transport gaps, browser database inconsistencies, and avoidable repeated work. The changes below are integrated together on [`fix/audit-security-reliability-2026-11-07`](https://github.com/CrispStrobe/CrispDeck/tree/fix/audit-security-reliability-2026-11-07), under [PR #84](https://github.com/CrispStrobe/CrispDeck/pull/84).

The code/CI revision used for final verification is [`35cf3f6cee57bf8e30e423c3ea35ca9c2a50ccd0`](https://github.com/CrispStrobe/CrispDeck/commit/35cf3f6cee57bf8e30e423c3ea35ca9c2a50ccd0). At the source-status check, `main` remained at [`c01c588f744ca3603643f03ccad6be73a2af7a2b`](https://github.com/CrispStrobe/CrispDeck/commit/c01c588f744ca3603643f03ccad6be73a2af7a2b); PR #84 was open and unmerged. Integration on the feature branch does not establish a release or deployment containing these changes.

The follow-up began from `f2f05d7`, which already contained the original audit and six intervening feature/integration commits. Twenty-two further code/test/CI checkpoints were pushed as cohesive changes, followed by this documentation checkpoint. Three commits arriving during the review were inspected and preserved: the publishing timezone regression (`267bb51`), scoped Threads actions (`18a5ef7`), and their integration merge (`2b80a02`). Branch writes used an expected-head check, so a concurrent update could not be silently overwritten. The original audit report remains available at [audit-2026-11-07.md](audit-2026-11-07.md).

## Confirmed issues fixed

### Account identity survives reactions and navigation

The feed's action path could select a different connected account and failed to apply the undo argument consistently. Feed and thread reactions now use the shared [source-account action helper](../src/lib/deck-actions.ts). An unavailable or failed source account produces an error instead of retrying the action as another identity. Threads retains its scoped reaction support, and concurrent duplicate rows reuse a completed like/repost receipt instead of creating duplicate remote actions. A queued like followed by unlike still performs both transitions. Threads repost undo remains explicitly unsupported.

[Composer context](../src/lib/compose/context.ts) carries the source account, direct or wrapped Bluesky CID, reply root metadata, and Mastodon local reply ID or web quote URL. The [composer](../src/routes/compose/+page.svelte) selects an explicit valid source account only. An unavailable or incompatible explicit account leaves the selection empty. Older context links select a sole matching-platform account, or require the user to choose when ambiguous. Existing draft and autosave selections are preserved.

Mounted [feed](../src/lib/feed-page.test.ts), [thread](../src/lib/thread-page.test.ts), and [composer persistence](../src/routes/compose/compose-persistence.test.ts) regressions exercise the actual Svelte pages. [Deck action tests](../src/lib/deck-power.test.ts) cover duplicate actions and their ordering.

### Feed requests, offline snapshots, and reading positions stay in their own view

Slow refreshes and pagination could finish after switching feeds or accounts, replacing the new view and writing old posts under its cache key. Asynchronous initialization could also continue after unmount. The [feed page](../src/routes/feed/+page.svelte) now uses request and account generations to reject superseded results. Listener setup is synchronous and teardown covers unfinished initialization. New-post polling, affinity history, and scheduled scroll restoration also reject obsolete work.

Cache and reading-position keys include account identities, platform instance/account IDs, feed mode, and custom feed/list URI. Tests cover reuse of a local account ID by a different DID. A successful empty response clears stale content. Offline fallback is reserved for unsuccessful loading and reads only the matching account/view snapshot. Removing the last account clears posts, loading/progress, and the pull-refresh indicator immediately; a late response cannot restore or cache that account's content.

IndexedDB now receives plain Svelte snapshots rather than reactive proxies, which cannot be structured-cloned. [Offline cache writes](../src/lib/offline-cache.ts) resolve after transaction completion. Both offline and main browser database connections close for version changes or deletion and reopen when needed. [Persistence tests](../src/lib/offline-cache.persistence.test.ts) use fake IndexedDB to exercise commit timing and database deletion, rather than mocking the cache helper itself.

### Browser updates and deletion cascades are atomic

Independent read/modify/write operations could overwrite concurrent account or identity edits, combine competing follow snapshots, recreate a deleted draft, or leave orphan identity records. [browser-db.ts](../src/lib/browser-db.ts) now performs dependent reads and writes within one transaction. Account deletion removes follows and detaches identity references atomically. Identity deletion removes its links and tags atomically. Follow refreshes and child-record insertion check that the relevant account/identity still exists inside the write transaction. Concurrent link/tag insertion is deduplicated, and tag removal removes legacy duplicate rows as well.

Identity listing now applies the documented confirmed/tag filters. Account results omit the internal encrypted credential field. [Database persistence regressions](../src/lib/browser-db.persistence.test.ts) cover concurrent edits, deletion races, follow replacement, filtering, duplicate insertions, and connection lifetime.

Credential encryption also rechecks persisted seed/salt after asynchronous derivation and encryption. If storage is cleared or changed while either operation is pending, the write fails and can be retried instead of reporting success with unreadable ciphertext. [Credential tests](../src/lib/browser-credentials.test.ts) delay those operations deliberately and verify that a successful retry can be decrypted after module reload.

### Credential-bearing requests cannot silently follow native redirects

Inspection of the installed Tauri HTTP plugin confirmed that its native request builder does not forward Fetch's `redirect` field. The browser setting alone therefore did not enforce the intended policy. [Wallabag](../src/lib/wallabag.ts), the [Threads client](../src/lib/api/threads.ts), and native [Threads deck loading](../src/lib/deck-loader.ts) now set the native `maxRedirections: 0` option explicitly. Browser credential requests reject redirects. [Mastodon registration/token validation, exchange, and revocation POSTs](../src/lib/mastodon-app.ts) use the same browser redirect protection; ordinary public federation discovery GET behavior is preserved.

Regression tests inspect both native and browser request options. They verify the transport boundary; they do not establish behavior of a signed application on a physical device.

### Wallabag connection lifetime and settings are consistent

Delayed login or token refresh could restore a disconnected session or replace a newer connection to the same server. Token rotation, persistence, and deletion are now serialized, using Web Locks across browser tabs where available. Disconnect/reconnect increments a connection generation and aborts older requests. New logins have distinct connection identities, and native operations retain the selected credential backend/keychain snapshot. Another tab's deletion is observed because reads no longer trust a stale in-memory session.

Concurrent saves share token rotations. A late 401 reuses an already rotated token rather than spending the same refresh token again. Stored sessions and token responses are validated; token bodies are limited to 64 KiB, and a 30-second deadline remains active through body consumption. Browser requests omit ambient cookies and bypass caching. Errors avoid reflecting token-response contents. Failed persistence or deletion remains visible and retryable.

The [settings page](../src/routes/settings/+page.svelte) verifies that the server preference can be written before starting authentication, snapshots submitted values, disables fields during the operation, normalizes server URLs, and clears entered secrets after a successful disconnect. The [link menu](../src/lib/components/LinkContextMenu.svelte) verifies an actual session instead of treating a saved URL as a connection; an asynchronous save retains its original server and article. Setup navigation respects the application's base path. [Settings export/import](../src/lib/settings-export.ts) excludes legacy Wallabag URLs containing embedded credentials, queries, or unsupported schemes, in addition to excluding the session itself.

The [Wallabag API tests](../src/lib/wallabag-api.test.ts) cover delayed connection and refresh, backend changes, concurrent rotations, late 401s, cross-tab deletion, invalid token bodies, timeout behavior, and storage errors. [Menu tests](../src/lib/components/LinkContextMenu.test.ts) render the component with controlled native/session boundaries.

### Native keychain selection and deletion failures are handled correctly

The persisted macOS keychain setting and active OS-store selection now change while holding the same database mutex used for credential commands. This prevents a concurrent credential write from using one keychain while its record identifies another.

The former macOS deletion call ignored the OS result. [mac_keychain.rs](../src-tauri/src/auth/mac_keychain.rs) now uses a deletion operation scoped to the selected keychain, service, and exact account key that returns errors. Only an absent item counts as idempotent success. Failed [session deletion](../src-tauri/src/commands/db_commands.rs) retains its marker so the user can retry.

Tests now restore temporary environment overrides, including on unwind. Without that isolation, a preference test could leave `login` selected and make other macOS keychain CI legs exercise the wrong store. The [Secret store workflow](../.github/workflows/secret-store.yml) cancels obsolete branch runs, uses a 45-minute timeout, explicit read-only repository permissions, relevant dependency/command path triggers, and locked Cargo commands.

## Worthwhile optimizations and correctness safeguards

| Change | Work removed or bounded | Evidence |
| --- | --- | --- |
| Shared browser key derivation | Parallel credential operations share one 600,000-iteration derivation for unchanged persisted material | Five parallel encryptions produce one derivation; storage changes still invalidate it |
| Shared database opening | Concurrent views await one in-flight database open | Persistence regression asserts one open for four concurrent operations |
| Indexed identity joins | Links and tags are grouped once instead of repeatedly filtering all rows for every identity | Database filtering and ownership regressions |
| Lazy For You affinity | Ordinary timeline visits avoid three archive reads of up to 500 records each | Mounted feed tests verify no archive read until For You is opened |
| Single cache serialization | A view payload is serialized once for persistence and size accounting | Serialization call-count regression |
| Iterative thread traversal | Avoids recursive stack growth and repeated sibling-array copies | A 20,000-post reply chain completes without stack overflow |
| Freshness-aware post caches | Same-length HTML edits, new post objects, text edits, and identity-map changes invalidate stale results | Four focused cache-freshness regressions plus existing feed-scale guards |
| Lazy native context menu and Wallabag client | Browser startup does not download unused native menu behavior; credentials load when the native menu needs them | Production bundle measurements and mounted menu regressions |

The thread tree also gives the current selected post precedence over duplicate ancestors and compares stable author identities before handles. Article mode follows only contiguous same-author ancestors and continuations, so an intervening person's reply cannot splice separate contributions into one article. Same-DID continuations survive handle changes.

These are reductions in redundant work and concrete scale/correctness checks. They are not measurements of physical-device frame rate, battery use, network latency, or user-perceived startup time.

### Production bundle gate

The first final build exceeded the repository's unchanged 90 KiB entry budget: **95,510 bytes / 93.3 KiB gzip**. Deferring the native menu and its Wallabag client reduced it to **91,887 bytes / 89.7 KiB**, saving **3,623 bytes (3.8%)**. The heaviest route, `/deck`, adds **116,824 bytes / 114.1 KiB**, below its 120 KiB budget. The existing nine-package lazy-import guard also passes.

An alternative icon-chunk split increased both entry and route downloads in the measured build and was reverted. No budget was increased. [Pull-request CI](../.github/workflows/ci.yml) now generates the chunk map, runs the existing bundle-budget checker, and retains the report on failure; previously that budget was enforced by the separate performance workflow after main-branch updates.

## Final verification

| Check | Result |
| --- | --- |
| Full JavaScript suite | **2,774 passed, 62 skipped**; 209 files passed, 7 skipped, 216 total |
| Svelte/TypeScript check | **0 errors, 0 warnings** |
| Separate API TypeScript project | Passed |
| Production static build | Passed |
| Entry/route size and lazy-package budget | Passed; 89.7 KiB entry, 114.1 KiB heaviest route, nine guarded packages remain lazy |
| Python release/platform guards | **79 passed**: 45 scripts, 21 release, 5 App Store Connect, 8 Google Play |
| Original-source native helper/command harness | **111 passed**, including 23 database-command tests; real OS-store execution gated off |
| Actual macOS auth modules and tests | Cross-type-check passed for `x86_64-apple-darwin`, with real security-framework 3.7.0 |
| Workflow YAML, whitespace, and report links | Passed |
| Browser end-to-end | No successful local run; Chromium startup was blocked by denied socket creation |
| Latest feature-branch CI and Secret store workflows | Pending/queued at reporting time; consult the live checks in PR #84 |

The full JavaScript suite was rerun after the final startup import changes. Local JavaScript validation used Node 24.22.1 and npm 11.9.0. Skipped tests are not passing evidence. The focused suites mentioned above overlap with this total and are not additional tests to add to it.

An independently dispatched [macOS package workflow](https://github.com/CrispStrobe/CrispDeck/actions/runs/42397628198) completed successfully during this review at the earlier commit `b916c63`: the Tauri application and signed package built successfully, and App Store Connect upload was skipped. Native source has not changed since that checkpoint, but its web bundle does not include the later feed, Wallabag, and startup changes. The independently dispatched [iOS build](https://github.com/CrispStrobe/CrispDeck/actions/runs/42397628139) was still running at that same earlier checkpoint. Neither is validation of the final combined bundle. This audit did not dispatch those release workflows.

## Remaining security findings and validation limits

The fresh npm audit still reports **22 affected package entries: 16 high and 6 low, with zero critical or moderate entries**. The high entries propagate [one Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) through the AT Protocol dependency tree. The compatible SDK paths continue to require Zod 3, and the [maintainer states that new v3 releases have stopped](https://github.com/colinhacks/zod/issues/6653). A forced major-version replacement would change dependency APIs and was not applied. Dependency counts do not establish exploitability through a particular CrispDeck endpoint.

The low entries remain associated with the Svelte toolchain, cookie, and deepmerge. SvelteKit's [vendor advisory identifies 2.70.4 as patched](https://github.com/sveltejs/kit/security/advisories/GHSA-27mw-82g8-phjj) for prerendered cache-control header escaping, while npm still reports the broader affected range. The original report records the other compatibility and exposure findings.

The application Cargo lockfile is unchanged in this follow-up, with SHA-256 `e1622a5d17f96b8e3ea78c63a3f58471304bed5575a0d0bd867bbdb3ba43cba7`. The earlier direct RustSec database/range review against `309392b18f6b17022f82c701f300433126901068` therefore still describes this lockfile: zero active vulnerability advisory matches, one [GLib unsoundness notice](https://rustsec.org/advisories/RUSTSEC-2024-0429.html), and 12 maintenance-notice package instances. The GLib fix requires the newer API family; the current GTK dependency path remains on 0.18.

Real browser OAuth, signed WebViews, physical devices, and live provider accounts were not exercised. Browser Wallabag use also depends on the configured server allowing CORS. The local Chromium attempt was blocked at startup by denied socket creation; the full Linux Tauri build requires unavailable GTK/WebKit development libraries. Those restrictions were not bypassed.

Existing operational findings remain: explicit local/mobile credential encryption uses a machine-derived key; historical public push records or previously shared secret-bearing exports may require operator cleanup/revocation; prior lost database rows cannot be reconstructed by a new migration; deployment-wide rate/replay controls are separate work. The unfinished background push backend remains intentionally unavailable.

## Reproduction commands

From the repository root with the locked npm dependencies installed:

```bash
npm run check
npx tsc --noEmit --project api/tsconfig.json
npm test -- --maxWorkers=2
BENCH_CHUNK_MAP=1 npm run build
node bench/bundle-size.mjs build > bundle-size.json
node bench/check-budget.mjs bundle-size.json bench/bundle-budget.json
python3 -m unittest discover -s scripts -p 'test_*.py'
python3 -m unittest discover -s tools/release -p 'test_*.py'
python3 -m unittest discover -s tools/asc -p 'test_*.py'
python3 -m unittest discover -s tools/play -p 'test_*.py'
npm audit --json
git diff --check
```

The full native CI gate remains `cargo test --lib --locked` and `cargo check --locked` in `src-tauri`, on runners with the platform SDKs. Local native verification used a temporary harness importing the actual database, auth, app-data, and command source modules. It substituted only the Tauri command attribute and `State` wrapper, ran with `CRISPDECK_REAL_KEYCHAIN` unset, and does not validate generated IPC glue or real OS-store operations. A separate harness compiled the actual macOS auth modules and tests for `x86_64-apple-darwin` with real `security-framework = 3.7.0` and no API shim; it did not execute a macOS keychain or link the full application.
