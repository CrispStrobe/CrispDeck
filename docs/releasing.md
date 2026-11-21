# Coordinated releases

`Coordinated Release` is the only workflow triggered by `v*` tags. Desktop,
mobile, notarized Mac and web workflows are reusable builders. They upload
packages and source receipts to the current workflow run; the coordinator stages
verified platform assets into an explicitly incomplete GitHub prerelease as each
platform finishes. Store upload and final publication remain coordinated.

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

All builders check out the preparation job's full commit SHA. Before any native
build fanout, preparation reuses a successful CI run for that exact commit or
an ancestor with an identical Git tree. Both the guard job and Required CI must
have passed. Missing/failed CI, another workflow, a different tree or an unmerged
commit cannot substitute. The coordinator retains this read-only CI receipt and
does not dispatch a duplicate app matrix. Every platform check must still pass
before store upload or final publication.
Android emulator validation starts as soon as its signed APK is ready,
independently of the iOS build. Both mobile packages remain required by the
final verification gate.
Native checks include:

- Linux DEB installation/upgrade, installed version, a visible native window,
  startup survival and an application-data marker.
- Windows MSI installation/upgrade, app/installer version and executable-byte
  checks, a visible native window, startup and publisher signatures/timestamps
  when configured. Tauri's signing callback runs after each format-specific
  executable patch and on the resulting installers. Per-format snapshots bind
  the installed MSI executable to its exact packaged bytes.
- Mac universal architecture, code signature, notarization/stapling, Gatekeeper,
  app replacement and native startup.
- Exported iOS identity/build number, permission descriptions, callback scheme,
  privacy manifest, strict signature verification and iPhone Simulator startup.
  Device archives remain unsigned until manual export with the retained
  Distribution identity and explicit App Store profile. The profile must match
  the app, team and imported certificate. Tauri's internal automatic-provisioning
  flags are removed by the local xcodebuild guard; CI never creates certificates.
