#!/usr/bin/env python3
"""Populate Tauri's generated iOS asset catalog from the project icons."""
import json
import shutil
from pathlib import Path

source = Path('src-tauri/icons/ios')
target = Path('src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset')
manifest = json.loads((target / 'Contents.json').read_text())
for image in manifest['images']:
    filename = image.get('filename')
    if filename:
        shutil.copyfile(source / filename, target / filename)
print('Synchronized iOS app icons')
