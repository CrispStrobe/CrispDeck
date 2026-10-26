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

    def test_moved_tag_is_rejected_before_release_creation(self):
        responses = [{'nameWithOwner': 'CrispStrobe/CrispDeck'}, {'object': {'type': 'commit', 'sha': 'b' * 40}}]
        with patch.object(publish, 'json_gh', side_effect=responses), patch.object(publish.subprocess, 'run'), patch.object(publish, 'gh') as command:
            with self.assertRaisesRegex(ValueError, 'Remote version tag differs'):
                publish.publish(self.root, '1.3.0', 'a' * 40)
        command.assert_not_called()
