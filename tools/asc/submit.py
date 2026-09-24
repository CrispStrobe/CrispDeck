#!/usr/bin/env python3
"""Take an App Store version as far towards review as the API allows.

Age rating, price schedule, build attachment, then the review submission.
Everything is idempotent: it reads before it writes and skips what is already
right, so a re-run after a partial failure continues.

Two things it will never do, because Apple does not expose them:
  - the App Privacy "nutrition label" (browser only, always)
  - deciding that this should ship

The second is not a technical limit. It stops short of `submitted: true`
unless --really-submit is passed, because putting an app in front of App
Review is a decision with a cost when it is wrong.

    python3 tools/asc/submit.py                      # everything but submit
    python3 tools/asc/submit.py --really-submit      # and submit
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
# The version the repository is at. The App Store record's label had drifted
# three releases behind the binary attached to it.
APP_VERSION = json.loads(
    (HERE.parent.parent / "package.json").read_text())["version"]
PLATFORM = {"ios": "IOS", "macos": "MAC_OS"}
EDITABLE = {"PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED",
            "METADATA_REJECTED", "INVALID_BINARY"}


def show_errors(doc: dict, indent: str = "     ") -> None:
    for e in doc.get("errors", []):
        print(f"{indent}{e.get('code', '')}: {e.get('detail', '')}")


def age_rating(app: str) -> bool:
    """
    Apple validates the whole record at once and demands fields that read as
    already-null until you touch any of them, so send everything and let the
    409 name what is still wrong. appstore.md says this converges in 2-3 tries
    by hand; sending the complete set converges in one.
    """
    answers = {k: v for k, v in META["ageRating"].items() if not k.startswith("_")}
    for info in client.paged(f"/v1/apps/{app}/appInfos"):
        state = info["attributes"].get("appStoreState") or info["attributes"].get("state")
        if state not in EDITABLE:
            continue
        status, doc = client.call("GET", f"/v1/appInfos/{info['id']}/ageRatingDeclaration")
        decl = (doc or {}).get("data")
        if not decl:
            print("   age rating: no declaration on this appInfo")
            show_errors(doc)
            return False
        status, doc = client.call(
            "PATCH", f"/v1/ageRatingDeclarations/{decl['id']}",
            {"data": {"type": "ageRatingDeclarations", "id": decl["id"],
                      "attributes": answers}})
        if status in (200, 204):
            true_flags = [k for k, v in answers.items() if v is True]
            print(f"   age rating: set ({', '.join(true_flags) or 'nothing flagged'})")
            return True
        print(f"   age rating: HTTP {status}")
        show_errors(doc)
        return False
    print("   age rating: no editable appInfo")
    return False


def pricing(app: str) -> bool:
    # A to-one relationship. `?limit=1` answers PARAMETER_ERROR.ILLEGAL, and
    # client.paged turns that into SystemExit — so this aborted the whole run
    # before reaching anything else. Fixed in status.py and left here, which
    # is how a fix becomes half a fix.
    status, doc = client.call("GET", f"/v1/apps/{app}/appPriceSchedule")
    if status == 200 and (doc or {}).get("data"):
        print("   price: already scheduled")
        return True
    territory = META["pricing"]["baseTerritory"]
    points = client.paged(
        f"/v1/apps/{app}/appPricePoints?filter[territory]={territory}&limit=200")
    free = next((p for p in points
                 if str(p["attributes"].get("customerPrice")) in ("0", "0.0", "0.00")), None)
    if not free:
        print(f"   price: no $0.00 price point found for {territory}")
        return False
    # The inline resource id must literally be "${price1}" — an arbitrary
    # string 409s with INVALID_ID.
    status, doc = client.call("POST", "/v1/appPriceSchedules", {
        "data": {"type": "appPriceSchedules", "relationships": {
            "app": {"data": {"type": "apps", "id": app}},
            "baseTerritory": {"data": {"type": "territories", "id": territory}},
            "manualPrices": {"data": [{"type": "appPrices", "id": "${price1}"}]}}},
        "included": [{"type": "appPrices", "id": "${price1}",
                      "attributes": {"startDate": None},
                      "relationships": {"appPricePoint": {
                          "data": {"type": "appPricePoints", "id": free["id"]}}}}]})
    if status in (200, 201):
        print(f"   price: free schedule created ({territory} base)")
        return True
    print(f"   price: HTTP {status}")
    show_errors(doc)
    return False


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
    return client.paged(f"/v1/apps/{app}/appStoreVersions?limit=50")


def cancel_open(app: str, platform: str) -> bool:
    """
    Cancel every open review submission for a platform.

    Only one may be open at a time, so a stale one blocks the next — and
    appstore.md records that a cancelled submission can itself leave a stale
    record behind, which is the likeliest explanation for the three empty
    READY_FOR_REVIEW submissions already on this app.

    Cancelling a submission that is WAITING_FOR_REVIEW pulls the version out
    of Apple's queue and back to an editable state. That is the point: the
    version in review is labelled 1.2.6 and carries a build we have since
    replaced.
    """
    open_states = ("READY_FOR_REVIEW", "WAITING_FOR_REVIEW", "UNRESOLVED_ISSUES",
                   "IN_REVIEW")
    ok = True
    found = False
    for sub in client.paged(f"/v1/apps/{app}/reviewSubmissions?limit=50"):
        if sub["attributes"].get("platform") != platform:
            continue
        state = sub["attributes"].get("state")
        if state not in open_states:
            continue
        found = True
        status, doc = client.call(
            "PATCH", f"/v1/reviewSubmissions/{sub['id']}",
            {"data": {"type": "reviewSubmissions", "id": sub["id"],
                      "attributes": {"canceled": True}}})
        if status in (200, 204):
            print(f"   cancelled {sub['id'][:8]} (was {state})")
        else:
            ok = False
            print(f"   {sub['id'][:8]} (was {state}): HTTP {status}")
            show_errors(doc)
    if not found:
        print("   no open review submissions for this platform")
    return ok


def sync_version_string(version: dict, target: str) -> bool:
    """
    The version record's label, which is not the binary's.

    They had drifted: the record said 1.2.6 while the attached build was
    1.2.8. Apple compares CFBundleShortVersionString against this, so a
    record behind the binary is ITMS-90062 waiting to happen.
    """
    current = version["attributes"].get("versionString")
    if current == target:
        print(f"   version string: already {target}")
        return True
    status, doc = client.call(
        "PATCH", f"/v1/appStoreVersions/{version['id']}",
        {"data": {"type": "appStoreVersions", "id": version["id"],
                  "attributes": {"versionString": target}}})
    if status in (200, 204):
        print(f"   version string: {current} -> {target}")
        return True
    print(f"   version string: HTTP {status} (wanted {target}, record says {current})")
    show_errors(doc)
    return False


def version_for(app: str, platform: str) -> dict | None:
    versions = versions_for(app, platform)
    return versions[0] if versions else None


def newest_build(app: str, platform: str) -> dict | None:
    builds = client.paged(
        f"/v1/builds?filter[app]={app}&sort=-uploadedDate&limit=50")
    ready = [b for b in builds
             if b["attributes"].get("processingState") == "VALID"
             and not b["attributes"].get("expired")
             and platform_of(b["id"]) == platform]
    ready.sort(key=lambda b: b["attributes"].get("uploadedDate") or "", reverse=True)
    return ready[0] if ready else None


def platform_of(build_id: str) -> str | None:
    """Walk the relationship; Apple's platform filter on builds is unreliable."""
    status, doc = client.call("GET", f"/v1/builds/{build_id}/preReleaseVersion")
    if status != 200 or not (doc or {}).get("data"):
        return None
    return doc["data"]["attributes"].get("platform")


