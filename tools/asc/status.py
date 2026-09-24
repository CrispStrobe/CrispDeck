#!/usr/bin/env python3
"""Read-only report of what App Store Connect actually holds for this app.

Nothing here writes. It exists because "prep the listing" and "is this
submittable" were being answered by reading the scripts that push metadata
rather than by asking Apple what is stored — and those are different questions.
Today already produced one case of that gap: a build number that looked right
in a log and was wrong in the binary.

It reports, per platform: the App Store version and its state, the build
attached to it, whether each localisation has screenshots, and what Apple is
still missing before the version could be submitted.

    python3 tools/asc/status.py
    python3 tools/asc/status.py --platform ios
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import client  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent
META = json.loads((HERE / "metadata.json").read_text())
PLATFORM = {"ios": "IOS", "macos": "MAC_OS"}

# States in which a version is still being prepared rather than shipped.
EDITABLE = {
    "PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED",
    "METADATA_REJECTED", "INVALID_BINARY", "DEVELOPER_REMOVED_FROM_SALE",
}


def get(path: str):
    """A read that reports rather than raises: a missing relationship is an
    answer, and half a report beats an exception."""
    status, doc = client.call("GET", path)
    if status >= 400:
        detail = "; ".join(
            f"{e.get('code', '')}" for e in doc.get("errors", [])
        ) or str(status)
        print(f"     (could not read {path.split('?')[0]}: {detail})")
        return None
    return doc


def paged(path: str) -> list:
    doc = get(path)
    return doc.get("data", []) if doc else []


def one(path: str):
    doc = get(path)
    return (doc or {}).get("data")


def versions_for(app: str, platform: str) -> list:
    """
    Every App Store version for one platform, filtered here rather than by
    Apple.

    `filter[platform]` on this collection answers PARAMETER_ERROR.ILLEGAL.
    testflight.py already carries the same lesson for builds — Apple's
    platform filters are unreliable and the relationship is not — so ask for
    the collection and read the attribute.
    """
    out = [v for v in _all_versions(app)
           if v["attributes"].get("platform") == platform]
    out.sort(key=lambda v: v["attributes"].get("createdDate") or "", reverse=True)
    return out


def _all_versions(app: str) -> list:
    return paged(f"/v1/apps/{app}/appStoreVersions?limit=50")


def report_platform(app: str, name: str, platform: str) -> list[str]:
    """Returns the list of things blocking a submission on this platform."""
    blockers: list[str] = []
    print(f"\n── {name} ─────────────────────────────────────────")

    versions = versions_for(app, platform)
    if not versions:
        print("   no App Store version for this platform")
        blockers.append(f"{name}: no App Store version exists")
        return blockers

    version = versions[0]
    va = version["attributes"]
    state = va.get("appStoreState") or va.get("appVersionState")
    print(f"   version {va.get('versionString')}  state {state}")
    if state not in EDITABLE:
        print(f"   not editable in state {state} — a new version is needed to change anything")

    # The build. A version with no build attached cannot be submitted, and the
    # failure message names the version rather than the missing build.
    build = one(f"/v1/appStoreVersions/{version['id']}/build")
    if build:
        ba = build["attributes"]
        print(f"   build attached: {ba.get('version')} ({ba.get('processingState')})")
    else:
        print("   build attached: NONE")
        blockers.append(f"{name}: no build attached to the version")

    # Localisations and their screenshots. Apple requires at least one
    # screenshot set per localisation before a version may be submitted.
    locs = paged(f"/v1/appStoreVersions/{version['id']}/appStoreVersionLocalizations")
    for loc in locs:
        locale = loc["attributes"]["locale"]
        desc = (loc["attributes"].get("description") or "").strip()
        sets = paged(f"/v1/appStoreVersionLocalizations/{loc['id']}/appScreenshotSets")
        shots = 0
        kinds = []
        for s in sets:
            n = len(paged(f"/v1/appScreenshotSets/{s['id']}/appScreenshots"))
            shots += n
            kinds.append(f"{s['attributes'].get('screenshotDisplayType')}×{n}")
        print(f"   {locale}: description {len(desc)} chars, "
              f"{shots} screenshot(s){' — ' + ', '.join(kinds) if kinds else ''}")
        if not desc:
            blockers.append(f"{name}/{locale}: no description")
        if shots == 0:
            blockers.append(f"{name}/{locale}: no screenshots")
    if not locs:
        blockers.append(f"{name}: no version localisations")

    return blockers


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--platform", choices=sorted(PLATFORM), action="append",
                    help="limit to one platform (repeatable); default both")
    args = ap.parse_args()
    wanted = args.platform or sorted(PLATFORM)

    app = client.app_id(META["bundleId"])
    if not app:
        raise SystemExit(f"no App Store Connect record for {META['bundleId']}")
    print(f"app {META['app']['name']} ({META['bundleId']}) = {app}")

    info = get(f"/v1/apps/{app}")
    if info:
        print(f"   primary locale: {info['data']['attributes'].get('primaryLocale')}")

    blockers: list[str] = []

    # App-level things, shared by both platforms.
    print("\n── app level ─────────────────────────────────────")
    infos = paged(f"/v1/apps/{app}/appInfos")
    for ai in infos:
        st = ai["attributes"].get("appStoreState") or ai["attributes"].get("state")
        editable = st in EDITABLE
        print(f"   appInfo {ai['id'][:8]} state {st}{'  (editable)' if editable else ''}")
        if not editable:
            continue
        cats = ai.get("relationships", {})
        primary = (cats.get("primaryCategory", {}).get("data") or {}).get("id")
        print(f"     primary category: {primary or 'NOT SET'}")
        if not primary:
            blockers.append("no primary category")
        # The nutrition label cannot be read or written over the API at all;
        # say so rather than let its absence look like a clean report.
        age = one(f"/v1/appInfos/{ai['id']}/ageRatingDeclaration")
        print(f"     age rating declaration: {'present' if age else 'NOT SET'}")
        if not age:
            blockers.append("no age rating declaration")

    price = paged(f"/v1/apps/{app}/appPriceSchedule?limit=1")
    print(f"   price schedule: {'set' if price else 'NOT SET'}")
    if not price:
        blockers.append("no price schedule (even free needs one)")

    subs = paged(f"/v1/apps/{app}/reviewSubmissions?limit=5")
    if subs:
        for s in subs:
            sa = s["attributes"]
            items = paged(f"/v1/reviewSubmissions/{s['id']}/items")
            held = []
            for it in items:
                ver = (it.get("relationships", {}).get("appStoreVersion", {})
                       .get("data") or {}).get("id")
                if ver:
                    v = one(f"/v1/appStoreVersions/{ver}")
                    held.append((v or {}).get("attributes", {}).get("versionString", ver[:8]))
            print(f"   review submission {s['id'][:8]}: {sa.get('state')} "
                  f"({sa.get('platform')})"
                  f"{'  holding ' + ', '.join(held) if held else '  no items'}")
            # A submission left open holds the version and blocks a new one.
            if sa.get("state") in ("READY_FOR_REVIEW", "WAITING_FOR_REVIEW",
                                   "IN_REVIEW", "UNRESOLVED_ISSUES"):
                blockers.append(
                    "an open review submission holds this app — only one may be "
                    "open at a time, so the others must be completed or cancelled")
    else:
        print("   review submissions: none")

    for key in wanted:
        blockers += report_platform(app, key, PLATFORM[key])

    print("\n" + "=" * 54)
    if blockers:
        print("NOT SUBMITTABLE — outstanding:\n")
        seen = []
        for b in blockers:
            if b not in seen:
                seen.append(b)
        for b in seen:
            print(f"   - {b}")
    else:
        print("Nothing the API can see is missing.")
    print("""
Two things never appear above because Apple exposes neither over the API:
   - the App Privacy "nutrition label" (browser only, always)
   - whether a human has decided this should ship
""")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
