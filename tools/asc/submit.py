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
    if client.paged(f"/v1/apps/{app}/appPriceSchedule?limit=1"):
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


def version_for(app: str, platform: str) -> dict | None:
    versions = client.paged(
        f"/v1/apps/{app}/appStoreVersions?filter[platform]={platform}"
        "&limit=5&sort=-createdDate")
    return versions[0] if versions else None


def attach_build(version: dict, platform: str) -> bool:
    status, doc = client.call("GET", f"/v1/appStoreVersions/{version['id']}/build")
    if (doc or {}).get("data"):
        print(f"   build: already attached ({doc['data']['attributes'].get('version')})")
        return True
    builds = client.paged(
        f"/v1/builds?filter[app]={version['relationships']['app']['data']['id']}"
        f"&filter[preReleaseVersion.platform]={platform}&sort=-uploadedDate&limit=20")
    ready = [b for b in builds
             if b["attributes"].get("processingState") == "VALID"
             and not b["attributes"].get("expired")]
    if not ready:
        print("   build: none VALID to attach")
        return False
    status, doc = client.call(
        "PATCH", f"/v1/appStoreVersions/{version['id']}/relationships/build",
        {"data": {"type": "builds", "id": ready[0]["id"]}})
    if status in (200, 204):
        print(f"   build: attached {ready[0]['attributes'].get('version')}")
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
    for s in client.paged(f"/v1/apps/{app}/reviewSubmissions?limit=10"):
        if s["attributes"].get("platform") != platform:
            continue
        state = s["attributes"].get("state")
        if state in ("READY_FOR_REVIEW", "WAITING_FOR_REVIEW", "IN_REVIEW",
                     "UNRESOLVED_ISSUES"):
            print(f"   review submission: one already exists, state {state}")
            return True

    status, doc = client.call("POST", "/v1/reviewSubmissions", {
        "data": {"type": "reviewSubmissions", "attributes": {"platform": platform},
                 "relationships": {"app": {"data": {"type": "apps", "id": app}}}}})
    if status != 201:
        print(f"   review submission: HTTP {status}")
        show_errors(doc)
        return False
    rs = doc["data"]["id"]
    print(f"   review submission: created {rs[:8]}")

    status, doc = client.call("POST", "/v1/reviewSubmissionItems", {
        "data": {"type": "reviewSubmissionItems", "relationships": {
            "reviewSubmission": {"data": {"type": "reviewSubmissions", "id": rs}},
            "appStoreVersion": {"data": {"type": "appStoreVersions", "id": version["id"]}}}}})
    if status != 201:
        print(f"   review submission item: HTTP {status}")
        show_errors(doc)
        return False
    print("   review submission: version added as an item")

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
    args = ap.parse_args()
    wanted = args.platform or sorted(PLATFORM)

    app = client.app_id(META["bundleId"])
    if not app:
        raise SystemExit(f"no App Store Connect record for {META['bundleId']}")
    print(f"app {META['app']['name']} = {app}\n")

    print("== app level")
    ok = age_rating(app)
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
            print(f"   not editable in {state} — skipping")
            continue
        ok = attach_build(version, platform) and ok
        ok = review_submission(app, version, platform, args.really_submit) and ok

    print("\n" + "=" * 54)
    print("Still browser-only, whatever the above says:")
    print("   - the App Privacy nutrition label")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
