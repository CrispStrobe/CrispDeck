import json
from pathlib import Path
import tempfile
import unittest
import zipfile

import manifest

VERSION = '1.3.0'
COMMIT = 'a' * 40
CERT = 'b' * 64


class ReleaseManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for platform, files in manifest.names(VERSION).items():
            for name in files:
                path = self.root / name
                if path.suffix in ('.ipa', '.apk', '.aab', '.zip'):
                    with zipfile.ZipFile(path, 'w') as archive:
                        archive.writestr('index.html', 'fixture' * 300)
                else:
                    path.write_bytes((CERT + '\n').encode() if name.endswith('.sha256') else b'fixture' * 300)
            checks = dict.fromkeys(manifest.REQUIRED[platform], True)
            metadata = {'build_number': '62'} if platform == 'ios' else {'certificate_sha256': CERT} if platform == 'android' else {}
            manifest.receipt(self.root, platform, VERSION, COMMIT, checks, metadata)
        apk = self.root / manifest.names(VERSION)['android'][0]
        (self.root / 'android-emulator-smoke.json').write_text(json.dumps({'version': VERSION,
            'commit': COMMIT, 'validator_commit': COMMIT, 'diagnostic': False, 'apk_sha256': manifest.digest(apk),
            'checks': {'install_launch_restart': True, 'system_bar_themes': True, 'deep_link_dispatch': True}}))

    def verify(self, **kwargs):
        return manifest.verify(self.root, VERSION, COMMIT, '62', CERT, **kwargs)

    def change_receipt(self, platform, change):
        path = self.root / f'receipt-{platform}.json'
        data = json.loads(path.read_text()); change(data)
        path.write_text(json.dumps(data))

    def test_build_only_reports_unsigned_windows_without_allowing_publication(self):
        self.assertFalse(self.verify()['publishable'])
        with self.assertRaisesRegex(ValueError, 'publisher signatures'):
            self.verify(require_windows_signing=True)

    def test_different_commit_or_failed_platform_check_is_rejected(self):
        self.change_receipt('macos', lambda data: data.update(commit='c' * 40))
        with self.assertRaisesRegex(ValueError, 'different source'):
            self.verify()
        self.change_receipt('macos', lambda data: data.update(commit=COMMIT))
        self.change_receipt('ios', lambda data: data['checks'].update(codesign=False))
        with self.assertRaisesRegex(ValueError, 'codesign'):
            self.verify()
        self.change_receipt('ios', lambda data: data['checks'].update(codesign=True, retained_identity=False))
        with self.assertRaisesRegex(ValueError, 'retained_identity'):
            self.verify()

    def test_replaced_package_missing_platform_or_wrong_mobile_identity_is_rejected(self):
        package = self.root / manifest.names(VERSION)['linux'][0]
        original = package.read_bytes(); package.write_bytes(b'replaced' * 300)
        with self.assertRaisesRegex(ValueError, 'changed after verification'):
            self.verify()
        package.write_bytes(original)
        self.change_receipt('android', lambda data: data['metadata'].update(certificate_sha256='d' * 64))
        with self.assertRaisesRegex(ValueError, 'retained certificate'):
            self.verify()
        (self.root / 'receipt-macos.json').unlink()
        with self.assertRaises(FileNotFoundError): self.verify()

    def test_signed_complete_release_has_checksums_for_every_published_file(self):
        self.change_receipt('windows', lambda data: data['checks'].update(authenticode=True, timestamp=True))
        self.assertTrue(self.verify(require_windows_signing=True)['publishable'])
        sums = (self.root / 'SHA256SUMS').read_text().splitlines()
        self.assertEqual(len(sums), len(list(self.root.iterdir())) - 1)
        for line in sums:
            digest, name = line.split('  ', 1)
            self.assertEqual(digest, manifest.digest(self.root / name))

    def test_android_emulator_result_must_match_the_actual_package_and_source(self):
        path = self.root / 'android-emulator-smoke.json'
        original = json.loads(path.read_text())
        for key, value in [('commit', 'd' * 40), ('apk_sha256', 'e' * 64)]:
            path.write_text(json.dumps({**original, key: value}))
            with self.assertRaisesRegex(ValueError, 'another source/package'):
                self.verify()

    def test_android_theme_regression_blocks_aggregation(self):
        path = self.root / 'android-emulator-smoke.json'
        report = json.loads(path.read_text())
        report['checks']['system_bar_themes'] = False
        path.write_text(json.dumps(report))
        with self.assertRaisesRegex(ValueError, 'system-bar theme'):
            self.verify()

    def test_callback_dispatch_is_mandatory_for_every_native_platform(self):
        for platform in ('ios', 'macos', 'windows', 'linux'):
            with self.subTest(platform=platform):
                self.change_receipt(platform, lambda data: data['checks'].update(deep_link_dispatch=False))
                with self.assertRaisesRegex(ValueError, 'deep_link_dispatch'):
                    self.verify()
                self.change_receipt(platform, lambda data: data['checks'].update(deep_link_dispatch=True))
        path = self.root / 'android-emulator-smoke.json'
        report = json.loads(path.read_text())
        report['checks']['deep_link_dispatch'] = False
        path.write_text(json.dumps(report))
        with self.assertRaisesRegex(ValueError, 'callback dispatch'):
            self.verify()

    def test_retained_package_diagnostics_cannot_be_promoted_to_release_evidence(self):
        path = self.root / 'android-emulator-smoke.json'
        original = json.loads(path.read_text())
        for changes in [{'diagnostic': True}, {'validator_commit': 'f' * 40}]:
            path.write_text(json.dumps({**original, **changes}))
            with self.assertRaisesRegex(ValueError, 'release source validator'):
                self.verify()
