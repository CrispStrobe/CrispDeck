#!/usr/bin/env python3
"""Choose an unused increasing iOS build number without reserving/uploading it."""
from pathlib import Path
import json
import client


def next_number(documents, version):
    highest = 0
    for doc in documents:
        versions = {item['id']: item['attributes'] for item in doc.get('included', [])
                    if item['type'] == 'preReleaseVersions'}
        for build in doc['data']:
            ref = build.get('relationships', {}).get('preReleaseVersion', {}).get('data') or {}
            release = versions.get(ref.get('id'))
            if release is None:
                raise ValueError('Apple did not include the build platform/version; refusing to guess')
            if release.get('platform') == 'IOS' and release.get('version') == version:
                # Incrementing the first component also succeeds for a legacy x.y.z build.
                number = int(build['attributes']['version'].split('.')[0])
                highest = max(highest, number)
    if highest >= 9999:
        raise ValueError('iOS build-number range exhausted for this marketing version')
    return str(highest + 1)


def for_version(version):
    # The app's /builds relationship rejects include; the global collection supports it.
    path = '/v1/builds?filter[app]=6789569440&limit=200&include=preReleaseVersion'
    documents = []
    while path:
        doc = client.expect('GET', path)
        documents.append(doc)
        path = doc.get('links', {}).get('next')
    return next_number(documents, version)


if __name__ == '__main__':
    print(for_version(json.loads(Path('package.json').read_text())['version']))
