#!/usr/bin/env python3
"""Validate retained iOS signing inputs and prepare a manual App Store export.

This helper makes no Apple API calls and never creates or revokes identities.
"""
import argparse
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import tempfile
import uuid


def distribution_identity(output):
    identities = re.findall(r'^\s*\d+\)\s+([0-9A-Fa-f]{40})\s+"(?:Apple|iPhone) Distribution:',
                            output, re.MULTILINE)
    if len(identities) != 1:
        raise ValueError('Expected exactly one retained Distribution identity in the build keychain')
    return identities[0].upper()


def validate_profile(profile, bundle, team, identity, now=None):
    now = now or datetime.now(timezone.utc)
    expires = profile['ExpirationDate']
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires <= now + timedelta(days=1):
        raise ValueError('App Store provisioning profile expires within one day')
    entitlements = profile.get('Entitlements', {})
    if team not in profile.get('TeamIdentifier', []) or entitlements.get('application-identifier') != f'{team}.{bundle}':
        raise ValueError('App Store profile belongs to another team or app')
    if entitlements.get('get-task-allow') is not False or 'ProvisionedDevices' in profile or profile.get('ProvisionsAllDevices'):
        raise ValueError('Expected App Store distribution, not development/ad-hoc/enterprise provisioning')
    if 'iOS' not in profile.get('Platform', []):
        raise ValueError('Expected an iOS provisioning profile')
    fingerprints = [hashlib.sha1(cert).hexdigest().upper() for cert in profile.get('DeveloperCertificates', [])]
    if identity.upper() not in fingerprints:
        raise ValueError('Provisioning profile does not contain the retained signing certificate')
    uuid.UUID(profile['UUID'])
    if not profile.get('Name'):
        raise ValueError('Provisioning profile has no name')
    return {'profile_name': profile['Name'], 'profile_uuid': profile['UUID'],
            'certificate_sha1': identity.upper(), 'expires': expires.isoformat(),
            'bundle_id': bundle, 'team_id': team}


def export_options(metadata):
    return {'method': 'app-store-connect', 'teamID': metadata['team_id'],
            'signingStyle': 'manual', 'signingCertificate': metadata['certificate_sha1'],
            'provisioningProfiles': {metadata['bundle_id']: metadata['profile_name']},
            'manageAppVersionAndBuildNumber': False, 'destination': 'export'}


def prepare(args):
    os.umask(0o077)
    args.output.mkdir(parents=True, exist_ok=True)
    profile_data = base64.b64decode(os.environ['IOS_APPSTORE_PROFILE_BASE64'], validate=True)
    profile_file = args.output / 'AppStore.mobileprovision'
    profile_file.write_bytes(profile_data)
    profile = plistlib.loads(subprocess.check_output(['security', 'cms', '-D', '-i', str(profile_file)]))
    identities = subprocess.check_output(['security', 'find-identity', '-v', '-p', 'codesigning', args.keychain], text=True)
    identity = distribution_identity(identities)
    metadata = validate_profile(profile, args.bundle, args.team, identity)
    for folder in ('Library/MobileDevice/Provisioning Profiles',
                   'Library/Developer/Xcode/UserData/Provisioning Profiles'):
        destination = Path.home() / folder
        destination.mkdir(parents=True, exist_ok=True)
        (destination / f'{metadata["profile_uuid"]}.mobileprovision').write_bytes(profile_data)
    options = args.output / 'ExportOptions.plist'
    options.write_bytes(plistlib.dumps(export_options(metadata)))
    (args.output / 'signing-metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    with Path(os.environ['GITHUB_ENV']).open('a') as env:
        env.write(f'IOS_SIGNING_SHA1={identity}\nIOS_EXPORT_OPTIONS={options.resolve()}\n')
    print(json.dumps(metadata))


def verify_app(app, identity):
    with tempfile.TemporaryDirectory() as directory:
        prefix = str(Path(directory) / 'signer-')
        subprocess.run(['codesign', '-d', '--extract-certificates=' + prefix, str(app)], check=True)
        actual = hashlib.sha1(Path(prefix + '0').read_bytes()).hexdigest().upper()
    if actual != identity.upper():
        raise ValueError('Exported IPA was signed with another certificate')
    print(json.dumps({'exported_device_ipa_certificate_sha1': actual, 'retained_identity': True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    setup = commands.add_parser('prepare')
    setup.add_argument('--bundle', required=True)
    setup.add_argument('--team', required=True)
    setup.add_argument('--keychain', required=True)
    setup.add_argument('--output', type=Path, required=True)
    verify = commands.add_parser('verify-app')
    verify.add_argument('--app', type=Path, required=True)
    verify.add_argument('--identity', required=True)
    guard = commands.add_parser('verify-guard')
    guard.add_argument('--log', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'prepare': prepare(args)
    elif args.command == 'verify-app': verify_app(args.app, args.identity)
    else:
        records = [json.loads(line) for line in args.log.read_text().splitlines()]
        if not any(record['archive'] and record['unsigned'] for record in records):
            raise ValueError('The iOS archive did not pass through the unsigned provisioning guard')
        print('Unsigned archive passed through the local provisioning guard')
