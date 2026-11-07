#!/usr/bin/env python3
"""Validate and copy the committed, opaque iOS app icons into Tauri's catalog."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct

SOURCE = Path('src-tauri/icons/ios')
TARGET = Path('src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset')
MASTER = Path('static/icon-1024.png')


def validate_png(path):
    data = path.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError(f'{path}: not a PNG')
    offset = 8
    seen_header = seen_data = seen_end = False
    while offset + 12 <= len(data):
        length = struct.unpack_from('>I', data, offset)[0]
        end = offset + 12 + length
        if end > len(data): raise ValueError(f'{path}: truncated PNG')
        kind = data[offset + 4:offset + 8]
        body = data[offset + 8:offset + 8 + length]
        if kind == b'IHDR':
            if seen_header or offset != 8 or length != 13: raise ValueError(f'{path}: invalid PNG header')
            width, height, depth, color, _, _, _ = struct.unpack('>IIBBBBB', body)
            if not width or not height or depth != 8 or color != 2:
                raise ValueError(f'{path}: iOS icon must be an 8-bit RGB PNG without alpha')
            seen_header = True
        elif kind == b'tRNS':
            raise ValueError(f'{path}: iOS icon must not contain transparency')
        elif kind == b'IDAT': seen_data = True
        elif kind == b'IEND':
            seen_end = True
            break
        offset = end
    if not (seen_header and seen_data and seen_end): raise ValueError(f'{path}: incomplete PNG')


def validate_source(source=SOURCE, master=MASTER):
    expected = (source / 'source.sha256').read_text().strip()
    actual = hashlib.sha256(master.read_bytes()).hexdigest()
    if actual != expected:
        raise ValueError('iOS icons are stale: regenerate opaque icons after changing static/icon-1024.png')
    icons = list(source.glob('*.png'))
    if not icons: raise ValueError('No iOS icons found')
    for icon in icons: validate_png(icon)


def sync(source=SOURCE, target=TARGET, master=MASTER):
    validate_source(source, master)
    manifest = json.loads((target / 'Contents.json').read_text())
    for image in manifest['images']:
        filename = image.get('filename')
        if filename:
            path = source / filename
            if path.parent != source: raise ValueError('Invalid iOS icon filename')
            validate_png(path)
            shutil.copyfile(path, target / filename)
    print('Synchronized opaque iOS app icons')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--validate-only', action='store_true')
    args = parser.parse_args()
    if args.validate_only:
        validate_source()
        print('iOS app icons are opaque RGB PNGs and match the source')
    else:
        sync()
