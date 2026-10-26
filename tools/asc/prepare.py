#!/usr/bin/env python3
"""Create missing platform versions or update editable ones before listing/upload.

Does not cancel reviews, attach builds, or submit. Run listing.py afterwards.
"""
import client
from submit import APP_VERSION, EDITABLE, META, PLATFORM, version_for, sync_version_string


def main():
    app = client.app_id(META['bundleId'])
    if not app:
        raise SystemExit('App record must exist before preparing versions')
    for name, platform in PLATFORM.items():
        version = version_for(app, platform)
        if version:
            attrs = version['attributes']
            if attrs['versionString'] == APP_VERSION:
                print(f'{name}: {APP_VERSION} already exists ({attrs.get("appStoreState")})')
                continue
            if attrs.get('appStoreState') in EDITABLE:
                if not sync_version_string(version, APP_VERSION):
                    raise SystemExit(f'{name}: could not update version')
                continue
            if attrs.get('appStoreState') not in ('READY_FOR_SALE', 'REPLACED_WITH_NEW_VERSION', 'READY_FOR_DISTRIBUTION'):
                raise SystemExit(f'{name}: existing version is locked in {attrs.get("appStoreState")}')
        result = client.expect('POST', '/v1/appStoreVersions', {'data': {
            'type': 'appStoreVersions',
            'attributes': {'platform': platform, 'versionString': APP_VERSION,
                           'copyright': META['app']['copyright'], 'releaseType': 'AFTER_APPROVAL'},
            'relationships': {'app': {'data': {'type': 'apps', 'id': app}}}}})
        print(f'{name}: created {APP_VERSION} ({result["data"]["id"]})')


if __name__ == '__main__':
    main()
