# Operational security follow-up

Checked 12 November 2026. This records operational evidence separately from
the merged [code audit](audit-2026-11-07.md). Prevention does not prove that
historical records, downloaded backups or shared diagnostic exports disappeared.

## Verified prevention

- Production `https://crispdeck.vercel.app/api/push/vapid-key` returned **501**
  with `configured: false`.
- Production `POST /api/push/subscribe` with an empty, credential-free object
  returned **501**, explicitly saying background push is unavailable.
- The handlers do not accept new subscription secrets. The disabled sender
  reports unavailable functionality; configuring VAPID does not implement it.
- Settings import/export filters provider credentials and encryption material;
  diagnostic output redacts secrets. These protections are covered by the
  merged audit tests, not a retrospective inspection of every user's files.

## Legacy Blob inventory — access pending

The local Vercel CLI has no authenticated session and no Blob token is supplied
to this process. A Vercel integration is available but not yet connected.
No production inventory or deletion has been performed. Zero records must not
be inferred from the disabled public endpoints or from missing local access.

With the correct project's existing Blob credential supplied privately as
`BLOB_READ_WRITE_TOKEN`, run:

```sh
node tools/security/legacy-storage.mjs
```

The helper lists only `push-subscriptions/`, handles pagination, and reports
object count, total bytes and upload-date bounds. It does not download bodies,
print object names/URLs/user identifiers, or change storage. Errors suppress
SDK response details. Its unit tests cover prefix isolation, pagination,
metadata validation and omission of private identifiers from output.

Inventory is only the first step. If records exist:

1. Inspect their schema and exposure privately in the production account. Do
   not paste subscription bodies, push endpoints, tokens or user IDs into
   repository files, issue comments or CI artifacts.
2. Determine whether subscription keys, provider credentials or other secrets
   were ever stored. Record affected categories and periods without values.
3. Coordinate revocation/re-subscription and any provider credential rotation
   with affected users. Do not rotate unrelated app signing identities.
4. Retain only minimal restricted incident evidence, then remove the confirmed
   obsolete records and verify the same prefix is empty. Inventory elsewhere
   and any public caches/backups separately; deletion from origin is not proof
   that every historical copy vanished.

Bulk deletion is intentionally absent from the helper: a reviewed inventory
and recovery assessment must precede an irreversible change.

## Backups, logs and privacy declarations — review pending

The earlier export/log defects may affect files created before the fixes.
Shared copies cannot be identified from current source code. The operator must
identify any old support attachments, settings exports and their recipients
using private records, remove shared access where appropriate, and rotate
confirmed exposed credentials. Do not replace device encryption seeds: that
can make existing credentials unreadable.

The optional Threads OAuth proxy processes tokens server-side. Check the live
App Privacy declaration against the actual collection/retention behavior;
on-device storage alone does not establish a blanket no-data declaration.
The App Store privacy form and reviewer correspondence require authenticated
account access. This task has not changed either declaration or conversation.

## Completion evidence

Record production project/store identity privately, inventory timestamp and
counts, assessed exposure categories, cleanup/revocation decisions and a second
inventory. Keep this section pending until that evidence exists. Public code
and endpoint checks alone do not close the historical-data follow-up.
