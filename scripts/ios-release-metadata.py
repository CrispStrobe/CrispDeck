#!/usr/bin/env python3
"""Apply versionless iOS customizations and verify the signed export before upload."""
import argparse
from pathlib import Path
import plistlib
import zipfile

PURPOSES = ('NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSPhotoLibraryUsageDescription')
OAUTH_SCHEME = 'app.vercel.crispdeck'


def validate_custom(info):
    for key in PURPOSES:
        if not isinstance(info.get(key), str) or not info[key].strip():
            raise ValueError(f'Missing iOS permission purpose: {key}')
    schemes = [scheme for item in info.get('CFBundleURLTypes', []) for scheme in item.get('CFBundleURLSchemes', [])]
    if OAUTH_SCHEME not in schemes:
        raise ValueError(f'Missing {OAUTH_SCHEME} callback URL scheme')


def apply(info_path, custom_path):
    original = Path(info_path).read_bytes()
    info = plistlib.loads(original)
    custom = plistlib.loads(Path(custom_path).read_bytes())
    validate_custom(custom)
    allowed = {'CFBundleURLTypes', 'ITSAppUsesNonExemptEncryption'}
    if any(key not in allowed and not (key.startswith('NS') and key.endswith('UsageDescription')) for key in custom):
        raise ValueError('iOS customizations must not override generated bundle/version/platform fields')
    # Platform plugins may register additional callbacks. Keep their entries
    # instead of replacing the whole generated CFBundleURLTypes array.
    url_types = info.get('CFBundleURLTypes', [])
    for entry in custom.get('CFBundleURLTypes', []):
        if entry not in url_types:
            url_types.append(entry)
    info.update(custom)
    info['CFBundleURLTypes'] = url_types
    fmt = plistlib.FMT_BINARY if original.startswith(b'bplist00') else plistlib.FMT_XML
    Path(info_path).write_bytes(plistlib.dumps(info, fmt=fmt))


def verify(ipa, version, build):
    with zipfile.ZipFile(ipa) as archive:
        names = [name for name in archive.namelist() if name.startswith('Payload/') and name.endswith('.app/Info.plist')]
        if len(names) != 1:
            raise ValueError('Expected exactly one iOS app bundle')
        info = plistlib.loads(archive.read(names[0]))
        expected = {'CFBundleIdentifier': 'com.christianstrobele.crispdeck',
                    'CFBundleShortVersionString': version, 'CFBundleVersion': build}
        for key, value in expected.items():
            if info.get(key) != value:
                raise ValueError(f'{key}: expected {value}, received {info.get(key)}')
        validate_custom(info)
        prefix = names[0].removesuffix('Info.plist')
        if prefix + info.get('CFBundleExecutable', '') not in archive.namelist():
            raise ValueError('Bundle executable is missing')
        if prefix + 'PrivacyInfo.xcprivacy' not in archive.namelist():
            raise ValueError('App privacy manifest is missing')
    print(f'iOS export verified: {version} ({build}), media purposes, callback scheme and privacy manifest')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    patch = commands.add_parser('apply')
    patch.add_argument('info'); patch.add_argument('custom')
    check = commands.add_parser('verify')
    check.add_argument('ipa'); check.add_argument('version'); check.add_argument('build')
    args = parser.parse_args()
    if args.command == 'apply':
        apply(args.info, args.custom)
    else:
        verify(args.ipa, args.version, args.build)
