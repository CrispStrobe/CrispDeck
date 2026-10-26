#!/usr/bin/env python3
"""Apply CrispDeck's manifest customizations to a fresh Tauri Android project.

Keep generated icons, providers and current template settings. Namespace belongs
in Gradle rather than the manifest's obsolete package attribute.
"""
from copy import deepcopy
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

ANDROID = 'http://schemas.android.com/apk/res/android'
ET.register_namespace('android', ANDROID)
ET.register_namespace('tools', 'http://schemas.android.com/tools')
NAME = f'{{{ANDROID}}}name'


def filter_key(node):
    return tuple(sorted((child.tag, tuple(sorted(child.attrib.items()))) for child in node))


def merge(seed_path, target_path):
    seed = ET.parse(seed_path).getroot()
    tree = ET.parse(target_path)
    target = tree.getroot()
    target.attrib.pop('package', None)
    for permission in seed.findall('uses-permission'):
        existing = next((p for p in target.findall('uses-permission') if p.get(NAME) == permission.get(NAME)), None)
        if existing is None:
            target.insert(0, deepcopy(permission))
        else:
            existing.attrib.update(permission.attrib)
    source_app, app = seed.find('application'), target.find('application')
    if source_app is None or app is None:
        raise ValueError('Both manifests must have an application')
    app.attrib.update(source_app.attrib)
    for source_activity in source_app.findall('activity'):
        activity = next((a for a in app.findall('activity')
                         if a.get(NAME, '').split('.')[-1] == source_activity.get(NAME, '').split('.')[-1]), None)
        if activity is None:
            raise ValueError(f'Generated activity missing: {source_activity.get(NAME)}')
        changes_key = f'{{{ANDROID}}}configChanges'
        changes = list(dict.fromkeys(filter(None, (activity.get(changes_key, '') + '|' + source_activity.get(changes_key, '')).split('|'))))
        activity.attrib.update(source_activity.attrib)
        if changes:
            activity.set(changes_key, '|'.join(changes))
        known = {filter_key(f) for f in activity.findall('intent-filter')}
        for intent in source_activity.findall('intent-filter'):
            key = filter_key(intent)
            if key not in known:
                activity.append(deepcopy(intent))
                known.add(key)
    ET.indent(tree, space='    ')
    tree.write(target_path, encoding='utf-8', xml_declaration=True)


if __name__ == '__main__':
    merge(*map(Path, sys.argv[1:]))
