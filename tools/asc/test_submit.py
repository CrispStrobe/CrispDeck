"""Submission must never attach or submit a valid build from another release."""
import unittest
from unittest.mock import patch

import submit


class ReleaseBuildTests(unittest.TestCase):
    @patch.object(submit.client, 'call')
    @patch.object(submit.client, 'paged')
    def test_selects_marketing_version_and_platform(self, paged, call):
        paged.return_value = [
            {'id': key, 'attributes': {'processingState': 'VALID', 'uploadedDate': date}}
            for key, date in [('old', '2026-10-27'), ('mac', '2026-10-27'), ('correct', '2026-10-26')]
        ]
        releases = {'old': ('IOS', '1.2.9'), 'mac': ('MAC_OS', submit.APP_VERSION),
                    'correct': ('IOS', submit.APP_VERSION)}
        def response(method, path):
            platform, version = releases[path.split('/')[3]]
            return 200, {'data': {'attributes': {'platform': platform, 'version': version}}}
        call.side_effect = response
        self.assertEqual(submit.newest_build('app', 'IOS')['id'], 'correct')

    @patch.object(submit, 'newest_build', return_value=None)
    @patch.object(submit.client, 'call')
    def test_no_matching_build_does_not_change_attachment(self, call, newest):
        self.assertFalse(submit.attach_build({'id': 'version'}, 'app', 'IOS'))
        call.assert_not_called()

    @patch.object(submit, 'review_submission')
    @patch.object(submit, 'attach_build', return_value=False)
    @patch.object(submit, 'sync_version_string', return_value=True)
    @patch.object(submit, 'version_for', return_value={'id': 'v', 'attributes': {
        'versionString': submit.APP_VERSION, 'appStoreState': 'REJECTED'}})
    @patch.object(submit, 'pricing', return_value=True)
    @patch.object(submit, 'age_rating', return_value=True)
    @patch.object(submit.client, 'app_id', return_value='app')
    def test_attachment_failure_blocks_review_submission(self, *mocks):
        with patch('sys.argv', ['submit.py', '--platform', 'ios', '--really-submit']):
            self.assertEqual(submit.main(), 1)
        mocks[-1].assert_not_called()


if __name__ == '__main__':
    unittest.main()
