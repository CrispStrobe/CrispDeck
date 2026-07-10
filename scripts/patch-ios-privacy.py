#!/usr/bin/env python3
"""
Inject PrivacyInfo.xcprivacy into the Tauri-generated iOS Xcode project.

Run this after `tauri ios init` to ensure Apple's required privacy manifest
is included in the app bundle.
"""
import os
import re
import sys
import uuid

GEN_DIR = "src-tauri/gen/apple"
TARGET_DIR = os.path.join(GEN_DIR, "CrispDeck_iOS")
PRIVACY_FILENAME = "PrivacyInfo.xcprivacy"
PRIVACY_PATH = os.path.join(TARGET_DIR, PRIVACY_FILENAME)

PRIVACY_CONTENT = """\
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>NSPrivacyAccessedAPITypes</key>
    <array>
        <dict>
            <key>NSPrivacyAccessedAPIType</key>
            <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
            <key>NSPrivacyAccessedAPITypeReasons</key>
            <array>
                <string>CA92.1</string>
            </array>
        </dict>
        <dict>
            <key>NSPrivacyAccessedAPIType</key>
            <string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
            <key>NSPrivacyAccessedAPITypeReasons</key>
            <array>
                <string>C617.1</string>
            </array>
        </dict>
        <dict>
            <key>NSPrivacyAccessedAPIType</key>
            <string>NSPrivacyAccessedAPICategoryDiskSpace</string>
            <key>NSPrivacyAccessedAPITypeReasons</key>
            <array>
                <string>85F4.1</string>
            </array>
        </dict>
    </array>
    <key>NSPrivacyCollectedDataTypes</key>
    <array/>
    <key>NSPrivacyTracking</key>
    <false/>
    <key>NSPrivacyTrackingDomains</key>
    <array/>
</dict>
</plist>
"""


def make_uuid() -> str:
    return uuid.uuid4().hex[:24].upper()


def find_xcodeproj(search_dir: str) -> str | None:
    for entry in os.listdir(search_dir):
        if entry.endswith(".xcodeproj"):
            return os.path.join(search_dir, entry)
    return None


def main() -> None:
    # 1. Write / overwrite PrivacyInfo.xcprivacy
    os.makedirs(TARGET_DIR, exist_ok=True)
    with open(PRIVACY_PATH, "w") as f:
        f.write(PRIVACY_CONTENT)
    print(f"[privacy] Wrote {PRIVACY_PATH}")

    # 2. Find the generated .xcodeproj
    xcodeproj = find_xcodeproj(GEN_DIR)
    if not xcodeproj:
        print("[privacy] No .xcodeproj found — PrivacyInfo.xcprivacy will be picked up on next init")
        return

    pbxproj_path = os.path.join(xcodeproj, "project.pbxproj")
    with open(pbxproj_path) as f:
        content = f.read()

    if PRIVACY_FILENAME in content:
        print("[privacy] PrivacyInfo.xcprivacy already present in Xcode project — skipping")
        return

    # 3. Patch the pbxproj to add PBXFileReference + PBXBuildFile + Resources link
    file_ref_uuid = make_uuid()
    build_file_uuid = make_uuid()

    # PBXFileReference entry
    file_ref_entry = (
        f"\t\t{file_ref_uuid} /* {PRIVACY_FILENAME} */ = {{"
        f"isa = PBXFileReference; "
        f"lastKnownFileType = file.bplist; "
        f"name = {PRIVACY_FILENAME}; "
        f"path = CrispDeck_iOS/{PRIVACY_FILENAME}; "
        f"sourceTree = \"<group>\"; }};\n"
    )
    content = re.sub(
        r"(/\* End PBXFileReference section \*/)",
        file_ref_entry + r"\1",
        content,
    )

    # PBXBuildFile entry
    build_file_entry = (
        f"\t\t{build_file_uuid} /* {PRIVACY_FILENAME} in Resources */ = {{"
        f"isa = PBXBuildFile; "
        f"fileRef = {file_ref_uuid} /* {PRIVACY_FILENAME} */; }};\n"
    )
    content = re.sub(
        r"(/\* End PBXBuildFile section \*/)",
        build_file_entry + r"\1",
        content,
    )

    # Add to the first PBXResourcesBuildPhase files list
    content = re.sub(
        r"(/\* Begin PBXResourcesBuildPhase section \*/.*?files = \()",
        r"\1\n\t\t\t\t" + build_file_uuid + f" /* {PRIVACY_FILENAME} in Resources */,",
        content,
        count=1,
        flags=re.DOTALL,
    )

    with open(pbxproj_path, "w") as f:
        f.write(content)
    print(f"[privacy] Added {PRIVACY_FILENAME} to {pbxproj_path}")


if __name__ == "__main__":
    main()
