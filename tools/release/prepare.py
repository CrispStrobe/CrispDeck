#!/usr/bin/env python3
"""Check immutable release inputs before native builds consume runner time."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tomllib


def main():
    version = json.loads(Path('package.json').read_text())['version']
    lock = json.loads(Path('package-lock.json').read_text())
    cargo = tomllib.loads(Path('src-tauri/Cargo.toml').read_text())
    cargo_lock = tomllib.loads(Path('src-tauri/Cargo.lock').read_text())
    versions = [lock['version'], lock['packages']['']['version'], cargo['package']['version'],
                json.loads(Path('src-tauri/tauri.conf.json').read_text())['version']]
    versions.extend(item['version'] for item in cargo_lock['package'] if item['name'] == 'crispdeck')
    if not re.fullmatch(r'\d+\.\d+\.\d+', version) or any(item != version for item in versions):
        raise SystemExit('Package, Tauri and Cargo release versions must agree')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    if commit != os.environ['GITHUB_SHA']:
        raise SystemExit('Checkout differs from the workflow source commit')
    publish = os.getenv('RELEASE_PUBLISH') == 'true'
    if publish:
        if os.environ.get('GITHUB_REF') != f'refs/tags/v{version}':
            raise SystemExit('Publication requires the matching immutable vVERSION tag')
        current = subprocess.run(['gh', 'release', 'view', f'v{version}', '--json', 'isDraft'], capture_output=True, text=True)
        if current.returncode == 0 and not json.loads(current.stdout)['isDraft']:
            raise SystemExit('This release is already published; refusing to replace its artifacts')
        if current.returncode and 'release not found' not in current.stderr.lower():
            raise SystemExit('Could not verify whether the release already exists: ' + current.stderr)
        mode = os.getenv('WINDOWS_SIGNING_MODE', '')
        fields = {'pfx': ['WINDOWS_CERT_PFX_BASE64', 'WINDOWS_CERT_PASSWORD'],
                  'azure': ['AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_SIGNING_ENDPOINT',
                            'AZURE_SIGNING_ACCOUNT', 'AZURE_CERTIFICATE_PROFILE']}
        if mode not in fields or any(not os.getenv(field) for field in fields[mode]):
            raise SystemExit('Publication requires configured Windows publisher signing; see docs/releasing.md')
    if not re.fullmatch(r'[0-9a-f]{64}', os.getenv('ANDROID_RELEASE_CERT_SHA256', '')):
        raise SystemExit('Pin the retained Android certificate before building')
    sys.path.insert(0, str(Path('tools/asc').resolve()))
    from next_build import for_version
    build = for_version(version)
    values = {'version': version, 'commit': commit, 'ios_build': build, 'publish': str(publish).lower()}
    with Path(os.environ['GITHUB_OUTPUT']).open('a') as file:
        for key, value in values.items():
            file.write(f'{key}={value}\n')
    print(json.dumps(values))


if __name__ == '__main__':
    main()