def attach_build(version: dict, app: str, platform: str) -> bool:
    """
    Attach the newest build, replacing a stale one.

    This used to return success as soon as *any* build was attached, which is
    how a version labelled 1.2.9 kept shipping build 1.2.8: something was
    attached, so it looked done. "A build is attached" and "the right build is
    attached" are different questions, and only the second one matters.
    """
    newest = newest_build(app, platform)
    if not newest:
        print("   build: none VALID to attach")
        return False

    status, doc = client.call("GET", f"/v1/appStoreVersions/{version['id']}/build")
    current = (doc or {}).get("data")
    if current and current["id"] == newest["id"]:
        print(f"   build: {current['attributes'].get('version')} already attached "
              f"and is the newest")
        return True
    if current:
        print(f"   build: replacing {current['attributes'].get('version')} with "
              f"{newest['attributes'].get('version')}")

    status, doc = client.call(
        "PATCH", f"/v1/appStoreVersions/{version['id']}/relationships/build",
        {"data": {"type": "builds", "id": newest["id"]}})
    if status in (200, 204):
        print(f"   build: attached {newest['attributes'].get('version')}")
        return True
    print(f"   build: HTTP {status}")
    show_errors(doc)
    return False


def review_submission(app: str, version: dict, platform: str, really: bool) -> bool:
    """
    appStoreVersionSubmissions CREATE is deprecated and 403s. The current flow
    is three calls: create the submission, add the version as an item, then
    flip submitted.
    """
    # Reuse an open submission rather than create a second one — only one may
    # be open at a time. But "one exists" is not "one carries this version":
    # the three sitting on this app were READY_FOR_REVIEW with no items at
    # all, and returning success on finding one meant the version was never
    # added to anything.
    rs = None
    for sub in client.paged(f"/v1/apps/{app}/reviewSubmissions?limit=20"):
        if sub["attributes"].get("platform") != platform:
            continue
        if sub["attributes"].get("state") in ("READY_FOR_REVIEW",):
            rs = sub["id"]
            print(f"   review submission: reusing {rs[:8]} (READY_FOR_REVIEW)")
            break
        if sub["attributes"].get("state") in ("WAITING_FOR_REVIEW", "IN_REVIEW",
                                              "UNRESOLVED_ISSUES"):
            print(f"   review submission: {sub['id'][:8]} is already "
                  f"{sub['attributes'].get('state')} — nothing to do")
            return True

    if rs:
        for item in client.paged(f"/v1/reviewSubmissions/{rs}/items"):
            held = (item.get("relationships", {}).get("appStoreVersion", {})
                    .get("data") or {}).get("id")
            if held == version["id"]:
                print("   review submission: already carries this version")
                return _maybe_submit(rs, really)
        return _add_item_and_submit(rs, version, really)

    status, doc = client.call("POST", "/v1/reviewSubmissions", {
        "data": {"type": "reviewSubmissions", "attributes": {"platform": platform},
                 "relationships": {"app": {"data": {"type": "apps", "id": app}}}}})
    if status != 201:
        print(f"   review submission: HTTP {status}")
        show_errors(doc)
        return False
    rs = doc["data"]["id"]
    print(f"   review submission: created {rs[:8]}")
    return _add_item_and_submit(rs, version, really)


