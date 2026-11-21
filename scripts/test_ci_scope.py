import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('ci_scope', Path(__file__).with_name('ci_scope.py'))
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)


class CiScopeTests(unittest.TestCase):
    def test_full_override_does_not_read_or_classify_history(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'output'
            with patch.dict(os.environ, {'FORCE_FULL': 'true', 'GITHUB_OUTPUT': str(output)}), \
                    patch.object(scope.subprocess, 'check_output') as diff:
                scope.main()
            diff.assert_not_called()
            self.assertEqual(output.read_text(), 'full=true\n')

    def test_actual_required_gate_rejects_failures_and_unexpected_skips(self):
        helper_spec = importlib.util.spec_from_file_location('workflow_inputs', Path(__file__).with_name('test_workflow_inputs.py'))
        helper = importlib.util.module_from_spec(helper_spec)
        helper_spec.loader.exec_module(helper)
        workflow = Path(__file__).resolve().parents[1] / '.github/workflows/ci.yml'
        script = next(code for name, code in helper.run_blocks(workflow) if name == 'Require every CI job to pass')
        for full, expected in [('true', 'success'), ('false', 'skipped')]:
            env = {'PATH': os.environ['PATH'], 'SCOPE_RESULT': 'success', 'FULL': full,
                   'FRONTEND_RESULT': expected, 'RUST_RESULT': expected, 'NODE26_RESULT': expected}
            self.assertEqual(subprocess.run(['bash', '-c', script], env=env, capture_output=True).returncode, 0)
            for key in ['FRONTEND_RESULT', 'RUST_RESULT', 'NODE26_RESULT', 'SCOPE_RESULT']:
                for bad in ['failure', 'cancelled', 'success' if expected == 'skipped' else 'skipped']:
                    if key == 'SCOPE_RESULT' and bad == 'success':
                        continue
                    with self.subTest(full=full, key=key, bad=bad):
                        result = subprocess.run(['bash', '-c', script], env={**env, key: bad}, capture_output=True)
                        self.assertNotEqual(result.returncode, 0)
            self.assertNotEqual(subprocess.run(['bash', '-c', script], env={**env, 'FULL': ''}, capture_output=True).returncode, 0)

    def test_known_release_only_change_uses_guards(self):
        self.assertFalse(scope.requires_full(['PLAN.md', 'docs/releasing.md', 'tools/asc/metadata.json',
            'tools/release/publish.py', 'tools/security/legacy-storage.mjs',
            '.github/workflows/ci.yml', '.github/workflows/coordinated-release.yml',
            'scripts/ci_scope.py', 'scripts/test_ci_scope.py']))

    def test_runtime_dependency_native_and_unknown_changes_require_matrix(self):
        for path in ['src/lib/feed.ts', 'api/push/subscribe.ts', 'src-tauri/Cargo.lock',
                     'package-lock.json', 'e2e/feed.test.ts', 'static/sw.js', 'vite.config.js',
                     '.github/workflows/mobile.yml', 'scripts/ios-release-metadata.py', 'unknown.txt']:
            with self.subTest(path=path):
                self.assertTrue(scope.requires_full(['docs/releasing.md', path]))
        self.assertTrue(scope.requires_full([]))

    def test_exact_pr_and_push_refs_and_invalid_events(self):
        base, head = 'a' * 40, 'b' * 40
        self.assertEqual(scope.comparison('pull_request', {'pull_request': {'base': {'sha': base}, 'head': {'sha': head}}}), (base, head))
        self.assertEqual(scope.comparison('push', {'before': base, 'after': head}), (base, head))
        for name, event in [('push', {'before': '0' * 40, 'after': head}),
                            ('push', {'before': '--invalid', 'after': head}),
                            ('pull_request', {}), ('workflow_dispatch', {})]:
            self.assertIsNone(scope.comparison(name, event))

    def test_missing_git_history_falls_back_to_full(self):
        with tempfile.TemporaryDirectory() as temp:
            event, output = Path(temp) / 'event.json', Path(temp) / 'output'
            event.write_text(json.dumps({'before': 'a' * 40, 'after': 'b' * 40}))
            with patch.dict(os.environ, {'FORCE_FULL': 'false', 'GITHUB_EVENT_NAME': 'push',
                    'GITHUB_EVENT_PATH': str(event), 'GITHUB_OUTPUT': str(output)}), \
                    patch.object(scope.subprocess, 'check_output', side_effect=subprocess.CalledProcessError(1, 'git')):
                scope.main()
            self.assertEqual(output.read_text(), 'full=true\n')

    def test_renamed_runtime_file_is_not_hidden(self):
        with tempfile.TemporaryDirectory() as temp:
            event, output = Path(temp) / 'event.json', Path(temp) / 'output'
            event.write_text(json.dumps({'before': 'a' * 40, 'after': 'b' * 40}))
            with patch.dict(os.environ, {'FORCE_FULL': 'false', 'GITHUB_EVENT_NAME': 'push',
                    'GITHUB_EVENT_PATH': str(event), 'GITHUB_OUTPUT': str(output)}), \
                    patch.object(scope.subprocess, 'check_output', return_value=b'src/runtime.ts\0docs/moved.md\0') as diff:
                scope.main()
            self.assertIn('--no-renames', diff.call_args.args[0])
            self.assertEqual(output.read_text(), 'full=true\n')
