import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import client
import publish


class FakePlay:
    def __init__(self, code=1003000, sha='a' * 64, existing=(), fail_validate=False, status='completed'):
        self.calls = []; self.code = code; self.sha = sha; self.existing = existing; self.fail_validate = fail_validate; self.status = status

    def call(self, method, path, body=None, media=None):
        self.calls.append((method, path, body))
        if path.endswith('/edits') and method == 'POST': return {'id': 'temporary-edit'}
        if path.endswith('/tracks/internal') and method == 'GET': return {'releases': [{'versionCodes': list(self.existing), 'status': self.status}]}
        if path.endswith('/bundles') and method == 'GET': return {'bundles': [{'versionCode': self.code, 'sha256': self.sha}]}
        if '/bundles?' in path: return {'versionCode': self.code, 'sha256': self.sha}
        if path.endswith(':validate') and self.fail_validate: raise RuntimeError('Incomplete listing')
        return {}


class PlayPublisherTests(unittest.TestCase):
    def invoke(self, api, commit=True):
        return publish.release(api, Path('bundle.aab'), '1.3.0', 1003000, 'a' * 64, 'notes', commit)

    def test_access_check_discards_edit_without_upload_or_commit(self):
        api = FakePlay(); self.assertFalse(self.invoke(api, False)['committed'])
        self.assertEqual(api.calls[-1][0], 'DELETE')
        self.assertFalse(any('/bundles?' in path or path.endswith(':commit') for _, path, _ in api.calls))

    def test_wrong_google_hash_or_code_never_updates_a_track(self):
        for api in (FakePlay(code=1002999), FakePlay(sha='b' * 64)):
            with self.assertRaisesRegex(ValueError, 'version/hash'): self.invoke(api)
            self.assertFalse(any(method == 'PUT' or path.endswith(':commit') for method, path, _ in api.calls))
            self.assertEqual(api.calls[-1][0], 'DELETE')

    def test_validation_failure_never_commits_and_cleans_edit(self):
        api = FakePlay(fail_validate=True)
        with self.assertRaisesRegex(RuntimeError, 'Incomplete listing'): self.invoke(api)
        self.assertFalse(any(path.endswith(':commit') for _, path, _ in api.calls))
        self.assertEqual(api.calls[-1][0], 'DELETE')

    def test_only_internal_track_commits_after_validation(self):
        api = FakePlay(); self.assertTrue(self.invoke(api)['committed'])
        update = next(body for method, _, body in api.calls if method == 'PUT')
        self.assertEqual(update['track'], 'internal')
        self.assertTrue(api.calls[-2][1].endswith(':validate'))
        self.assertTrue(api.calls[-1][1].endswith(':commit'))

    def test_newer_internal_version_prevents_rollback(self):
        api = FakePlay(existing=['1003001'])
        with self.assertRaisesRegex(ValueError, 'rollback'): self.invoke(api)
        self.assertFalse(any('/bundles?' in path for _, path, _ in api.calls))

    def test_missing_credentials_fail_without_any_network_request(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(client.urllib.request, 'urlopen') as request:
            with self.assertRaisesRegex(ValueError, 'not configured'): client.credentials()
        request.assert_not_called()

    def test_existing_draft_bundle_is_promoted_without_reupload(self):
        api = FakePlay(existing=['1003000'], status='draft')
        self.assertTrue(self.invoke(api)['committed'])
        self.assertFalse(any('/bundles?' in path for _, path, _ in api.calls))
        self.assertTrue(any(method == 'PUT' for method, _, _ in api.calls))

    def test_existing_completed_release_is_an_idempotent_noop(self):
        api = FakePlay(existing=['1003000'])
        self.assertTrue(self.invoke(api)['already_present'])
        self.assertFalse(any(method == 'PUT' or '/bundles?' in path for method, path, _ in api.calls))
