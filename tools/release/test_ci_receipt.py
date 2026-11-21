from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock
import re

import ci_receipt


class CiReceiptTests(unittest.TestCase):
    def setUp(self):
        self.source, self.validated = 'a' * 40, 'b' * 40
        self.run = {'id': 123, 'head_sha': self.validated, 'status': 'completed',
                    'conclusion': 'success', 'path': '.github/workflows/ci.yml', 'run_attempt': 1}
        self.jobs = [{'name': name, 'status': 'completed', 'conclusion': 'success'}
                     for name in ['Required CI', 'Release guards and change scope']]

    def select(self, run=None, jobs=None, ancestor=True, tree=None):
        return ci_receipt.select_receipt(self.source, [self.run if run is None else run],
            lambda _: self.jobs if jobs is None else jobs,
            tree=tree or (lambda _: 'c' * 40), ancestor=lambda *_: ancestor)

    def test_reuses_identical_merged_tree_with_successful_required_jobs(self):
        result = self.select()
        self.assertEqual(result['source'], self.source)
        self.assertEqual(result['validated_commit'], self.validated)
        self.assertEqual(result['ci_run_id'], 123)

    def test_different_tree_or_unmerged_commit_cannot_substitute(self):
        with self.assertRaisesRegex(ValueError, 'No successful CI'):
            self.select(tree=lambda sha: sha)
        with self.assertRaisesRegex(ValueError, 'No successful CI'):
            self.select(ancestor=False)

    def test_failed_pending_other_workflow_or_invalid_sha_is_rejected(self):
        for change in [{'conclusion': 'failure'}, {'status': 'in_progress'},
                       {'path': '.github/workflows/perf.yml'}, {'head_sha': '--invalid'}]:
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, 'No successful CI'):
                self.select(run={**self.run, **change})
        with self.assertRaisesRegex(ValueError, 'full release source'):
            ci_receipt.select_receipt('--bad', [], Mock())

    def test_successful_run_without_required_job_or_guards_is_rejected(self):
        for jobs in [[], self.jobs[:1], self.jobs[1:],
                     [{**job, 'conclusion': 'skipped'} for job in self.jobs]]:
            with self.subTest(jobs=jobs), self.assertRaisesRegex(ValueError, 'No successful CI'):
                self.select(jobs=jobs)

    def test_git_ancestry_and_tree_checks_use_real_repository(self):
        with tempfile.TemporaryDirectory() as temp:
            def git(*args):
                return subprocess.check_output(['git', '-C', temp, *args], text=True).strip()
            git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test')
            git('config', 'commit.gpgsign', 'false')
            git('config', 'core.hooksPath', '/dev/null')
            git('commit', '-q', '--allow-empty', '-m', 'validated')
            validated = git('rev-parse', 'HEAD')
            git('commit', '-q', '--allow-empty', '-m', 'release')
            source = git('rev-parse', 'HEAD')
            tree = lambda sha: git('rev-parse', f'{sha}^{{tree}}')
            ancestor = lambda a, b: subprocess.run(['git', '-C', temp, 'merge-base', '--is-ancestor', a, b]).returncode == 0
            receipt = ci_receipt.select_receipt(source, [{**self.run, 'head_sha': validated}], lambda _: self.jobs,
                                                tree=tree, ancestor=ancestor)
            self.assertEqual(receipt['tree'], tree(source))
            Path(temp, 'runtime.txt').write_text('new runtime')
            git('add', 'runtime.txt'); git('commit', '-q', '-m', 'changed')
            with self.assertRaisesRegex(ValueError, 'No successful CI'):
                ci_receipt.select_receipt(git('rev-parse', 'HEAD'), [{**self.run, 'head_sha': validated}],
                                         lambda _: self.jobs, tree=tree, ancestor=ancestor)

    def test_coordinator_requires_receipt_before_native_fanout(self):
        workflow = (Path(__file__).resolve().parents[2] / '.github/workflows/coordinated-release.yml').read_text()
        prepare = workflow.split('\n  prepare:', 1)[1].split('\n  desktop:', 1)[0]
        self.assertIn('python3 tools/release/ci_receipt.py', prepare)
        self.assertNotIn('uses: ./.github/workflows/ci.yml', workflow)
        for name in ['desktop', 'ios', 'android', 'macos', 'web', 'listing_assets']:
            body = re.search(r'\n  ' + name + r':\n(.*?)(?=\n  [a-z_]+:\n|\Z)', workflow, re.S).group(1)
            self.assertIn('    needs: prepare\n', body)
