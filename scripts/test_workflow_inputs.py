"""Regression checks for treating release inputs/secrets as data, not shell code."""
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest


WORKFLOWS = Path(__file__).resolve().parents[1] / '.github' / 'workflows'


def run_blocks(path):
    """Read this repository's indented run scalars without a YAML dependency."""
    lines = path.read_text().splitlines()
    name = ''
    for index, line in enumerate(lines):
        step = re.match(r'\s*- name: (.+)', line)
        if step:
            name = step.group(1)
        run = re.match(r'(\s*)run:\s*(.*)', line)
        if not run:
            continue
        indent, value = len(run.group(1)), run.group(2)
        if value.startswith(('|', '>')):
            block = []
            for following in lines[index + 1:]:
                if following.strip() and len(following) - len(following.lstrip()) <= indent:
                    break
                block.append(following[indent + 2:])
            yield name, '\n'.join(block)
        else:
            yield name, value


class WorkflowInputTests(unittest.TestCase):
    def test_no_dispatch_inputs_or_secrets_are_interpolated_into_shell_source(self):
        for path in WORKFLOWS.glob('*.yml'):
            for name, script in run_blocks(path):
                with self.subTest(workflow=path.name, step=name):
                    code = '\n'.join(line for line in script.splitlines() if not line.lstrip().startswith('#'))
                    self.assertNotRegex(code, r'\$\{\{\s*(?:secrets\.|inputs\.|github\.event\.inputs\.)',
                                        'Pass input through env and quote its expansion in the shell')

    def test_testflight_arguments_do_not_execute_shell_metacharacters_or_expand_globs(self):
        malicious_build = 'a"; touch workflow-input-executed; #'
        malicious_tester = '$(touch${IFS}workflow-input-executed)'
        arguments = self.run_testflight_step(
            INPUT_PLATFORM='ios', INPUT_DRY_RUN='false', INPUT_INTERNAL_ONLY='false',
            INPUT_BUILD_ID=malicious_build,
            INPUT_TESTERS=f'alice@example.test {malicious_tester} *@example.test\nsecond@example.test',
        )
        self.assertEqual(arguments, [
            'tools/asc/testflight.py', 'ios', '--build', malicious_build,
            '--tester', 'alice@example.test', '--tester', malicious_tester,
            '--tester', '*@example.test', '--tester', 'second@example.test',
        ])

    def test_testflight_optional_arguments_remain_optional(self):
        arguments = self.run_testflight_step(
            INPUT_PLATFORM='macos', INPUT_DRY_RUN='true', INPUT_INTERNAL_ONLY='true',
            INPUT_BUILD_ID='', INPUT_TESTERS='',
        )
        self.assertEqual(arguments, ['tools/asc/testflight.py', 'macos', '--dry-run', '--internal-only'])

    def run_testflight_step(self, **inputs):
        scripts = dict(run_blocks(WORKFLOWS / 'testflight.yml'))
        script = scripts['Distribute']
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            # Intercept the only external call; these tests never reach Apple.
            capture = root / 'arguments'
            wrapper = 'python3() { printf "%s\\0" "$@" > "$CRISPDECK_TEST_ARGUMENTS"; }\n'
            subprocess.run(['bash', '-c', wrapper + script], cwd=root,
                           env={**os.environ, **inputs, 'CRISPDECK_TEST_ARGUMENTS': str(capture)},
                           check=True, capture_output=True, text=True)
            self.assertFalse((root / 'workflow-input-executed').exists())
            return capture.read_bytes().decode().rstrip('\0').split('\0')


if __name__ == '__main__':
    unittest.main()
