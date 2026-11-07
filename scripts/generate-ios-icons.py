#!/usr/bin/env python3
"""Regenerate committed opaque iOS icons (requires Pillow and npm dependencies)."""
import hashlib
from pathlib import Path
import subprocess
import tempfile
from PIL import Image

MASTER = Path('static/icon-1024.png')
DEST = Path('src-tauri/icons/ios')
BACKGROUND = (79, 70, 229)  # matches Tauri's iOS background

with tempfile.TemporaryDirectory() as temp:
    subprocess.run(['npx', 'tauri', 'icon', str(MASTER), '--output', temp,
                    '--ios-color', '#4f46e5'], check=True)
    generated = Path(temp) / 'ios'
    icons = list(generated.glob('*.png'))
    if not icons: raise RuntimeError('Tauri did not generate iOS icons')
    DEST.mkdir(parents=True, exist_ok=True)
    for path in icons:
        with Image.open(path) as image:
            rgba = image.convert('RGBA')
            rgb = Image.new('RGB', rgba.size, BACKGROUND)
            rgb.paste(rgba, mask=rgba.getchannel('A'))
            rgb.save(DEST / path.name, optimize=True)
    (DEST / 'source.sha256').write_text(hashlib.sha256(MASTER.read_bytes()).hexdigest() + '\n')
    print(f'Generated {len(icons)} opaque iOS icons')
