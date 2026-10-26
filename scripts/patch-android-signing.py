#!/usr/bin/env python3
"""
Patch Tauri-generated build.gradle.kts to sign the release APK/AAB.

Signing modes (checked in order):
  1. Production — if ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD,
                  ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD env vars are set.
  2. Debug fallback — uses ~/.android/debug.keystore (for sideloading / CI preview).
"""
import os
import re
import sys
import json

path = sys.argv[1] if len(sys.argv) > 1 else "src-tauri/gen/android/app/build.gradle.kts"

import glob as _glob

# Auto-discover if default path doesn't exist
if not os.path.exists(path):
    candidates = _glob.glob("src-tauri/gen/android/**/build.gradle.kts", recursive=True)
    if candidates:
        path = candidates[0]
        print(f"[signing] Auto-discovered: {path}")
    else:
        print(f"[signing] No build.gradle.kts found (tauri android init may have failed)")
        sys.exit(1)

try:
    with open(path) as f:
        content = f.read()
except FileNotFoundError:
    print(f"File not found: {path}")
    sys.exit(1)

# Determine signing mode
keystore_path = os.environ.get("ANDROID_KEYSTORE_PATH")
keystore_password = os.environ.get("ANDROID_KEYSTORE_PASSWORD")
key_alias = os.environ.get("ANDROID_KEY_ALIAS")
key_password = os.environ.get("ANDROID_KEY_PASSWORD")

production_mode = all([keystore_path, keystore_password, key_alias, key_password])

if production_mode:
    print(f"[signing] Using production keystore: {keystore_path}")
    # Kotlin quoted strings also interpolate $, unlike JSON strings.
    keystore_path, keystore_password, key_alias, key_password = [
        json.dumps(value)[1:-1].replace('$', '\\$')
        for value in (keystore_path, keystore_password, key_alias, key_password)
    ]
    signing_config = f"""
    signingConfigs {{
        create("release") {{
            storeFile = file("{keystore_path}")
            storePassword = "{keystore_password}"
            keyAlias = "{key_alias}"
            keyPassword = "{key_password}"
        }}
    }}
"""
else:
    debug_keystore = os.path.expanduser("~/.android/debug.keystore")
    print(f"[signing] Production secrets not set — using debug keystore: {debug_keystore}")
    signing_config = f"""
    signingConfigs {{
        create("release") {{
            storeFile = file("{debug_keystore}")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }}
    }}
"""

# Insert signingConfigs block after "android {"
if "signingConfigs" in content:
    print("[signing] signingConfigs already present — skipping insertion")
else:
    content = content.replace("android {", "android {" + signing_config, 1)

# Wire signingConfig into the release buildType
if 'signingConfig = signingConfigs.getByName("release")' not in content:
    content = re.sub(
        r'(buildTypes\s*\{[\s\S]*?(?:getByName\("release"\)|release)\s*\{)',
        r'\1\n            signingConfig = signingConfigs.getByName("release")',
        content,
        count=1,
    )

if 'signingConfig = signingConfigs.getByName("release")' not in content:
    raise SystemExit('[signing] Could not wire the release build type; refusing an unsigned build')

with open(path, "w") as f:
    f.write(content)

mode_label = "production" if production_mode else "debug"
print(f"[signing] Patched {path} for {mode_label} signing")
