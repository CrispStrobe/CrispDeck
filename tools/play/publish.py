#!/usr/bin/env python3
"""Verify published Android packages, check publisher access, or release only to internal testing."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys

import client

PACKAGE = 'com.christianstrobele.crispdeck'
APP = '/androidpublisher/v3/applications/' + PACKAGE


def verify_sums(root, version):
    if not re.fullmatch(r'\d+\.\d+\.\d+', version): raise ValueError('Expected a stable release marketing version')
    entries = {}
    for line in (root / 'SHA256SUMS').read_text().splitlines():
        digest, name = line.split('  ', 1)
        if name in entries: raise ValueError('Ambiguous checksum entry')
        entries[name] = digest
    for suffix in ('apk', 'aab'):
        name = f'CrispDeck_{version}_android_release.{suffix}'
        with (root / name).open('rb') as file: actual = hashlib.file_digest(file, 'sha256').hexdigest()
        if entries.get(name) != actual: raise ValueError('Android artifact differs from the published checksum: ' + name)
    return entries[f'CrispDeck_{version}_android_release.aab']


def release(api, aab, version, version_code, sha256, notes, commit=False):
    """A temporary edit is discarded unless an explicitly requested internal release commits."""
    edit = api.call('POST', APP + '/edits', {})['id']
    path = APP + '/edits/' + edit
    committed = False
    try:
        try:
            track = api.call('GET', path + '/tracks/internal')
        except client.ApiError as error:
            if error.status != 404: raise
            track = {'releases': []}
        codes = [int(code) for item in track.get('releases', []) for code in item.get('versionCodes', [])]
        if not commit:
            return {'access': 'confirmed', 'track': 'internal', 'committed': False}
        if codes and max(codes) > version_code:
            raise ValueError('A newer internal build exists; refusing a rollback')
        completed = [int(code) for item in track.get('releases', []) if item.get('status') == 'completed' for code in item.get('versionCodes', [])]
        if version_code in completed:
            return {'track': 'internal', 'version_code': version_code, 'already_present': True, 'committed': False}
        if version_code in codes:
            bundles = api.call('GET', path + '/bundles').get('bundles', [])
            bundle = next((item for item in bundles if item.get('versionCode') == version_code), {})
        else:
            bundle = api.call('POST', '/upload' + path + '/bundles?uploadType=media', media=aab)
        if bundle.get('versionCode') != version_code or bundle.get('sha256', '').lower() != sha256:
            raise ValueError('Google bundle version/hash differs from the verified release')
        api.call('PUT', path + '/tracks/internal', {'track': 'internal', 'releases': [{
            'name': 'CrispDeck ' + version, 'versionCodes': [str(version_code)], 'status': 'completed',
            'releaseNotes': [{'language': 'en-US', 'text': notes}]}]})
        api.call('POST', path + ':validate')
        api.call('POST', path + ':commit')
        committed = True
        return {'track': 'internal', 'version_code': version_code, 'committed': True,
                'scope': 'Google processing/review and tester availability remain separate.'}
    finally:
        if not committed: api.call('DELETE', path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('preflight', 'check-access', 'publish-internal'))
    parser.add_argument('--assets', type=Path, required=True)
    parser.add_argument('--version', required=True)
    args = parser.parse_args()
    digest = verify_sums(args.assets, args.version)
    sys.path.insert(0, str(Path('tools/release').resolve()))
    from packages import android
    code = android(args.assets, Path(os.environ['ANDROID_HOME']), os.environ['ANDROID_RELEASE_CERT_SHA256'], args.version)
    metadata = json.loads(Path('tools/play/listing.json').read_text())
    if not (len(metadata['title']) <= 30 and len(metadata['shortDescription']) <= 80 and len(metadata['fullDescription']) <= 4000):
        raise ValueError('Play listing copy exceeds field limits')
    if args.action == 'preflight':
        print(json.dumps({'offline_artifacts': 'verified', 'version': args.version, 'version_code': code,
                          'publisher_credentials': bool(os.getenv('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON') or os.getenv('GOOGLE_APPLICATION_CREDENTIALS')),
                          'listing_copy': 'draft; app record, forms and graphics still need Console setup', 'api_calls': 0}))
        return
    result = release(client.Client(), args.assets / f'CrispDeck_{args.version}_android_release.aab',
                     args.version, code, digest, metadata['releaseNotes'], args.action == 'publish-internal')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