def _add_item_and_submit(rs: str, version: dict, really: bool) -> bool:
    status, doc = client.call("POST", "/v1/reviewSubmissionItems", {
        "data": {"type": "reviewSubmissionItems", "relationships": {
            "reviewSubmission": {"data": {"type": "reviewSubmissions", "id": rs}},
            "appStoreVersion": {"data": {"type": "appStoreVersions", "id": version["id"]}}}}})
    if status != 201:
        print(f"   review submission item: HTTP {status}")
        show_errors(doc)
        return False
    print("   review submission: version added as an item")
    return _maybe_submit(rs, really)


def _maybe_submit(rs: str, really: bool) -> bool:
    if not really:
        print("   review submission: NOT submitted — pass --really-submit for that.\n"
              "     Apple will also refuse until the App Privacy nutrition label\n"
              "     is answered, which is browser-only.")
        return True

    status, doc = client.call("PATCH", f"/v1/reviewSubmissions/{rs}", {
        "data": {"type": "reviewSubmissions", "id": rs,
                 "attributes": {"submitted": True}}})
    if status in (200, 204):
        print(f"   review submission: SUBMITTED, state "
              f"{doc.get('data', {}).get('attributes', {}).get('state')}")
        return True
    print(f"   review submission: HTTP {status} — this is where it stops")
    show_errors(doc)
    return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--platform", choices=sorted(PLATFORM), action="append")
    ap.add_argument("--really-submit", action="store_true",
                    help="flip submitted:true — puts the app in front of App Review")
    ap.add_argument("--cancel-open", action="store_true",
                    help="cancel open review submissions first, pulling a version "
                         "back out of Apple's queue so it can be corrected")
    args = ap.parse_args()
    wanted = args.platform or sorted(PLATFORM)

    app = client.app_id(META["bundleId"])
    if not app:
        raise SystemExit(f"no App Store Connect record for {META['bundleId']}")
    print(f"app {META['app']['name']} = {app}\n")

    ok = True

    # Cancelling comes first and alone. It was running after the app-level
    # steps, which fail *because* the app is in review — so the one operation
    # that would end that state was unreachable behind it. The age rating and
    # price also cannot be set while an appInfo is in review, so there is
    # nothing to do at app level until the cancel has landed.
    if args.cancel_open:
        for key in wanted:
            print(f"== cancelling open submissions: {key}")
            ok = cancel_open(app, PLATFORM[key]) and ok
            version = version_for(app, PLATFORM[key])
            if version:
                va = version["attributes"]
                print(f"   version {va.get('versionString')} is now "
                      f"{va.get('appStoreState') or va.get('appVersionState')}")
        print("\nCancelled. Re-run without --cancel-open to correct and resubmit.")
        return 0 if ok else 1

    print("== app level")
    ok = age_rating(app) and ok
    ok = pricing(app) and ok

    for key in wanted:
        platform = PLATFORM[key]
        print(f"\n== {key}")
        version = version_for(app, platform)
        if not version:
            print("   no App Store version for this platform")
            ok = False
            continue
        va = version["attributes"]
        state = va.get("appStoreState") or va.get("appVersionState")
        print(f"   version {va.get('versionString')}, state {state}")

        if state not in EDITABLE:
            print(f"   not editable in {state} — skipping the rest")
            ok = False
            continue

        ok = sync_version_string(version, APP_VERSION) and ok
        ok = attach_build(version, app, platform) and ok
        ok = review_submission(app, version, platform, args.really_submit) and ok

    print("\n" + "=" * 54)
    print("Still browser-only, whatever the above says:")
    print("   - the App Privacy nutrition label")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
