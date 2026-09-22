#!/usr/bin/env python3
"""
Put an uploaded build in front of TestFlight testers, internal or external.

mobile.yml and macos-appstore.yml build, sign and upload. That is where they
stop, and an uploaded build reaches nobody on its own.

  internal — export compliance answered, build added to an internal group.
             No Apple review; live within minutes. Testers must already be
             App Store Connect team members.

  external — all of the above, plus a beta app description in the app's
             PRIMARY locale, the review contact, "what to test" for the
             build, an external group, and a pass through Beta App Review.

The ordering is not arbitrary. `POST /betaAppReviewSubmissions` 422s with
"betaAppLocalizations not found for this app" if the description is missing,
and the message names a resource rather than the step you skipped.

Every step reads before it writes, so a re-run after a partial failure
continues instead of duplicating. Re-POSTing a locale 409s, which is treated
as "already there, patch it" rather than an error.

Values that are not secret live in scripts/testflight.json. The review
contact's email and phone come from secrets: this repository is public.
"""
from __future__ import annotations

import base64
import binascii
import json
import os
import sys
import time
from pathlib import Path

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils

API = "https://api.appstoreconnect.apple.com/v1"
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() != "false"
CONFIG = json.loads((Path(__file__).parent / "testflight.json").read_text(encoding="utf-8"))

MISSING: list[str] = []


def fail(message: str) -> None:
    print(f"::error::{message}")
    sys.exit(1)


def env(name: str, *, required: bool = True) -> str:
    """
    On a real run a missing secret is fatal. On a dry run it is collected and
    reported at the end, because the point of a dry run is to learn everything
    that is not ready — stopping at the first gap means one run per gap.
    """
    value = os.environ.get(name, "").strip()
    if required and not value:
        if DRY_RUN:
            if name not in MISSING:
                MISSING.append(name)
            return f"<{name} not set>"
        fail(f"{name} is not set")
    return value


def load_key() -> object:
    """
    The .p8 is stored raw in this repo's secrets and base64 in some others on
    the same Apple account — appstore.md's table says base64, the workflows say
    raw, and they cannot both be right for every repo. Accept either rather
    than make the caller be sure.
    """
    raw = os.environ.get("APPLE_API_KEY_P8", "").strip()
    if not raw:
        fail("APPLE_API_KEY_P8 is not set — nothing can be read without it")
    if "BEGIN PRIVATE KEY" not in raw:
        try:
            decoded = base64.b64decode(raw, validate=True).decode("utf-8", "replace")
        except (binascii.Error, ValueError):
            fail("APPLE_API_KEY_P8 is neither a PEM private key nor valid base64")
        if "BEGIN PRIVATE KEY" not in decoded:
            fail("APPLE_API_KEY_P8 decoded from base64 but is still not a PEM private key")
        print("  (key was base64-encoded)")
        raw = decoded
    return serialization.load_pem_private_key(raw.encode(), password=None)