- Android APK and final AAB signatures against the retained certificate,
  version, ZIP integrity, 16 KiB ZIP/ELF alignment and emulator installation,
  launch and restart of that exact APK. Emulator checks cycle the app's dark,
  OLED and light themes, verify the native system-bar appearance and retain
  screenshots, including a restart with the light theme saved.
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
git tag -a v1.3.4 -m 'CrispDeck v1.3.4'
git push origin v1.3.4
```

With Windows signing configured, the tag invokes the coordinator in publication
mode. Without it, automatic preparation is skipped; use the explicit manual
unsigned override below. Each platform
is checked against its source receipt and staged in a public prerelease when its
checks pass; Android also waits for its emulator check. The prerelease explicitly
says that assembly is incomplete. Once every platform passes, the verified IPA
is uploaded to Apple, all asset hashes are checked, and the prerelease becomes
the final/latest release. Published final assets are immutable.

Windows publisher signing is required by default. When the release owner has
explicitly authorized unsigned Windows installers, dispatch the workflow on the
version tag with `publish=true` and `allow_unsigned_windows=true`. This opt-in
still requires all platform and mobile smoke checks, and the final release notes
identify the Windows packages as unsigned. A tag push alone cannot enable it.
Preparation fails when versions disagree, the tag differs, a final release already
exists, or signing is unavailable without that explicit opt-in.

If publication is interrupted, rerun the failed job in the same workflow run.
It reuses the original verified artifacts, accepts identical staged assets and
refuses different ones. Published release assets are immutable to this tool.
Apple processing, TestFlight distribution/review and App Store approval are
separate; existing `testflight.yml` and App Store tooling remain available.
Google Play publication uses the separate internal-track workflow.

Heavy compilation and emulators run in GitHub Actions. Local checks are Python
release guards and workflow syntax; inspect load/memory before broader work.

## CI queue policy

Use one substantive PR for related release work. Do not add `ci:full` labels or
dispatch extra full CI runs for documentation or release-tool changes. The PR
and main-push workflow always runs release/security guards, then compares exact
event base/head commits. A conservative allowlist permits documentation, Python
release tools/metadata and the inventory helper to skip the app test/build matrix.
Runtime, dependency, native, unknown or missing-history changes require the full
matrix. Renames include deletions, so moving app code into docs cannot hide it.
The stable Required CI check requires the guards and exactly the expected matrix
results; missing scope, failures and unexpected skips fail it.

Coordinated releases reuse validated source CI and retain every native package
check. Mac signing, Windows installers and device simulators require their native
hosted platforms. Use Kaggle for separate compute-heavy model qualification;
do not introduce model work into this app release. Reuse existing applicable
runs, cancel superseded runs, and batch pushes to avoid restarting checks.

iOS builds use the committed opaque RGB icons in `src-tauri/icons/ios`.
When changing `static/icon-1024.png`, install Pillow in a development Python
environment and run `python3 scripts/generate-ios-icons.py`; commit the generated
icons and source hash. CI checks the hash and rejects alpha-bearing iOS PNGs
before building.

iOS builders require `IOS_DIST_P12`, `IOS_DIST_P12_PASSWORD`, `APPLE_TEAM_ID`
and `IOS_APPSTORE_PROFILE_BASE64` (base64 of the signed App Store provisioning
profile). The profile is installed in both Xcode profile directories. Manual
export selects the imported certificate's SHA-1 and verifies the exported IPA
uses that certificate. App Store Connect API credentials are used separately
by preparation and publication. The shared playbook documents the retained
profile and both existing Distribution identities; never enable automatic
provisioning to work around a missing profile or certificate.

Android CI copies `src-tauri/android/MainActivity.kt` into the generated project
to apply the native system-bar theme hook. After a fresh local `tauri android
init`, copy that file to
`src-tauri/gen/android/app/src/main/java/com/christianstrobele/crispdeck/MainActivity.kt`
before building. The generated platform directory is disposable; the source
activity remains outside it.

## Windows publisher identity

No Windows identity was configured when this workflow was introduced. An
unsigned build-only candidate can finish so installer behavior can be checked;
its evidence reports `publishable: false`. Publication requires either a
production identity or the explicit unsigned override described above; that
override still requires a complete verified package set.
Do not use a self-signed development certificate as a production substitute.

Choose one supported configuration:

| Mode | Repository configuration |
|---|---|
| PFX | Variable `WINDOWS_SIGNING_MODE=pfx`; secrets `WINDOWS_CERT_PFX_BASE64` and `WINDOWS_CERT_PASSWORD` for an existing valid code-signing identity |
| Azure Artifact Signing | Variable `WINDOWS_SIGNING_MODE=azure`; variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_CERTIFICATE_PROFILE`; configure GitHub OIDC trust and the certificate-profile signing role |

The Azure path uses `azure/login` OIDC and Microsoft's pinned `ArtifactSigning`
PowerShell module (0.1.8, the same version as the v2.0.0 signing action). The
callback uses the Azure CLI credential from that login. PFX signing uses the
same callback with the retained certificate, including NSIS uninstaller signing.
Unsigned build-only callbacks record hashes without claiming publisher signatures.
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

Tauri restores the unpatched build executable after packaging each format.
Do not sign only before `tauri bundle`, or compare the installed executable to
that restored file: NSIS/MSI bundle markers deliberately differ. The callback
records source-bound hashes after patching/signing. Smoke checks compare the
installed MSI app to its MSI snapshot and retain verbose installation logs.
Failed package candidates are retained for diagnosis and cannot be published.

To rerun Linux installation/startup against a retained candidate without native
compilation, dispatch Desktop Packages with `smoke_run_id` set to its Actions
run ID. The report records the original build separately from the validator
revision. This diagnostic mode neither creates release receipts nor publishes
anything; the complete coordinator still validates the final source commit.

Android Emulator Smoke also accepts a manual `package_run_id` to diagnose a
retained `package-android` artifact without compiling. The report records the
APK receipt's source and hash separately from the validator revision and is
marked diagnostic. Aggregation rejects diagnostic reports and validators from
another commit. Normal release checks keep one persistent UiAutomation session
connected across app restarts so WebView accessibility children remain available.
The emulator can show a Pixel Launcher ANR during cold boot. Only that exact
system dialog may be closed, with screenshots and incidents retained. CrispDeck
and other system ANRs fail the check; no general error-dialog dismissal is used.
