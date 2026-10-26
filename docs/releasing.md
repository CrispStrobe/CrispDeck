# Coordinated releases

`Coordinated Release` is the only workflow triggered by `v*` tags. Desktop,
mobile, notarized Mac and web workflows are reusable builders. They upload
packages and source receipts to the current workflow run; they do not create
GitHub releases or upload to Apple independently.

Run a complete candidate without publishing:

```sh
gh workflow run coordinated-release.yml --ref main -f publish=false
```

The preparation job checks package/Tauri/Cargo versions and obtains the next
unused iOS build number from Apple's build list. It counts expired builds and
filters both platform and marketing version. The coordinator serializes runs
to avoid two uploads choosing the same number. Build-only runs never upload builds
to App Store Connect, replace release assets or notify TestFlight testers.
Mac code notarization still sends the candidate DMG to Apple’s notary service.

All builders check out the preparation job's full commit SHA. Full CI runs
before compilation. Native checks then include:

- Linux DEB installation/upgrade, installed version, a visible native window,
  startup survival and an application-data marker.
- Windows MSI installation/upgrade, app/installer version and executable-byte
  checks, a visible native window, startup and publisher signatures/timestamps
  when configured. The executable is signed before bundling; installers are
  signed afterward.
- Mac universal architecture, code signature, notarization/stapling, Gatekeeper,
  app replacement and native startup.
- Exported iOS identity/build number, permission descriptions, callback scheme,
  privacy manifest, strict signature verification and iPhone Simulator startup.
- Android APK and final AAB signatures against the retained certificate,
  version, ZIP integrity, 16 KiB ZIP/ELF alignment and emulator installation,
  launch and restart of that exact APK.
- A complete static web ZIP; the same source passes browser workflows in CI.

The same candidate also renders the draft Google Play listing assets from its
source commit. Those assets remain a separate workflow artifact for owner review.

Platform receipts bind check results to source, version, size and SHA-256.
The aggregation job rejects missing platforms, changed packages, mixed source
commits, a mismatched Android emulator report or mobile identity, and unknown
files. It generates a combined evidence file and SHA256SUMS. Native screenshots
and logs are separate `smoke-*` workflow artifacts.

These checks do not establish successful authenticated posting or physical
device behavior. See [device validation](validation.md).

## Publish a new version

Update package.json/package-lock.json, Tauri config, Cargo.toml/Cargo.lock,
CHANGELOG and Apple beta notes. Merge after CI passes, then tag that commit:

```sh
git tag -a v1.3.1 -m 'CrispDeck v1.3.1'
git push origin v1.3.1
```

The tag automatically invokes the coordinator in publication mode. Publication
requires Windows publisher signing. Preparation fails before native builds if
signing is absent, versions disagree, the tag differs or the release is already
published. Once all platforms pass, the verified IPA is uploaded to Apple and
the exact verified package set is assembled into a draft GitHub release.
Uploaded hashes are checked before that draft becomes public/latest.

If publication is interrupted, rerun the failed job in the same workflow run.
It reuses the original verified artifacts, accepts identical draft assets and
refuses different ones. Published release assets are immutable to this tool.
Apple processing, TestFlight distribution/review and App Store approval are
separate; existing `testflight.yml` and App Store tooling remain available.
Google Play publication uses the separate internal-track workflow.

Heavy compilation and emulators run in GitHub Actions. Local checks are Python
release guards and workflow syntax; inspect load/memory before broader work.

## Windows publisher identity

No Windows identity was configured when this workflow was introduced. An
unsigned build-only candidate can finish so installer behavior can be checked;
its evidence reports `publishable: false`. It cannot be promoted to a release.
Do not use a self-signed development certificate as a production substitute.

Choose one supported configuration:

| Mode | Repository configuration |
|---|---|
| PFX | Variable `WINDOWS_SIGNING_MODE=pfx`; secrets `WINDOWS_CERT_PFX_BASE64` and `WINDOWS_CERT_PASSWORD` for an existing valid code-signing identity |
| Azure Artifact Signing | Variable `WINDOWS_SIGNING_MODE=azure`; variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_CERTIFICATE_PROFILE`; configure GitHub OIDC trust and the certificate-profile signing role |

The Azure path uses `azure/login` OIDC and Microsoft's Artifact Signing action.
It needs an already created signing account, completed identity validation and
a public-trust certificate profile. Creating an Azure subscription or buying a
certificate is not part of this workflow. Microsoft's current public-trust
eligibility permits EU organizations but limits individuals to the US/Canada;
an EU individual needs another eligible signing provider or identity setup.
See [Microsoft's setup requirements](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
and [signing integrations](https://learn.microsoft.com/en-us/azure/trusted-signing/how-to-signing-integrations).

Android's existing retained signing key and backups remain documented in the
shared `/mnt/volume1/appstore.md` playbook. This workflow does not mint, replace
or revoke signing identities.
