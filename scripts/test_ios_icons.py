import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('sync_ios_icons', Path(__file__).with_name('sync-ios-icons.py'))
icons = importlib.util.module_from_spec(spec)
spec.loader.exec_module(icons)


class IosIconTests(unittest.TestCase):
    def test_all_committed_icons_are_opaque_and_match_master(self):
        icons.validate_source()
        self.assertGreaterEqual(len(list(icons.SOURCE.glob('*.png'))), 18)
        icons.validate_png(icons.SOURCE / 'AppIcon-512@2x.png')

    def test_rejects_alpha_channel_even_if_pixels_are_opaque(self):
        data = bytearray((icons.SOURCE / 'AppIcon-512@2x.png').read_bytes())
        data[25] = 6  # RGBA PNG colour type
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'alpha.png'; path.write_bytes(data)
            with self.assertRaisesRegex(ValueError, 'without alpha'):
                icons.validate_png(path)

    def test_refuses_stale_icon_master(self):
        with tempfile.TemporaryDirectory() as temp:
            master = Path(temp) / 'changed.png'; master.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'stale'):
                icons.validate_source(master=master)

    def test_copies_verified_icons_to_generated_catalog(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp)
            name = 'AppIcon-512@2x.png'
            (target / 'Contents.json').write_text(json.dumps({'images': [{'filename': name}]}))
            icons.sync(target=target)
            self.assertEqual((target / name).read_bytes(), (icons.SOURCE / name).read_bytes())
