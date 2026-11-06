import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import publish


class PublishGuardsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.evidence = self.root / 'CrispDeck_1.3.0_release-evidence.json'
        self.evidence.write_text(json.dumps({'version': '1.3.0', 'commit': 'a' * 40, 'publishable': True}))

    def test_unsigned_candidate_is_rejected_before_network_or_release_writes(self):
        self.evidence.write_text(json.dumps({'version': '1.3.0', 'commit': 'a' * 40, 'publishable': False}))
        with patch.object(publish, 'gh') as command, self.assertRaisesRegex(ValueError, 'complete signed manifest'):
            publish.publish(self.root, '1.3.0', 'a' * 40)
        command.assert_not_called()

    def test_unsigned_override_still_requires_a_fully_verified_manifest(self):
        self.evidence.write_text(json.dumps({'version': '1.3.0', 'commit': 'a' * 40, 'publishable': False, 'all_platforms_verified': False}))
        with patch.object(publish, 'gh') as command, self.assertRaisesRegex(ValueError, 'complete signed manifest'):
            publish.publish(self.root, '1.3.0', 'a' * 40, allow_unsigned_windows=True)
        command.assert_not_called()

    def test_unsigned_override_does_not_bypass_tag_validation(self):
        self.evidence.write_text(json.dumps({'version': '1.3.0', 'commit': 'a' * 40, 'publishable': False, 'all_platforms_verified': True}))
        responses = [{'nameWithOwner': 'CrispStrobe/CrispDeck'}, {'object': {'type': 'commit', 'sha': 'b' * 40}}]
        with patch.object(publish, 'json_gh', side_effect=responses), patch.object(publish.subprocess, 'run'), patch.object(publish, 'gh') as command:
            with self.assertRaisesRegex(ValueError, 'Remote version tag differs'):
                publish.publish(self.root, '1.3.0', 'a' * 40, allow_unsigned_windows=True)
            command.assert_not_called()

    def test_published_release_never_receives_upload_or_edit(self):
        def read(*args):
            if args[0] == 'repo': return {'nameWithOwner': 'CrispStrobe/CrispDeck'}
            return {'object': {'type': 'commit', 'sha': 'a' * 40}}
        def process(args, **kwargs):
            class Result:
                returncode = 0
                stdout = json.dumps({'isDraft': False, 'assets': []})
            return Result()
        with patch.object(publish, 'json_gh', side_effect=read), patch.object(publish.subprocess, 'run', side_effect=process), patch.object(publish, 'gh') as command:
            with self.assertRaisesRegex(ValueError, 'already published'):
                publish.publish(self.root, '1.3.0', 'a' * 40)
        command.assert_not_called()

    def test_partial_checksums_must_match_verified_packages(self):
        import hashlib
        package = self.root / 'package.deb'
        package.write_bytes(b'verified package')
        partial = self.root / 'partial-list'
        partial.write_text(hashlib.sha256(package.read_bytes()).hexdigest() + '  package.deb\n')
        publish.verify_partial_checksums(self.root, partial)
        package.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'differs from verified'):
            publish.verify_partial_checksums(self.root, partial)
        partial.write_text('0' * 64 + '  ../outside\n')
        with self.assertRaisesRegex(ValueError, 'Invalid partial'):
            publish.verify_partial_checksums(self.root, partial)

    def test_complete_staged_prerelease_can_be_finalized(self):
        import hashlib
        checksum = self.root / 'SHA256SUMS'
        checksum.write_text('checksum evidence')
        files = [self.evidence, checksum]
        assets = [{'name': p.name, 'size': p.stat().st_size, 'digest': 'sha256:' + hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]
        prerelease = {'isDraft': False, 'isPrerelease': True, 'assets': assets}
        def read(*args):
            if args[0] == 'repo': return {'nameWithOwner': 'CrispStrobe/CrispDeck'}
            if args[0] == 'api': return {'object': {'type': 'commit', 'sha': 'a' * 40}}
            return prerelease
        def process(args, **kwargs):
            class Result:
                returncode = 0
                stdout = json.dumps(prerelease)
            return Result()
        with patch.object(publish, 'json_gh', side_effect=read), patch.object(publish.subprocess, 'run', side_effect=process), patch.object(publish, 'gh') as command:
            publish.publish(self.root, '1.3.0', 'a' * 40)
        edits = [call.args for call in command.call_args_list if call.args[:2] == ('release', 'edit')]
        self.assertEqual(len(edits), 1)
        self.assertIn('--prerelease=false', edits[0])

    def test_moved_tag_is_rejected_before_release_creation(self):
        responses = [{'nameWithOwner': 'CrispStrobe/CrispDeck'}, {'object': {'type': 'commit', 'sha': 'b' * 40}}]
        with patch.object(publish, 'json_gh', side_effect=responses), patch.object(publish.subprocess, 'run'), patch.object(publish, 'gh') as command:
            with self.assertRaisesRegex(ValueError, 'Remote version tag differs'):
                publish.publish(self.root, '1.3.0', 'a' * 40)
        command.assert_not_called()