def token() -> str:
    """A 20-minute ES256 JWT with a raw r||s signature. Apple rejects DER."""
    key = load_key()
    key_id = os.environ.get("APPLE_API_KEY_ID", "").strip()
    issuer = os.environ.get("APPLE_API_ISSUER_ID", "").strip()
    if not key_id or not issuer:
        fail("APPLE_API_KEY_ID and APPLE_API_ISSUER_ID are both required")

    def b64(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    now = int(time.time())
    header = {"alg": "ES256", "kid": key_id, "typ": "JWT"}
    payload = {"iss": issuer, "iat": now, "exp": now + 1190, "aud": "appstoreconnect-v1"}
    signing_input = (
        f"{b64(json.dumps(header, separators=(',', ':')).encode())}."
        f"{b64(json.dumps(payload, separators=(',', ':')).encode())}"
    )
    r, s = utils.decode_dss_signature(key.sign(signing_input.encode(), ec.ECDSA(hashes.SHA256())))
    return f"{signing_input}.{b64(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"


JWT = token()
HEADERS = {"Authorization": f"Bearer {JWT}", "Content-Type": "application/json"}


def request(method: str, path: str, body: dict | None = None, *, allow: tuple[int, ...] = ()):
    """Apple's errors say what is wrong; surface them rather than a status code."""
    url = path if path.startswith("http") else f"{API}/{path}"
    resp = requests.request(method, url, headers=HEADERS, json=body, timeout=60)
    if resp.status_code in allow:
        return None
    if resp.status_code >= 400:
        try:
            detail = "; ".join(
                f"{e.get('title')}: {e.get('detail')}" for e in resp.json().get("errors", [])
            )
        except ValueError:
            detail = resp.text[:400]
        fail(f"{method} {path} -> {resp.status_code}: {detail}")
    return resp.json() if resp.text else {}


def get(path: str):
    return request("GET", path)


def write(method: str, path: str, body: dict, *, allow: tuple[int, ...] = ()):
    if DRY_RUN:
        print(f"    [dry run] {method} {path}")
        return None
    return request(method, path, body, allow=allow)


APP_ID = os.environ.get("APP_ID", "").strip() or CONFIG["appId"]
PLATFORM = os.environ.get("PLATFORM", "IOS").strip() or "IOS"
MODE = os.environ.get("MODE", "both").strip().lower()
WANT_INTERNAL = MODE in ("internal", "both")
WANT_EXTERNAL = MODE in ("external", "both")

print(f"CrispDeck — app {APP_ID}, platform {PLATFORM}, mode {MODE}"
      f"{'   [DRY RUN]' if DRY_RUN else ''}\n")

# ── The app, for its primary locale ─────────────────────────────────────────
# External review wants the beta description in the app's PRIMARY locale.
# An en-US-only description 422s the submission on a German-first app, and
# the error names betaAppLocalizations rather than the locale.
app = get(f"apps/{APP_ID}")["data"]
primary_locale = app["attributes"].get("primaryLocale") or "en-US"
print(f"Primary locale: {primary_locale}")

# ── The build ───────────────────────────────────────────────────────────────
build_id = os.environ.get("BUILD_ID", "").strip()
if build_id:
    build = get(f"builds/{build_id}")["data"]
else:
    found = get(
        f"builds?filter%5Bapp%5D={APP_ID}"
        f"&filter%5BpreReleaseVersion.platform%5D={PLATFORM}"
        "&sort=-uploadedDate&limit=20"
    )["data"]
    ready = [b for b in found if b["attributes"].get("processingState") == "VALID"
             and not b["attributes"].get("expired")]
    if not ready:
        seen = ", ".join(
            f"{b['attributes'].get('version')}="
            f"{b['attributes'].get('processingState')}"
            f"{'/expired' if b['attributes'].get('expired') else ''}"
            for b in found
        ) or "none at all"
        fail(
            "no usable build for this platform. Apple takes 15-60 minutes to "
            f"process an upload, and builds expire after 90 days. Seen: {seen}"
        )
    build = ready[0]
    build_id = build["id"]

attrs = build["attributes"]
print(f"Build {attrs.get('version')} ({build_id})")
print(f"  uploaded:   {attrs.get('uploadedDate')}")
print(f"  processing: {attrs.get('processingState')}")
print(f"  expired:    {attrs.get('expired')}")

# ── Export compliance ───────────────────────────────────────────────────────
# Until this is answered TestFlight offers the build to nobody, internal or
# external, and gives no reason.
compliance = attrs.get("usesNonExemptEncryption")
print(f"  encryption: {compliance}")
if compliance is None:
    print("  answering export compliance (Info.plist declares it exempt)")
    write("PATCH", f"builds/{build_id}",
          {"data": {"type": "builds", "id": build_id,
                    "attributes": {"usesNonExemptEncryption": False}}})
else:
    print("  export compliance already answered")


def ensure_group(name: str, internal: bool) -> str:
    """Find the group by name, or create it. Never converts one to the other."""
    groups = get(f"betaGroups?filter%5Bapp%5D={APP_ID}&limit=200")["data"]
    existing = next((g for g in groups if g["attributes"].get("name") == name), None)
    if existing:
        is_internal = existing["attributes"].get("isInternalGroup")
        if is_internal != internal:
            fail(
                f"group {name!r} exists but isInternalGroup={is_internal}, and this "
                f"run wants {internal}. Groups cannot be converted — pick another name."
            )
        print(f"  group {name!r} exists ({existing['id']})")
        return existing["id"]

    attributes = {"name": name, "isInternalGroup": internal}
    if not internal:
        # A public join link costs nothing to ask for at creation time and is
        # the difference between mailing invitations and sharing one URL.
        attributes["publicLinkEnabled"] = True
    created = write("POST", "betaGroups",
                    {"data": {"type": "betaGroups", "attributes": attributes,
                              "relationships": {"app": {"data": {"type": "apps", "id": APP_ID}}}}})
    if created:
        print(f"  group {name!r} created ({created['data']['id']})")
        return created["data"]["id"]
    print(f"  group {name!r} would be created")
    return "<new group>"


def assign_build(group_id: str) -> None:
    write("POST", f"betaGroups/{group_id}/relationships/builds",
          {"data": [{"type": "builds", "id": build_id}]})


def invite(group_id: str, emails: list[str]) -> None:
    for email in emails:
        print(f"    {email}")
        # A tester resource need not exist first; creating it with the group
        # relationship inline works. Already-a-member is a 409, not a problem.
        write("POST", "betaTesters",
              {"data": {"type": "betaTesters", "attributes": {"email": email},
                        "relationships": {"betaGroups": {
                            "data": [{"type": "betaGroups", "id": group_id}]}}}},
              allow=(409,))


# ── Internal ────────────────────────────────────────────────────────────────
if WANT_INTERNAL:
    print("\nInternal testing — no Apple review, live within minutes")
    internal_id = CONFIG.get("internalGroupId") or ensure_group(
        CONFIG["internalGroupName"], internal=True)
    print(f"  group {internal_id}")
    assign_build(internal_id)
    emails = [e.strip() for e in os.environ.get("INTERNAL_TESTERS", "").split(",") if e.strip()]
    if emails:
        print("  inviting (must already be App Store Connect team members):")
        invite(internal_id, emails)
    else:
        print("  no INTERNAL_TESTERS given — leaving membership alone")

# ── External ────────────────────────────────────────────────────────────────
if WANT_EXTERNAL:
    print("\nExternal testing — needs Beta App Review")

    # 1. Beta app description, in the primary locale. Required before the
    #    submission will be accepted at all.
    locales = [primary_locale] + (["en-US"] if primary_locale != "en-US" else [])
    existing_locales = {
        l["attributes"]["locale"]: l["id"]
        for l in get(f"apps/{APP_ID}/betaAppLocalizations")["data"]
    }
    body_attrs = {
        "description": CONFIG["betaAppDescription"],
        "feedbackEmail": env("BETA_REVIEW_EMAIL"),
        "privacyPolicyUrl": CONFIG["privacyPolicyUrl"],
        "marketingUrl": CONFIG["marketingUrl"],
    }
    for locale in locales:
        print(f"  beta app description [{locale}]")
        if locale in existing_locales:
            write("PATCH", f"betaAppLocalizations/{existing_locales[locale]}",
                  {"data": {"type": "betaAppLocalizations",
                            "id": existing_locales[locale], "attributes": body_attrs}})
        else:
            write("POST", "betaAppLocalizations",
                  {"data": {"type": "betaAppLocalizations",
                            "attributes": {"locale": locale, **body_attrs},
                            "relationships": {"app": {"data": {"type": "apps", "id": APP_ID}}}}},
                  allow=(409,))

    # 2. Review contact. The resource exists per app with id == app id, so this
    #    is always a PATCH, and it starts empty for every app — a phone number
    #    on file for another app does not carry over.
    print("  review contact")
    write("PATCH", f"betaAppReviewDetails/{APP_ID}",
          {"data": {"type": "betaAppReviewDetails", "id": APP_ID, "attributes": {
              "contactFirstName": CONFIG["contactFirstName"],
              "contactLastName": CONFIG["contactLastName"],
              "contactPhone": env("BETA_REVIEW_PHONE"),
              "contactEmail": env("BETA_REVIEW_EMAIL"),
              "demoAccountRequired": CONFIG["demoAccountRequired"],
              "notes": CONFIG["reviewNotes"],
          }}})

    # 3. What to test, per build.
    whats_new = os.environ.get("WHATS_NEW", "").strip()
    if whats_new:
        print("  what to test")
        mine = next(
            (l for l in get(f"builds/{build_id}/betaBuildLocalizations")["data"]
             if l["attributes"].get("locale") == "en-US"), None)
        if mine:
            write("PATCH", f"betaBuildLocalizations/{mine['id']}",
                  {"data": {"type": "betaBuildLocalizations", "id": mine["id"],
                            "attributes": {"whatsNew": whats_new}}})
        else:
            write("POST", "betaBuildLocalizations",
                  {"data": {"type": "betaBuildLocalizations",
                            "attributes": {"locale": "en-US", "whatsNew": whats_new},
                            "relationships": {"build": {
                                "data": {"type": "builds", "id": build_id}}}}})

    # 4. Group, build, testers.
    external_id = ensure_group(CONFIG["externalGroupName"], internal=False)
    assign_build(external_id)
    emails = [e.strip() for e in os.environ.get("EXTERNAL_TESTERS", "").split(",") if e.strip()]
    if emails:
        print("  inviting:")
        invite(external_id, emails)
    else:
        print("  no EXTERNAL_TESTERS given — the public link covers anyone with it")

    # 5. Submit. Last, because it is refused until everything above exists.
    print("  submitting for Beta App Review")
    if DRY_RUN:
        print("    [dry run] POST betaAppReviewSubmissions")
    else:
        already = get(f"builds/{build_id}/betaAppReviewSubmission")
        state = (already.get("data") or {}).get("attributes", {}).get("betaReviewState")
        if state:
            print(f"    already submitted, state: {state}")
        else:
            created = request("POST", "betaAppReviewSubmissions",
                              {"data": {"type": "betaAppReviewSubmissions",
                                        "relationships": {"build": {
                                            "data": {"type": "builds", "id": build_id}}}}})
            new_state = created["data"]["attributes"].get("betaReviewState")
            print(f"    submitted — state {new_state}; Apple is usually same-day")

    if not DRY_RUN:
        group = get(f"betaGroups/{external_id}")["data"]["attributes"]
        if group.get("publicLink"):
            print(f"\n  public join link: {group['publicLink']}")

# ── Read back what is actually true ─────────────────────────────────────────
# Writes returning 2xx is not the same as the build being installable. Ask.
if not DRY_RUN:
    print("\n" + "=" * 62)
    print("State after this run, read back from Apple")
    print("=" * 62)

    groups = get(f"builds/{build_id}/betaGroups")["data"]
    if groups:
        for g in groups:
            a = g["attributes"]
            kind = "internal" if a.get("isInternalGroup") else "external"
            print(f"  in group {a.get('name')!r} ({kind})")
            if a.get("publicLink"):
                print(f"    public link: {a['publicLink']}")
    else:
        print("  ::warning:: the build is in NO group — nobody can install it")

    submission = (get(f"builds/{build_id}/betaAppReviewSubmission").get("data") or {})
    state = submission.get("attributes", {}).get("betaReviewState")
    print(f"  beta review state: {state or 'not submitted'}")
    if state == "APPROVED":
        print("    external testers can install")
    elif state == "WAITING_FOR_REVIEW":
        print("    waiting on Apple — usually same-day")
    elif state in ("REJECTED", "INVALID"):
        print(f"    ::warning:: review said {state}; external installs are blocked")

    testers = get(f"builds/{build_id}/individualTesters")
    print(f"  individually assigned testers: {len(testers.get('data', []))}")

# ── Report ──────────────────────────────────────────────────────────────────
if DRY_RUN:
    print("\n" + "-" * 62)
    if MISSING:
        print("NOT READY — these secrets are unset:\n")
        for name in MISSING:
            print(f"  {name}")
        print("\nSet them with `gh secret set <NAME>`, then run again.")
    else:
        print("Ready. Re-run with dry_run unchecked to do it for real.")
    print("-" * 62)
    print("\nDry run complete — nothing was changed.")
else:
    print("\nDone.")
