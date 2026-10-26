import unittest
from next_build import next_number


class NextBuildTests(unittest.TestCase):
    def test_expired_builds_count_and_other_platforms_and_versions_do_not(self):
        doc = {'included': [
            {'type': 'preReleaseVersions', 'id': 'ios', 'attributes': {'version': '1.3.0', 'platform': 'IOS'}},
            {'type': 'preReleaseVersions', 'id': 'mac', 'attributes': {'version': '1.3.0', 'platform': 'MAC_OS'}},
            {'type': 'preReleaseVersions', 'id': 'old', 'attributes': {'version': '1.2.9', 'platform': 'IOS'}}],
            'data': [{'attributes': {'version': value, 'expired': True}, 'relationships': {'preReleaseVersion': {'data': {'id': kind}}}}
                     for kind, value in [('ios', '59'), ('ios', '61'), ('mac', '500'), ('old', '800')]]}
        self.assertEqual(next_number([doc], '1.3.0'), '62')
        self.assertEqual(next_number([doc], '1.3.1'), '1')

    def test_missing_platform_relationship_fails_instead_of_reusing_a_number(self):
        with self.assertRaisesRegex(ValueError, 'refusing to guess'):
            next_number([{'data': [{'attributes': {'version': '61'}}]}], '1.3.0')
