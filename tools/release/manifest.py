#!/usr/bin/env python3
"""Bind platform checks and package hashes to one source commit before publishing."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile

REQUIRED = {
    'ios': ('codesign', 'retained_identity', 'metadata', 'simulator_smoke'),
    'android': ('apk_signature', 'aab_signature', 'certificate', 'alignment', 'metadata'),
    'macos': ('codesign', 'notarization', 'gatekeeper', 'universal', 'install_smoke'),
    'windows': ('package_metadata', 'install_smoke'),
    'linux': ('package_metadata', 'install_smoke'),
    'web': ('archive',),
}


def names(version):
    prefix = f'CrispDeck_{version}_'
    return {
        'ios': [prefix + 'ios-appstore.ipa'],
        'android': [prefix + 'android_release.apk', prefix + 'android_release.aab', prefix + 'android-cert.sha256'],
        'macos': [prefix + 'universal.dmg'],
        'windows': [prefix + 'x64-setup.exe', prefix + 'x64_en-US.msi'],
        'linux': [prefix + 'amd64.deb'],
        'web': [prefix + 'web.zip'],
    }


def digest(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def receipt(root, platform, version, commit, checks, metadata=None):
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('A full source commit SHA is required')
    assets = {}
    for name in names(version)[platform]:
        path = root / name
        if not path.is_file() or path.is_symlink() or path.stat().st_size < (64 if name.endswith('.sha256') else 1024):
            raise ValueError(f'Missing or empty final package: {name}')
        assets[name] = {'sha256': digest(path), 'bytes': path.stat().st_size}
    data = {'schema': 1, 'platform': platform, 'version': version, 'commit': commit,
            'checks': checks, 'metadata': metadata or {}, 'assets': assets}
    for check in REQUIRED[platform]:
        if checks.get(check) is not True:
            raise ValueError(f'{platform}: required check did not pass: {check}')
    (root / f'receipt-{platform}.json').write_text(json.dumps(data, indent=2) + '\n')
    return data


def verify(root, version, commit, build_number, android_certificate, require_windows_signing=False):
    expected_names = names(version)
    receipts = {}
    for platform, files in expected_names.items():
        data = json.loads((root / f'receipt-{platform}.json').read_text())
        if (data.get('schema'), data.get('platform'), data.get('version'), data.get('commit')) != (1, platform, version, commit):
            raise ValueError(f'{platform}: package receipt belongs to a different source/version')
        if set(data.get('assets', {})) != set(files):
            raise ValueError(f'{platform}: unexpected or missing package in receipt')
        for check in REQUIRED[platform]:
            if data.get('checks', {}).get(check) is not True:
                raise ValueError(f'{platform}: required check did not pass: {check}')
        for name in files:
            path = root / name
            if not path.is_file() or path.is_symlink():
                raise ValueError(f'Missing final package: {name}')
            actual = {'sha256': digest(path), 'bytes': path.stat().st_size}
            if data['assets'][name] != actual:
                raise ValueError(f'{platform}: package changed after verification: {name}')
            if path.suffix in ('.ipa', '.apk', '.aab', '.zip'):
                with zipfile.ZipFile(path) as archive:
                    if archive.testzip():
                        raise ValueError(f'Corrupt archive: {name}')
                    if platform == 'web' and 'index.html' not in archive.namelist():
                        raise ValueError('Web archive has no index.html')
        receipts[platform] = data
    if receipts['ios']['metadata'].get('build_number') != build_number:
        raise ValueError('iOS receipt has the wrong build number')
    if not re.fullmatch(r'[0-9a-f]{64}', android_certificate):
        raise ValueError('The retained Android certificate must be pinned')
    cert_file = root / expected_names['android'][-1]
    if cert_file.read_text().strip() != android_certificate or receipts['android']['metadata'].get('certificate_sha256') != android_certificate:
        raise ValueError('Android package identity differs from the retained certificate')
    smoke = json.loads((root / 'android-emulator-smoke.json').read_text())
    apk_name = expected_names['android'][0]
    if (smoke.get('commit'), smoke.get('version'), smoke.get('apk_sha256')) != (commit, version, receipts['android']['assets'][apk_name]['sha256']):
        raise ValueError('Android emulator report belongs to another source/package')
    if smoke.get('checks', {}).get('install_launch_restart') is not True:
        raise ValueError('Android native installation/startup/restart checks did not pass')
    if smoke.get('checks', {}).get('system_bar_themes') is not True:
        raise ValueError('Android system-bar theme checks did not pass')
    signed = receipts['windows']['checks'].get('authenticode') is True and receipts['windows']['checks'].get('timestamp') is True
    if require_windows_signing and not signed:
        raise ValueError('Publication requires valid, timestamped Windows publisher signatures')
    permitted = {name for files in expected_names.values() for name in files}
    permitted.update(f'receipt-{platform}.json' for platform in REQUIRED)
    evidence_name = f'CrispDeck_{version}_release-evidence.json'
    permitted.update((evidence_name, 'SHA256SUMS', 'android-emulator-smoke.json'))
    extras = {path.name for path in root.iterdir()} - permitted
    if extras:
        raise ValueError(f'Unexpected release files: {sorted(extras)}')
    evidence = {'schema': 1, 'version': version, 'commit': commit, 'ios_build': build_number,
                'all_platforms_verified': True, 'publishable': signed, 'platforms': receipts, 'android_emulator': smoke,
                'scope': 'Package/build and installer smoke checks; live account workflows and physical-device validation are separate.'}
    (root / evidence_name).write_text(json.dumps(evidence, indent=2) + '\n')
    with (root / 'SHA256SUMS').open('w') as file:
        for path in sorted(root.iterdir()):
            if path.name != 'SHA256SUMS':
                file.write(f'{digest(path)}  {path.name}\n')
    return evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('receipt')
    create.add_argument('platform', choices=REQUIRED)
    create.add_argument('directory', type=Path)
    create.add_argument('--check', action='append', default=[])
    create.add_argument('--checks-file', type=Path)
    create.add_argument('--build-number')
    create.add_argument('--certificate')
    check = commands.add_parser('verify')
    check.add_argument('version'); check.add_argument('directory', type=Path)
    check.add_argument('--commit', required=True)
    check.add_argument('--build-number', required=True)
    check.add_argument('--android-certificate', required=True)
    check.add_argument('--require-windows-signing', action='store_true')
    args = parser.parse_args()
    if args.command == 'receipt':
        version = json.loads(Path('package.json').read_text())['version']
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
        details = json.loads(args.checks_file.read_text()) if args.checks_file else {}
        checks = {**details.get('checks', {}), **dict.fromkeys(args.check, True)}
        metadata = details.get('metadata', {})
        if args.build_number: metadata['build_number'] = args.build_number
        if args.certificate: metadata['certificate_sha256'] = args.certificate
        receipt(args.directory, args.platform, version, commit, checks, metadata)
        print(f'{args.platform}: final packages and checks bound to {commit}')
    else:
        evidence = verify(args.directory, args.version, args.commit, args.build_number,
                          args.android_certificate, args.require_windows_signing)
        print(f'All six platforms verified from {args.commit}; Windows publisher signing: {evidence["publishable"]}')


if __name__ == '__main__':
    main()
