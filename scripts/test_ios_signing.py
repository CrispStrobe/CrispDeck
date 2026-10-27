import copy
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
from pathlib import Path
import unittest
import tempfile


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


signing = load('ios-signing')
guard = load('xcodebuild-offline')


class IosSigningTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2030, 1, 1, tzinfo=timezone.utc)
        self.identity = hashlib.sha1(b'retained distribution certificate').hexdigest().upper()
        self.profile = {'Name': 'Example AppStore CI', 'UUID': 'cf0878cc-2230-4337-ba99-ae76ced4ab65',
                        'ExpirationDate': self.now + timedelta(days=10), 'Platform': ['iOS'],
                        'TeamIdentifier': ['TEAM123456'],
                        'Entitlements': {'application-identifier': 'TEAM123456.com.example.app', 'get-task-allow': False},
                        'DeveloperCertificates': [b'another retained certificate', b'retained distribution certificate']}

    def validate(self, profile=None):
        return signing.validate_profile(profile or self.profile, 'com.example.app', 'TEAM123456', self.identity, self.now)

    def test_matches_the_actual_retained_identity_in_a_multi_certificate_profile(self):
        metadata = self.validate()
        self.assertEqual(metadata['certificate_sha1'], self.identity)
        options = signing.export_options(metadata)
        self.assertEqual(options['signingStyle'], 'manual')
        self.assertEqual(options['signingCertificate'], self.identity)
        self.assertEqual(options['provisioningProfiles'], {'com.example.app': 'Example AppStore CI'})
        self.assertFalse(options['manageAppVersionAndBuildNumber'])

    def test_rejects_a_profile_for_another_app_team_or_certificate(self):
        for change in [lambda p: p.update(TeamIdentifier=['ANOTHER']),
                       lambda p: p['Entitlements'].update({'application-identifier': 'TEAM123456.com.other.app'}),
                       lambda p: p.update(DeveloperCertificates=[b'another retained certificate'])]:
            with self.subTest(change=change):
                profile = copy.deepcopy(self.profile); change(profile)
                with self.assertRaises(ValueError): self.validate(profile)

    def test_rejects_development_adhoc_and_enterprise_profiles(self):
        for change in [lambda p: p['Entitlements'].update({'get-task-allow': True}),
                       lambda p: p.update(ProvisionedDevices=['device']),
                       lambda p: p.update(ProvisionsAllDevices=True),
                       lambda p: p.update(Platform=['OSX'])]:
            profile = copy.deepcopy(self.profile); change(profile)
            with self.assertRaises(ValueError): self.validate(profile)

    def test_rejects_expired_or_nearly_expired_profiles(self):
        self.profile['ExpirationDate'] = self.now + timedelta(hours=12)
        with self.assertRaisesRegex(ValueError, 'expires'): self.validate()

    def test_legacy_utc_profile_dates_remain_usable(self):
        self.profile['ExpirationDate'] = self.profile['ExpirationDate'].replace(tzinfo=None)
        self.assertEqual(self.validate()['certificate_sha1'], self.identity)

    def test_selects_one_distribution_private_key_and_rejects_ambiguity(self):
        line = f'  1) {self.identity} "Apple Distribution: Example (TEAM123456)"\n'
        self.assertEqual(signing.distribution_identity(line), self.identity)
        for output in ['', line + line]:
            with self.assertRaises(ValueError): signing.distribution_identity(output)

    def test_guard_removes_automatic_provisioning_without_changing_archive_inputs(self):
        arguments = ['archive', '-allowProvisioningUpdates', '-sdk', 'iphoneos',
                     'CODE_SIGNING_ALLOWED=NO', '-archivePath', '/tmp/a path/App.xcarchive',
                     '-allowProvisioningDeviceRegistration', '-allowProvisioningUpdates']
        self.assertEqual(guard.local_arguments(arguments), ['archive', '-sdk', 'iphoneos',
                         'CODE_SIGNING_ALLOWED=NO', '-archivePath', '/tmp/a path/App.xcarchive'])

    def test_guard_audits_archives_even_when_tauri_sanitizes_child_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            log = root / 'native-smoke.jsonl'
            (root / 'xcodebuild.log-path').write_text(str(log))
            self.assertEqual(guard.guard_log_path(root / 'xcodebuild', environment={}), log)

    def test_missing_guard_audit_configuration_is_an_error(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(FileNotFoundError):
                guard.guard_log_path(Path(directory) / 'xcodebuild', environment={})
