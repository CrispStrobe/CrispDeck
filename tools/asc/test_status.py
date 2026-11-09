"""The status report compares builds only within a marketing version."""
import unittest
from unittest.mock import patch
import status

class NewestBuildTests(unittest.TestCase):
    @patch.object(status, 'one')
    def test_ignores_other_versions_and_platforms(self, one):
        builds = [
            {'id': 'new-release', 'attributes': {'processingState': 'VALID', 'uploadedDate': '2026-11-03'}},
            {'id': 'other-platform', 'attributes': {'processingState': 'VALID', 'uploadedDate': '2026-11-02'}},
            {'id': 'matching', 'attributes': {'processingState': 'VALID', 'uploadedDate': '2026-11-01'}},
        ]
        details = {'new-release': ('IOS', '1.3.3'), 'other-platform': ('MAC_OS', '1.3.2'), 'matching': ('IOS', '1.3.2')}
        def lookup(path):
            platform, version = details[path.split('/')[3]]
            return {'attributes': {'platform': platform, 'version': version}}
        one.side_effect = lookup
        self.assertEqual(status.newest_build_for_version(builds, 'IOS', '1.3.2')['id'], 'matching')

    @patch.object(status, 'one')
    def test_excludes_expired_and_unprocessed(self, one):
        builds = [{'id': 'expired', 'attributes': {'processingState': 'VALID', 'expired': True}},
                  {'id': 'processing', 'attributes': {'processingState': 'PROCESSING'}}]
        self.assertIsNone(status.newest_build_for_version(builds, 'IOS', '1.3.2'))
        one.assert_not_called()

if __name__ == '__main__':
    unittest.main()
