import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import stage


class StageTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.file = self.root / 'CrispDeck_1.3.1_amd64.deb'
        self.file.write_bytes(b'package')
        self.receipt = {'schema': 1, 'platform': 'linux', 'version': '1.3.1', 'commit': 'a' * 40,
                        'checks': {'package_metadata': True, 'install_smoke': True, 'deep_link_dispatch': True},
                        'assets': {self.file.name: {'bytes': self.file.stat().st_size, 'sha256': hashlib.sha256(self.file.read_bytes()).hexdigest()}}}
        self.save()

    def save(self):
        (self.root / 'receipt-linux.json').write_text(json.dumps(self.receipt))

    def test_accepts_exact_verified_platform(self):
        self.assertEqual([p.name for p in stage.verify_platform(self.root, 'linux', '1.3.1', 'a' * 40)], [self.file.name, 'receipt-linux.json'])

    def test_rejects_changed_asset_before_network(self):
        self.file.write_bytes(b'tampered')
        with patch.object(stage, 'gh') as gh, self.assertRaisesRegex(ValueError, 'does not match receipt'):
            stage.stage(self.root, 'linux', '1.3.1', 'a' * 40)
        gh.assert_not_called()

    def test_rejects_missing_smoke_check_and_wrong_source(self):
        self.receipt['checks']['install_smoke'] = False; self.save()
        with self.assertRaisesRegex(ValueError, 'checks did not all pass'):
            stage.verify_platform(self.root, 'linux', '1.3.1', 'a' * 40)
        with self.assertRaisesRegex(ValueError, 'does not match release source'):
            stage.verify_platform(self.root, 'linux', '1.3.1', 'b' * 40)

    def test_never_changes_final_release(self):
        def gh(*args):
            if args[0] == 'repo': return json.dumps({'nameWithOwner': 'org/repo'})
            return json.dumps({'object': {'type': 'commit', 'sha': 'a' * 40}})
        with patch.object(stage, 'gh', side_effect=gh), patch.object(stage, 'release', return_value={'isDraft': False, 'isPrerelease': False, 'assets': []}), patch.object(stage.subprocess, 'run') as process:
            with self.assertRaisesRegex(ValueError, 'final or inaccessible'):
                stage.stage(self.root, 'linux', '1.3.1', 'a' * 40)
            process.assert_not_called()

    def test_matching_existing_assets_are_idempotent(self):
        def gh(*args):
            if args[0] == 'repo': return json.dumps({'nameWithOwner': 'org/repo'})
            return json.dumps({'object': {'type': 'commit', 'sha': 'a' * 40}})
        files = [self.file, self.root / 'receipt-linux.json']
        assets = [{'name': p.name, 'size': p.stat().st_size, 'digest': 'sha256:' + hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]
        with patch.object(stage, 'gh', side_effect=gh), patch.object(stage, 'release', return_value={'isDraft': False, 'isPrerelease': True, 'assets': assets}), patch.object(stage.subprocess, 'run') as process:
            stage.stage(self.root, 'linux', '1.3.1', 'a' * 40)
            process.assert_not_called()

    def test_moved_tag_is_rejected_before_release_changes(self):
        def gh(*args):
            if args[0] == 'repo': return json.dumps({'nameWithOwner': 'org/repo'})
            return json.dumps({'object': {'type': 'commit', 'sha': 'b' * 40}})
        with patch.object(stage, 'gh', side_effect=gh), patch.object(stage, 'release') as release:
            with self.assertRaisesRegex(ValueError, 'differs from platform source'):
                stage.stage(self.root, 'linux', '1.3.1', 'a' * 40)
            release.assert_not_called()
