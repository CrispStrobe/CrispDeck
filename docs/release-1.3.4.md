# 1.3.4 release checklist

The release includes compact mobile layouts, account-name search and cached
search return, Deck reading positions, Wallabag feedback and account-scoped
moderation. Instagram and optional CrispASR upgrades are excluded.

## Evidence and boundaries

- Baseline main `cfef599` passed required CI and the 12 November live API run.
  The release commit must pass its own required CI and coordinated package
  verification; earlier runs do not replace those gates.
- Native tests cover signed-package identity, startup, synthetic callback
  routing, installer behavior, and simulator/emulator layout. Browser tests
  use intercepted provider boundaries.
- Real provider sign-in/posting and physical Mac/Android checks need dedicated
  account/device access. The full [validation matrix](validation.md) remains
  pending until actual results are recorded. Do not report a mock as live OAuth.

## Focused account/device session

Use dedicated accounts and privately retained credentials. For both Mac and
Android, record app version/build, OS/device and outcome for these cases:

1. Connect Mastodon and Bluesky with OAuth; quit/force-stop completely and
   reopen. Verify the same identities remain usable and errors offer reconnection.
2. Add two accounts on one network. Read, reply, like and undo from scoped deck
   columns; verify the intended remote identity performed each action.
3. Save a media draft with alt text, restart, restore and crosspost a long thread.
   Verify text, attachments, reply context and per-network limits.
4. Interrupt delivery after one destination. Reconnect and retry only unfinished
   work; verify no duplicate completed posts. An uncertain write must require
   explicit review instead of automatic duplication.
5. Schedule a disposable post, navigate away, sleep/offline and resume with the
   app open. Verify once-only delivery and clear overdue state.
6. Scroll feeds/deck/search, open a post/profile and return. Verify cached content,
   source filters and reading position. Search a multiword account name.
7. On Android, show/hide the keyboard, rotate, switch dark/light/OLED and inspect
   media, condensed text and bottom controls. Verify safe areas after restart.

Retain only sanitized results and disposable post IDs privately; remove test
posts afterward. Missing access is a pending outcome, not a successful test.

## Publication

1. Merge release preparation after required CI. Tag that exact source as
   `v1.3.4`, then use the coordinator on the tag. If the owner authorized
   unsigned Windows packages, pass `publish=true` and
   `allow_unsigned_windows=true` explicitly; preserve every other verification
   gate and the unsigned notice in release notes.
2. Verify all six receipts, Android emulator evidence, package identities and
   checksum inventory. Keep final assets immutable. Confirm the final title
   says `CrispDeck v1.3.4`, without the temporary assembly suffix.
3. Use the existing Mac App Store workflow for its separately signed sandboxed
   package. Read back the final entitlements and Apple's build processing state.
4. Assign the exact valid Mac/iOS build IDs to TestFlight with versioned notes.
   Read back group assignments and beta review state. A submitted beta is not
   an approved external beta.
5. Apple currently lists **iOS and macOS 1.3.2 WAITING_FOR_REVIEW** (12 November).
   Preserve those submissions while uploading/distributing newer builds.
   Do not cancel an active review simply to align version labels. After the
   current review resolves, prepare the next editable App Store version and
   attach its exact matching binary before submission.
6. Android APK/AAB signatures do not establish Google Play publication. Use the
   existing Play workflow only when publisher credentials are available.

## Operational follow-up

Follow [security operations](security-operations.md) for historical push data and
older backups. Keep pending account/device and storage checks visible in the
handoff even if automated package publication succeeds.
