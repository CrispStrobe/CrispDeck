#!/usr/bin/env python3
"""Publish a complete verified artifact set; never replace a published release."""
import argparse
import hashlib
import json
import re
from pathlib import Path
import subprocess
import tempfile


def gh(*args):
    return subprocess.check_output(['gh', *args], text=True)


def json_gh(*args):
    return json.loads(gh(*args))


def verify_partial_checksums(root, checksum_file):
    """Ensure earlier public checksum lists describe this exact verified set."""
    lines = checksum_file.read_text().splitlines()
    if not lines:
        raise ValueError('Partial checksum list is empty')
    seen = set()
    for line in lines:
        match = re.fullmatch(r'([0-9a-f]{64})  ([^/\\]+)', line)
        if not match or match.group(2) in seen:
            raise ValueError('Invalid partial checksum list')
        checksum, name = match.groups()
        seen.add(name)
        path = root / name
        if not path.is_file() or path.is_symlink():
            raise ValueError('Partial checksum refers to an unexpected file')
        with path.open('rb') as file:
            if hashlib.file_digest(file, 'sha256').hexdigest() != checksum:
                raise ValueError('Partial checksum differs from verified package')


def publish(root, version, commit, allow_unsigned_windows=False):
    evidence = json.loads((root / f'CrispDeck_{version}_release-evidence.json').read_text())
    if evidence.get('commit') != commit or evidence.get('version') != version or (evidence.get('publishable') is not True and not (allow_unsigned_windows and evidence.get('all_platforms_verified') is True)):
        raise ValueError('Publication requires a complete signed manifest for this source/version')
    subprocess.run(['sha256sum', '--check', 'SHA256SUMS'], cwd=root, check=True)
    repo = json_gh('repo', 'view', '--json', 'nameWithOwner')['nameWithOwner']
    ref = json_gh('api', f'repos/{repo}/git/ref/tags/v{version}')['object']
    if ref['type'] == 'tag': ref = json_gh('api', f'repos/{repo}/git/tags/{ref["sha"]}')['object']
    if ref.get('type') != 'commit' or ref['sha'] != commit:
        raise ValueError('Remote version tag differs from verified source commit')
    tag = 'v' + version
    result = subprocess.run(['gh', 'release', 'view', tag, '--json', 'isDraft,isPrerelease,assets'], capture_output=True, text=True)
    if result.returncode == 0:
        release = json.loads(result.stdout)
        if not (release['isDraft'] or release.get('isPrerelease', False)):
            raise ValueError('Release is already published; artifacts are immutable')
    else:
        if 'release not found' not in result.stderr.lower():
            raise ValueError('Could not check release state: ' + result.stderr)
        gh('release', 'create', tag, '--verify-tag', '--target', commit, '--draft', '--title', f'CrispDeck {tag}', '--notes', 'Verified release assembly in progress.')
        release = {'assets': []}
    existing = {asset['name']: asset for asset in release['assets']}
    local = {path.name: path for path in root.iterdir() if path.is_file()}
    extras = set(existing) - set(local)
    if extras - {'SHA256SUMS.partial', 'SHA256SUMS.android'}:
        raise ValueError('Draft contains unexpected assets; refusing a mixed release')
    if extras:
        with tempfile.TemporaryDirectory() as temp:
            for name in sorted(extras):
                gh('release', 'download', tag, '--pattern', name, '--dir', temp)
                path = Path(temp) / name
                with path.open('rb') as file:
                    digest = 'sha256:' + hashlib.file_digest(file, 'sha256').hexdigest()
                if existing[name].get('digest') != digest or existing[name].get('size') != path.stat().st_size:
                    raise ValueError('Existing partial checksum asset differs from GitHub metadata')
                verify_partial_checksums(root, path)
    for name, path in sorted(local.items()):
        with path.open('rb') as file: digest = 'sha256:' + hashlib.file_digest(file, 'sha256').hexdigest()
        if name in existing:
            if existing[name].get('digest') != digest or existing[name]['size'] != path.stat().st_size:
                raise ValueError(f'Draft asset differs: {name}; rerun the failed publication job with its original verified artifact')
        else:
            gh('release', 'upload', tag, str(path))
    uploaded = json_gh('release', 'view', tag, '--json', 'isDraft,isPrerelease,assets')
    if not (uploaded['isDraft'] or uploaded.get('isPrerelease', False)) or {item['name'] for item in uploaded['assets']} != set(local) | extras:
        raise ValueError('Release visibility or asset inventory changed during assembly')
    for asset in uploaded['assets']:
        if asset['name'] in extras: continue
        with local[asset['name']].open('rb') as file:
            expected = 'sha256:' + hashlib.file_digest(file, 'sha256').hexdigest()
        if asset.get('digest') != expected: raise ValueError('Uploaded asset hash differs: ' + asset['name'])
    changelog = Path('CHANGELOG.md').read_text()
    marker = f'## v{version}'
    body = changelog.split(marker, 1)[1].split('\n## ', 1)[0] if marker in changelog else 'See CHANGELOG.md for changes.'
    windows_note = 'Windows installers are unsigned.' if evidence.get('publishable') is not True else 'Windows app/installers are publisher signed and timestamped.'
    notes = f'CrispDeck {tag}\n\n{body}\n\nAll six platform packages were built from `{commit}` and verified before publication. Verify downloads against SHA256SUMS; release-evidence.json and platform receipts record the checks. {windows_note} macOS is universal, signed and notarized.\n\nThe iOS IPA is an App Store distribution archive. Apple processing, TestFlight review and App Store approval are separate. Google Play publication is separate from the signed APK/AAB downloads. Web ZIP hosting requires configuration for optional server endpoints. Scheduling remains on-device and requires the app to remain open.\n'
    with tempfile.TemporaryDirectory() as temp:
        path = Path(temp) / 'notes.txt'; path.write_text(notes)
        gh('release', 'edit', tag, '--target', commit, '--title', f'CrispDeck {tag}', '--notes-file', str(path), '--draft=false', '--prerelease=false', '--latest')
    print(gh('release', 'view', tag, '--json', 'url').strip())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--version', required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--allow-unsigned-windows', action='store_true')
    args = parser.parse_args()
    publish(args.directory, args.version, args.commit, args.allow_unsigned_windows)
