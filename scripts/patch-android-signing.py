#!/usr/bin/env python3
"""Patch Tauri-generated build.gradle.kts to sign release APK with debug keystore."""
import re
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "src-tauri/gen/android/app/build.gradle.kts"

try:
    with open(path) as f:
        content = f.read()
except FileNotFoundError:
    print(f"File not found: {path}")
    sys.exit(1)

signing_config = """
    signingConfigs {
        create("release") {
            storeFile = file(System.getProperty("user.home") + "/.android/debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }
"""

# Insert signingConfigs after "android {"
content = content.replace("android {", "android {" + signing_config, 1)

# Add signingConfig to release buildType
content = re.sub(
    r"(buildTypes\s*\{[^}]*release\s*\{)",
    r'\1\n            signingConfig = signingConfigs.getByName("release")',
    content,
    count=1,
)

with open(path, "w") as f:
    f.write(content)

print("Patched build.gradle.kts for release signing")
