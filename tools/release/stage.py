#!/usr/bin/env python3
"""Stage one independently verified platform as a visible incomplete prerelease."""
import argparse
import json
from pathlib import Path
import subprocess
import zipfile

from manifest import REQUIRED, names, digest


def gh(*args):
    return subprocess.check_output(['gh', *args], text=True)


def verify_platform(root, platform, version, commit):
    receipt_path = root / f'receipt-{platform}.json'
    receipt = json.loads(receipt_path.read_text())
    if (receipt.get('schema'), receipt.get('platform'), receipt.get('version'), receipt.get('commit')) != (1, platform, version, commit):
        raise ValueError('Platform receipt does not match release source and version')
    files = names(version)[platform]
    if set(receipt.get('assets', {})) != set(files):
        raise ValueError('Platform receipt has unexpected or missing assets')
    if any(receipt.get('checks', {}).get(key) is not True for key in REQUIRED[platform]):
        raise ValueError('Platform verification checks did not all pass')
    for name in files:
        path = root / name
        if not path.is_file() or path.is_symlink():
            raise ValueError(f'Missing platform asset: {name}')
        actual = {'sha256': digest(path), 'bytes': path.stat().st_size}
        if receipt['assets'][name] != actual:
            raise ValueError(f'Platform asset does not match receipt: {name}')
        if path.suffix in ('.ipa', '.apk', '.aab', '.zip'):
            with zipfile.ZipFile(path) as archive:
                if archive.testzip(): raise ValueError(f'Corrupt archive: {name}')
    return [root / name for name in files] + [receipt_path]


def release(tag):
    result = subprocess.run(['gh', 'release', 'view', tag, '--json', 'isDraft,isPrerelease,assets'], capture_output=True, text=True)
    if result.returncode:
        if 'release not found' in result.stderr.lower(): return None
        raise RuntimeError('Could not read existing release: ' + result.stderr)
    return json.loads(result.stdout)


def stage(root, platform, version, commit):
    files = verify_platform(root, platform, version, commit)
    repo = json.loads(gh('repo', 'view', '--json', 'nameWithOwner'))['nameWithOwner']
    tag = 'v' + version
    ref = json.loads(gh('api', f'repos/{repo}/git/ref/tags/{tag}'))['object']
    if ref['type'] == 'tag': ref = json.loads(gh('api', f'repos/{repo}/git/tags/{ref["sha"]}'))['object']
    if ref.get('type') != 'commit' or ref['sha'] != commit:
        raise ValueError('Remote release tag differs from platform source commit')
    current = release(tag)
    if current is None:
        # Two platforms can finish simultaneously. The loser must reread the
        # created release rather than overwriting it or failing the build.
        subprocess.run(['gh', 'release', 'create', tag, '--verify-tag', '--prerelease', '--title', f'CrispDeck {tag} (release in progress)', '--notes', 'Release assembly in progress. Assets are added after their individual platform checks pass. Full cross-platform verification and store distribution are pending. Windows packages are unsigned unless their receipt explicitly records valid publisher signatures and timestamps.'], capture_output=True, text=True)
        current = release(tag)
    if not current or current.get('isDraft') or not current.get('isPrerelease'):
        raise ValueError('Refusing to change a final or inaccessible release')
    for path in files:
        expected = 'sha256:' + digest(path)
        existing = {item['name']: item for item in current['assets']}.get(path.name)
        if existing is None:
            result = subprocess.run(['gh', 'release', 'upload', tag, str(path)], capture_output=True, text=True)
            current = release(tag)
            if not current or not current.get('isPrerelease'):
                raise ValueError('Release changed while staging assets')
            existing = {item['name']: item for item in current['assets']}.get(path.name)
            if result.returncode and existing is None:
                raise RuntimeError('Could not upload release asset: ' + result.stderr)
        if existing is None or existing.get('digest') != expected or existing.get('size') != path.stat().st_size:
            raise ValueError(f'Existing staged asset differs: {path.name}')
    print(f'Staged verified {platform} assets in {tag}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--platform', required=True, choices=list(REQUIRED))
    parser.add_argument('--version', required=True)
    parser.add_argument('--commit', required=True)
    args = parser.parse_args()
    stage(args.directory, args.platform, args.version, args.commit)
