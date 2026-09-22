#!/usr/bin/env python3
"""
Put an uploaded build in front of external TestFlight testers.

Uploading a build (mobile.yml, macos-appstore.yml) gets it to *internal*
testers once processing finishes. External testers need four more things, none
of which existed in this repo:

  1. export compliance answered, or TestFlight offers the build to nobody
  2. the beta review contact, and demo credentials for an app you must sign
     into — CrispDeck is useless without a connected account, so a reviewer
     with no way in sees an empty shell and fails it
  3. an external group with the build assigned to it
  4. a Beta App Review submission

Ordering matters: the submission is refused unless 1-3 are already in place,
and the failure messages name a missing relationship rather than the thing you
forgot.

Every step is idempotent — it looks before it creates — so a re-run after a
partial failure continues rather than duplicating.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils

API = "https://api.appstoreconnect.apple.com/v1"
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() != "false"


def fail(message: str) -> None:
    print(f"::error::{message}")
    sys.exit(1)


MISSING: list[str] = []


def env(name: str, *, required: bool = True) -> str:
    """
    On a real run a missing secret is fatal. On a dry run it is collected and
    reported at the end instead, because the point of a dry run is to learn
    everything that is not ready — stopping at the first gap means three runs
    to discover three gaps.
    """
    value = os.environ.get(name, "").strip()
    if required and not value:
        if DRY_RUN:
            if name not in MISSING:
                MISSING.append(name)
            return f"<{name} not set>"
        fail(f"{name} is not set")
    return value


def fail_missing(name: str) -> str:
    fail(f"{name} is not set — nothing can be read without it")
    return ""  # unreachable; fail() exits


def token() -> str:
    """A 20-minute ES256 JWT. Apple refuses anything longer."""
    key_pem = os.environ.get("APPLE_API_KEY_P8", "").strip()
    if not key_pem:
        fail("APPLE_API_KEY_P8 is not set — nothing can be read without it")
    if "BEGIN PRIVATE KEY" not in key_pem:
        fail("APPLE_API_KEY_P8 is not a PEM private key — it is stored raw, not base64")
    key = serialization.load_pem_private_key(key_pem.encode(), password=None)

    def b64(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    now = int(time.time())
    header = {"alg": "ES256", "kid": env("APPLE_API_KEY_ID", required=False) or fail_missing("APPLE_API_KEY_ID"), "typ": "JWT"}
    payload = {
        "iss": env("APPLE_API_ISSUER_ID", required=False) or fail_missing("APPLE_API_ISSUER_ID"),
        "iat": now,
        "exp": now + 1190,
        "aud": "appstoreconnect-v1",
    }
    signing_input = (
        f"{b64(json.dumps(header, separators=(',', ':')).encode())}."
        f"{b64(json.dumps(payload, separators=(',', ':')).encode())}"
    )
    r, s = utils.decode_dss_signature(key.sign(signing_input.encode(), ec.ECDSA(hashes.SHA256())))
    return f"{signing_input}.{b64(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"


JWT = token()
HEADERS = {"Authorization": f"Bearer {JWT}", "Content-Type": "application/json"}


def call(method: str, path: str, body: dict | None = None, *, mutating: bool = True):
    """Apple's errors are informative; surface them rather than a status code."""
    if mutating and DRY_RUN:
        print(f"  [dry run] {method} {path}")
        if body:
            print(f"            {json.dumps(body)[:300]}")
        return None

    url = path if path.startswith("http") else f"{API}/{path}"
    resp = requests.request(method, url, headers=HEADERS, json=body, timeout=60)
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
    return call("GET", path, mutating=False)


APP_ID = env("APP_ID")
PLATFORM = os.environ.get("PLATFORM", "IOS").strip() or "IOS"

print(f"App {APP_ID}, platform {PLATFORM}{'  (DRY RUN)' if DRY_RUN else ''}\n")

# ── 1. The build ────────────────────────────────────────────────────────────
build_id = os.environ.get("BUILD_ID", "").strip()
if build_id:
    build = get(f"builds/{build_id}")["data"]
