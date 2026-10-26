#!/usr/bin/env python3
"""Verify downloaded release assets and write SHA256SUMS before publication.

Usage: python3 tools/release/verify.py 1.3.0 /path/to/downloaded/assets
Requires every supported platform; debug/unsigned mobile packages do not count.
Store approval and Windows signing are separate from artifact completeness.
"""
import hashlib
from pathlib import Path
import sys
import zipfile

version, directory = sys.argv[1:]
root = Path(directory)
patterns = {
    'iOS (App Store archive)': f'CrispDeck_{version}_ios-appstore.ipa',
    'macOS (notarized universal)': f'CrispDeck_{version}_universal.dmg',
    'Android APK': f'CrispDeck_{version}_android_release.apk',
    'Android AAB': f'CrispDeck_{version}_android_release.aab',
    'Windows installer': f'CrispDeck_{version}_x64-setup.exe',
    'Windows MSI': f'CrispDeck_{version}_x64_en-US.msi',
    'Linux DEB': f'CrispDeck_{version}_amd64.deb',
    'Web': f'CrispDeck_{version}_web.zip',
}
missing = []
for platform, name in patterns.items():
    path = root / name
    if not path.is_file() or path.stat().st_size < 1024:
        missing.append(f'{platform}: {name}')
        continue
    if path.suffix in ('.ipa', '.apk', '.aab', '.zip'):
        with zipfile.ZipFile(path) as archive:
            bad = archive.testzip()
            if bad:
                raise SystemExit(f'{name}: corrupt member {bad}')
            if path.suffix == '.ipa' and not any(n.endswith('.app/Info.plist') for n in archive.namelist()):
                raise SystemExit(f'{name}: missing app bundle')
            if name.endswith('_web.zip') and 'index.html' not in archive.namelist():
                raise SystemExit(f'{name}: missing web entry')
    print(f'OK {platform}: {name} ({path.stat().st_size:,} bytes)')
if missing:
    raise SystemExit('Release incomplete:\n  ' + '\n  '.join(missing))
assets = sorted(p for p in root.iterdir() if p.is_file() and p.name != 'SHA256SUMS')
with (root / 'SHA256SUMS').open('w') as sums:
    for path in assets:
        with path.open('rb') as content:
            digest = hashlib.file_digest(content, 'sha256').hexdigest()
        sums.write(f'{digest}  {path.name}\n')
print('All six platforms present; SHA256SUMS written.')
