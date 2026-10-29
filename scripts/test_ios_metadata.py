import importlib.util
from pathlib import Path
import plistlib
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('ios_metadata', Path(__file__).with_name('ios-release-metadata.py'))
metadata = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metadata)
CUSTOM = Path(__file__).parent.parent / 'src-tauri/Info.ios.plist'


class IosMetadataTests(unittest.TestCase):
    def base(self):
        return {'CFBundleIdentifier': 'com.christianstrobele.crispdeck',
                'CFBundleShortVersionString': '1.3.0', 'CFBundleVersion': '61',
                'CFBundleExecutable': 'CrispDeck', 'DTSDKName': 'iphoneos26.0'}

    def package(self, root, info, privacy=True):
        path = root / 'app.ipa'
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('Payload/CrispDeck.app/Info.plist', plistlib.dumps(info))
            archive.writestr('Payload/CrispDeck.app/CrispDeck', b'fixture executable')
            if privacy:
                archive.writestr('Payload/CrispDeck.app/PrivacyInfo.xcprivacy', plistlib.dumps({}))
        return path

    def test_apply_preserves_generated_versions_executable_and_sdk(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'Info.plist'; path.write_bytes(plistlib.dumps(self.base(), fmt=plistlib.FMT_BINARY))
            metadata.apply(path, CUSTOM)
            info = plistlib.loads(path.read_bytes())
            for key, value in self.base().items():
                self.assertEqual(info[key], value)
            metadata.validate_custom(info)

    def test_complete_export_passes(self):
        with tempfile.TemporaryDirectory() as directory:
            info = {**self.base(), **plistlib.loads(CUSTOM.read_bytes())}
            metadata.verify(self.package(Path(directory), info), '1.3.0', '61')

    def test_apply_keeps_plugin_callbacks_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'Info.plist'
            generated = [{'CFBundleURLSchemes': ['app.vercel.crispdeck', 'another.plugin']}]
            path.write_bytes(plistlib.dumps({**self.base(), 'CFBundleURLTypes': generated}))
            metadata.apply(path, CUSTOM)
            first = path.read_bytes()
            metadata.apply(path, CUSTOM)
            self.assertEqual(first, path.read_bytes())
            schemes = [s for item in plistlib.loads(first)['CFBundleURLTypes'] for s in item['CFBundleURLSchemes']]
            self.assertIn('another.plugin', schemes)
            self.assertIn('app.vercel.crispdeck', schemes)

    def test_legacy_callback_alone_cannot_pass_export_verification(self):
        info = {**self.base(), **plistlib.loads(CUSTOM.read_bytes())}
        info['CFBundleURLTypes'] = [{'CFBundleURLSchemes': ['crispdeck']}]
        with tempfile.TemporaryDirectory() as directory, self.assertRaisesRegex(ValueError, 'app.vercel.crispdeck'):
            metadata.verify(self.package(Path(directory), info), '1.3.0', '61')

    def test_generated_export_without_customizations_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'permission purpose'):
                metadata.verify(self.package(Path(directory), self.base()), '1.3.0', '61')

    def test_missing_callback_stale_build_or_missing_privacy_are_rejected(self):
        complete = {**self.base(), **plistlib.loads(CUSTOM.read_bytes())}
        cases = [({**complete, 'CFBundleURLTypes': []}, True),
                 ({**complete, 'CFBundleVersion': '1.3.0'}, True), (complete, False)]
        for info, privacy in cases:
            with self.subTest(info=info, privacy=privacy), tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(ValueError):
                    metadata.verify(self.package(Path(directory), info, privacy), '1.3.0', '61')