else:
    found = get(
        f"builds?filter%5Bapp%5D={APP_ID}"
        f"&filter%5BpreReleaseVersion.platform%5D={PLATFORM}"
        "&sort=-uploadedDate&limit=10"
    )["data"]
    ready = [b for b in found if b["attributes"].get("processingState") == "VALID"]
    if not ready:
        states = ", ".join(
            f"{b['attributes'].get('version')}={b['attributes'].get('processingState')}"
            for b in found
        ) or "none at all"
        fail(
            "no build in VALID state to distribute. Apple takes 15-60 minutes to "
            f"process an upload. Builds seen: {states}"
        )
    build = ready[0]
    build_id = build["id"]

attrs = build["attributes"]
print(f"Build {attrs.get('version')} ({build_id})")
print(f"  processing: {attrs.get('processingState')}")
print(f"  expired:    {attrs.get('expired')}")
if attrs.get("expired"):
    fail("that build has expired — upload a new one")

# ── 2. Export compliance ────────────────────────────────────────────────────
# Until this is answered TestFlight shows the build to nobody, internal or
# external, and says nothing about why.
compliance = attrs.get("usesNonExemptEncryption")
print(f"  encryption: {compliance}")
if compliance is None:
    print("\nAnswering export compliance (Info.plist declares ITSAppUsesNonExemptEncryption=false)")
    call(
        "PATCH",
        f"builds/{build_id}",
        {
            "data": {
                "type": "builds",
                "id": build_id,
                "attributes": {"usesNonExemptEncryption": False},
            }
        },
    )
else:
    print("  export compliance already answered")

# ── 3. Beta App Review details ──────────────────────────────────────────────
# The resource exists per app with id == app id, so this is always a PATCH.
#
# demoAccountRequired matters more here than it looks. CrispDeck shows nothing
# until an account is connected, so a reviewer without credentials opens an
# empty app. Supply them, or say in the notes how to get in.
demo_name = os.environ.get("DEMO_ACCOUNT_NAME", "").strip()
demo_pass = os.environ.get("DEMO_ACCOUNT_PASSWORD", "").strip()
notes = (
    "CrispDeck is a client for Mastodon, Bluesky and Threads. It shows nothing "
    "until an account is connected, so a reviewer needs credentials to see "
    "anything at all.\n\n"
)
notes += (
    "Demo account supplied above: open Settings, connect it as a Mastodon "
    "account using the instance and password given, and the feed, deck and "
    "compose screens populate.\n\n"
    if demo_name
    else "NO DEMO ACCOUNT SUPPLIED — set BETA_DEMO_ACCOUNT_NAME and "
    "BETA_DEMO_ACCOUNT_PASSWORD. Without them the reviewer sees an empty app "
    "and this is usually rejected.\n\n"
)
notes += (
    "All credentials are stored in the OS keychain; nothing is sent to our "
    "servers. The only first-party network calls are an optional Threads "
    "OAuth proxy and optional web-push relay."
)

print("\nBeta App Review contact")
if not demo_name:
    print("::warning::no demo account set — a reviewer will see an empty app")
call(
    "PATCH",
    f"betaAppReviewDetails/{APP_ID}",
    {
        "data": {
            "type": "betaAppReviewDetails",
            "id": APP_ID,
            "attributes": {
                "contactFirstName": env("REVIEW_CONTACT_FIRST"),
                "contactLastName": env("REVIEW_CONTACT_LAST"),
                "contactPhone": env("REVIEW_CONTACT_PHONE"),
                "contactEmail": env("REVIEW_CONTACT_EMAIL"),
                "demoAccountName": demo_name,
                "demoAccountPassword": demo_pass,
                "demoAccountRequired": bool(demo_name),
                "notes": notes,
            },
        }
    },
)

