# CrispDeck development plan

Updated 12 November 2026. Completed work and the superseded September–October
plan are preserved in [HISTORY.md](HISTORY.md). This plan distinguishes shipped
code, release state, and validation that still needs accounts or devices.

## Current code and evidence

- Main baseline: `cfef599`, version **1.3.4**. Mastodon, Bluesky and Threads;
  desktop/mobile Tauri and a static web app with optional server endpoints.
- Latest baseline main CI: [42927323891](https://github.com/CrispStrobe/CrispDeck/actions/runs/42927323891).
  3,024 JavaScript tests passed, 63 skipped; 142 browser tests passed;
  Svelte reports zero errors/warnings; Rust checks passed on all three desktop
  platforms. These counts describe that source, not every future revision.
- [Live APIs](https://github.com/CrispStrobe/CrispDeck/actions/runs/43222602975)
  passed on 12 November. Public/invalid-token API probes do not establish
  authenticated posting, real provider OAuth or physical-device behavior.
- Current workflows include Chromium, desktop/mobile WebKit and native Android
  layout checks. Signed package smoke checks remain part of coordinated release.

## Implemented workflows

- 23 deck column types, account-scoped loading/actions, independent pagination,
  workspace editing and validated credential-free import/export, filters,
  streaming, explicit pause/refresh and keyboard position controls.
- Durable drafts, floating/full compose, destination previews, source-bound
  delivery retries and scheduled queues. Scheduling requires the app to remain
  open; uncertain remote writes require review before retrying.
- Native OAuth callbacks use the app URL scheme. macOS Bluesky sessions use the
  selected native credential backend instead of WebKit CryptoKey persistence.
- Wallabag Reader and optional account-scoped persistent local search. Indexed
  social history consists of content already loaded; Wallabag has explicit
  resumable history import. Direct messages are excluded from the search index.
- Compact mobile feed/deck layouts, safe areas, source attribution, native media
  and export transport, cached search return and multiword account search.
- Security/reliability fixes in the [audit](docs/audit-2026-11-07.md) and
  [integration follow-up](docs/audit-follow-up-2026-11-07.md) are merged.

See [deck workflow coverage](docs/deck-parity.md),
[search cache behavior](docs/local-search-cache.md), and [CHANGELOG.md](CHANGELOG.md).

## Active work, in order

1. **Qualify and release 1.3.4.** Run required CI and the exact-source package
   coordinator, retain receipts/checksums, verify final release titles, and
   distribute the verified Mac/iOS builds through existing Apple workflows.
   Follow [the release checklist](docs/release-1.3.4.md).
2. **Complete authenticated/device validation.** The [matrix](docs/validation.md)
   remains pending where no dated account/device evidence exists. Exercise
   OAuth and restart, multi-account actions, media drafts/crossposting,
   interrupted delivery and scheduling on physical Mac/Android first. Do not
   substitute browser fixtures or simulator routing for these checks.
3. **Close operational security follow-up.** Verify the deployed push endpoints
   stay disabled, inventory any legacy subscription storage without exposing
   its contents, assess affected backups/log exports, and document cleanup.
   [Operational procedure and access status](docs/security-operations.md).
4. **Reconcile distribution state.** On 12 November, Apple reports iOS and macOS
   **1.3.2 WAITING_FOR_REVIEW**, while GitHub's latest final release is 1.3.3.
   Keep the current review queue intact while preparing 1.3.4 packages. A new
   upload or TestFlight assignment is not App Store approval.

## Deliberately unavailable or separate

- **Background web push is unavailable.** Subscribe/key endpoints return 501;
  the sender is unimplemented. Notifications while CrispDeck is open still work.
  Do not enable VAPID configuration as a substitute for a private-storage,
  authorization, credential-custody and privacy design. Historical cleanup is
  tracked separately from the already merged prevention fix.
- **Instagram:** [draft PR #88](https://github.com/CrispStrobe/CrispDeck/pull/88)
  is a native website surface, not an API timeline or merged-feed integration.
  It needs current-main integration, a passing unchanged bundle budget and real
  native login/2FA/session acceptance before merge. Keep it out of 1.3.4.
- **CrispASR:** optional, disabled in standard packages; the lockfile still pins
  0.8.6. Upstream is at 0.8.53. A separate bounded integration task must qualify
  Rust/C-ABI compatibility, model loading, actual STT/TTS/translation output,
  offline behavior and the selected GPU backend before changing the pin or
  enabling it in a distributed app.
- **Windows:** signing remains preferred. Existing release tooling supports an
  explicit owner-authorized unsigned override; artifacts/notes must say so.
  Android has its own retained signing identity and is unaffected by Windows.
- **Google Play:** signed APK/AAB creation works. Publisher access and a Play
  upload are separate; do not imply a store publication from package signatures.
- Team collaboration, Nostr, additional column types and speculative performance
  work are deferred until a concrete user need or measurement justifies them.

## Maintenance rules

Use source and exact-run evidence before updating status. Add tests for actual
behavior changes, keep completed work out of the active backlog, and preserve
provider limitations and pending device/account checks in user-facing claims.
