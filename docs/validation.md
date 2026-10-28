# Release validation

Automated CI and device/account validation are different evidence. Native
installer, simulator and emulator checks run in the coordinated release;
browser tests intercept provider boundaries. Neither is a live posting test.

Dedicated Mastodon/Bluesky/Threads accounts and physical iPhone/Android access
are currently unavailable to the agent (confirmed by the user). The matrix
below is pending until those resources are available. Do not change it to
passed based on mocked browser tests, an emulator screenshot or Apple upload
acceptance.

## Ready-to-run device/account session

Use dedicated accounts with content that can be deleted afterward. Keep tokens,
app passwords and account storage out of repository files, screenshots, traces
and exported reports. Use a local private credential store or GitHub secrets
for any later automated live-account job.

| Case | iPhone | Android | macOS | Windows | Linux | Web |
|---|---|---|---|---|---|---|
| Install/upgrade and first launch | Pending | Pending | Pending | Pending | Pending | Pending |
| Connect Mastodon; OAuth return completes | Pending | Pending | Pending | Pending | Pending | Pending |
| Connect Bluesky with supported native/web method | Pending | Pending | Pending | Pending | Pending | Pending |
| Connect Threads using configured OAuth service | Pending | Pending | Pending | Pending | Pending | Pending |
| Quit/reopen; accounts still authenticate | Pending | Pending | Pending | Pending | Pending | Pending |
| Image draft, alt text and per-network text survive restart | Pending | Pending | Pending | Pending | Pending | Pending |
| Real media crosspost and long Bluesky thread | Pending | Pending | Pending | Pending | Pending | Pending |
| Interrupt after one destination; retry does not duplicate completed work | Pending | Pending | Pending | Pending | Pending | Pending |
| Uncertain provider response requires explicit review | Pending | Pending | Pending | Pending | Pending | Pending |
| Schedule, change route and keep app open; publish once | Pending | Pending | Pending | Pending | Pending | Pending |
| Sleep/offline; resume and handle overdue work once | Pending | Pending | Pending | Pending | Pending | Pending |
| Mobile keyboard, rotation, safe areas and media permission denial | Pending | Pending | N/A | N/A | N/A | Pending |

Server-side evidence for the sign-in rows (2026-10-28, not a pass): bsky.social
accepts CrispDeck's web and native clients (`node scripts/probe-oauth-servers.mjs`),
and mastodon.social / fosstodon.org accept the app's redirect URI and scopes.
A macOS release build registers `app.vercel.crispdeck:`. A real account sign-in
is still required for each cell; open items O1–O6 in PLAN.md say how.

Record the exact release/commit, device model/OS, install source, account
provider/instance (no secrets), case result, expected/actual outcome and a
redacted debug-log reference. Record native restart tests on actual devices,
not a browser page reload. The on-device scheduler requires the app to remain
open; closing the app is not expected to publish in the background.

Delete test posts after recording their public IDs or links. Native Bluesky sign-in supports OAuth through the system browser or desktop
sign-in window, with App Password as an alternative. Real-account validation
of the new native OAuth flow is still pending.
Threads needs the separately configured OAuth service; a static ZIP alone does
not provide server endpoints.

## Automated scope

The `smoke-*` artifacts record native startup, screenshot and installer evidence
from hosted runners. Desktop upgrade checks select the latest older published
package that matches the platform. If no suitable older package exists, the
report explicitly records that no upgrade was exercised. A data marker checks
installer preservation of application data; it is not a real credential test.

Android emulator checks install the signed APK and force-stop/relaunch it.
iPhone Simulator checks build and launch the simulator app; production IPA
signature and metadata checks apply separately to the exported device archive.
All reports explicitly mark physical-device and authenticated workflows false.


## OAuth callback checks without accounts

The coordinator requires `deep_link_dispatch` for desktop and iPhone Simulator
receipts and for the Android emulator report. Both native callback URL forms
are exercised with a synthetic state and no authorization code. Windows and
Linux verify the OS handler points to the installed executable; desktop checks
require the original process, one instance and the plugin's fixed callback
message. Callback URLs and codes are never included in that message. macOS
also checks the bundled scheme. iPhone Simulator dispatches both URLs to the
running app; Android resolves both through the OS to the installed activity,
then checks the same foreground process remains. This establishes routing,
not a completed provider sign-in or credential persistence.

The headless Linux check uses GIO's default registered handler. The generic
`xdg-open` shell fallback on Ubuntu cannot parse the plugin's quoted Exec
field; desktop environments normally provide their own dispatcher. This test
does not establish external-browser integration for every window manager.

The final Android APK must contain `app.vercel.crispdeck`; the exported iOS
IPA must contain it after metadata application and signing. Existing legacy
registrations are retained for compatibility. Expired Bluesky sessions stay
read-only with a reconnect message; no automatic authorization is attempted.