# ── 4. "What to test", per build ────────────────────────────────────────────
whats_new = env("WHATS_NEW")
existing = get(f"builds/{build_id}/betaBuildLocalizations")["data"]
mine = next((l for l in existing if l["attributes"].get("locale") == "en-US"), None)
print("\nWhat to test")
if mine:
    call(
        "PATCH",
        f"betaBuildLocalizations/{mine['id']}",
        {
            "data": {
                "type": "betaBuildLocalizations",
                "id": mine["id"],
                "attributes": {"whatsNew": whats_new},
            }
        },
    )
else:
    call(
        "POST",
        "betaBuildLocalizations",
        {
            "data": {
                "type": "betaBuildLocalizations",
                "attributes": {"locale": "en-US", "whatsNew": whats_new},
                "relationships": {"build": {"data": {"type": "builds", "id": build_id}}},
            }
        },
    )

# ── 5. The external group ───────────────────────────────────────────────────
group_name = os.environ.get("GROUP_NAME", "External Testers").strip()
groups = get(f"betaGroups?filter%5Bapp%5D={APP_ID}&limit=200")["data"]
group = next((g for g in groups if g["attributes"].get("name") == group_name), None)

print(f"\nGroup {group_name!r}")
if group:
    if group["attributes"].get("isInternalGroup"):
        fail(
            f"{group_name!r} is an INTERNAL group. Internal groups skip Beta App "
            "Review and only reach team members — pick another name."
        )
    group_id = group["id"]
    print(f"  exists ({group_id})")
else:
    created = call(
        "POST",
        "betaGroups",
        {
            "data": {
                "type": "betaGroups",
                "attributes": {"name": group_name, "isInternalGroup": False},
                "relationships": {"app": {"data": {"type": "apps", "id": APP_ID}}},
            }
        },
    )
    group_id = created["data"]["id"] if created else "<created on a real run>"
    print(f"  created ({group_id})")

# ── 6. Attach the build, then the testers ───────────────────────────────────
print("\nAssigning the build to the group")
call(
    "POST",
    f"betaGroups/{group_id}/relationships/builds",
    {"data": [{"type": "builds", "id": build_id}]},
)

emails = [e.strip() for e in os.environ.get("TESTERS", "").split(",") if e.strip()]
if emails:
    print(f"\nInviting {len(emails)} tester(s)")
    for email in emails:
        print(f"  {email}")
        call(
            "POST",
            "betaTesters",
            {
                "data": {
                    "type": "betaTesters",
                    "attributes": {"email": email},
                    "relationships": {
                        "betaGroups": {"data": [{"type": "betaGroups", "id": group_id}]}
                    },
                }
            },
        )
else:
    print("\nNo testers passed — leaving the group's membership alone")

# ── 7. Submit for Beta App Review ───────────────────────────────────────────
# Last, because it is refused until everything above is in place.
print("\nSubmitting for Beta App Review")
if not DRY_RUN:
    already = get(f"builds/{build_id}/betaAppReviewSubmission")
    state = (already.get("data") or {}).get("attributes", {}).get("betaReviewState")
    if state:
        print(f"  already submitted, state: {state}")
    else:
        call(
            "POST",
            "betaAppReviewSubmissions",
            {
                "data": {
                    "type": "betaAppReviewSubmissions",
                    "relationships": {"build": {"data": {"type": "builds", "id": build_id}}},
                }
            },
        )
        print("  submitted — Apple usually answers within a day")
else:
    print("  [dry run] POST betaAppReviewSubmissions")

if DRY_RUN:
    print("\n" + "-" * 60)
    if MISSING:
        print("NOT READY — these secrets are unset:\n")
        for name in MISSING:
            print(f"  {name}")
        print(
            "\nAdd them with `gh secret set <NAME>`, then run this again.\n"
            "The demo account is the one that decides whether a reviewer sees "
            "the app or an empty screen."
        )
    else:
        print("Ready. Re-run with dry_run unchecked to submit.")
    print("-" * 60)
    print("\nDry run complete — nothing was changed.")
else:
    print("\nDone.")
