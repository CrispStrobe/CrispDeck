# Google Play internal testing

The signed APK/AAB and retained CrispDeck release identity already exist.
No Play Console access, publisher service-account credential or existing
authenticated Console session was available to the agent. No app record,
developer-account signup, policy declaration or Play release has been created.

## Local/CI verification

Run offline validation against the already published release:

```sh
gh workflow run google-play.yml --ref main -f tag=v1.3.0 -f action=preflight
```

This verifies APK/AAB against the published SHA256SUMS, checks both signing
identities against `ANDROID_RELEASE_CERT_SHA256`, checks package/version,
compares the native libraries and verifies 16 KiB ZIP/ELF alignment. It validates
draft listing field lengths and reports whether credentials are configured.
It makes no Google API calls and does not imply that Play access or the listing
has been approved.

Draft English listing copy is in [listing.json](../tools/play/listing.json).
The existing `static/icon-512.png` is reused as the store icon. Dispatch
`store-assets.yml` to render a 1024×500 feature graphic and ten screenshots at
phone/tablet sizes. The screenshots render the actual web UI using synthetic
provider fixtures; review them against Android behavior before uploading them
to Play. They are not physical-device validation. The workflow creates an
artifact and does not upload assets to any store.

## Account-owner setup

1. Sign in to the intended Play Console developer account. Create the app record
   for `com.christianstrobele.crispdeck` if it does not exist, preserving the
   retained signing identity when choosing Play App Signing configuration.
2. Review the listing copy, upload listing graphics/screenshots and complete
   app access, data safety, content rating, audience, advertising and other
   mandatory Console forms truthfully. Code/release checks cannot determine
   every policy/business answer. Configure an internal tester group.
3. Use a Google Cloud project with the Google Play Developer API enabled.
   Create a publisher service account and grant it app-specific access in
   Play Console, including release permissions for testing tracks. Avoid
   production-release access for this internal-testing workflow.
4. Store its JSON credential as GitHub secret
   `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` on this repository. Do not commit it,
   paste it into chat, or reuse an unrelated app's keystore. Long-term
   credentials should be rotated through the account owner's credential
   process; this tool does not create credentials or buy accounts.

Google no longer requires linking the Play developer account to a Cloud
project. See [Google's API setup](https://developers.google.com/android-publisher/getting_started)
and [internal testing](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en).
Complete any first-upload/app-setup step that Console requires before API use.

## Validate access and publish

```sh
gh workflow run google-play.yml --ref main -f tag=v1.3.0 -f action=check-access
gh workflow run google-play.yml --ref main -f tag=v1.3.0 -f action=publish-internal
```

The access check creates a temporary edit, reads the internal track and deletes
the edit. It does not upload a bundle or commit a release.

The publishing action uploads only the verified AAB, checks the version code
and SHA-256 returned by Google, updates only `internal`, validates the edit,
then commits. It refuses a rollback to an older internal version. On failure,
the uncommitted edit is discarded; validation errors never trigger a commit.
There is no production-track option. A committed internal release still waits
for any Google processing/review before testers can install it.

Listing copy remains a draft until the Console record and declarations are
reviewed by the account owner. App credentials/posts are primarily on-device;
optional Threads OAuth, push subscriptions, hosting logs and third-party
provider handling need to be considered when completing data safety. The tool
does not submit a blanket "no data collected" declaration on the owner's behalf.
