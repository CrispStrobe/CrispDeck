"""Conservative CI selection: only known non-runtime paths may skip the matrix."""
import json
import os
from pathlib import Path
import re
import subprocess


def requires_full(paths):
    if not paths:
        return True
    for path in paths:
        allowed = (
            path.endswith('.md') and ('/' not in path or path.startswith('docs/'))
            or path in {'.github/workflows/ci.yml', 'scripts/ci_scope.py', 'scripts/test_ci_scope.py',
                        'tools/asc/metadata.json'}
            or path.startswith(('tools/release/', 'tools/asc/')) and path.endswith('.py')
            or path.startswith('tools/security/') and path.endswith('.mjs')
        )
        if not allowed:
            return True
    return False


def comparison(event_name, event):
    if event_name == 'pull_request':
        pr = event.get('pull_request', {})
        base, head = pr.get('base', {}).get('sha'), pr.get('head', {}).get('sha')
    elif event_name == 'push':
        base, head = event.get('before'), event.get('after')
    else:
        return None
    if not all(isinstance(sha, str) and re.fullmatch(r'[0-9a-f]{40}', sha) and sha != '0' * 40
               for sha in (base, head)):
        return None
    return base, head


def main():
    full = True
    if os.environ.get('FORCE_FULL', 'true') == 'false':
        try:
            event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
            refs = comparison(os.environ.get('GITHUB_EVENT_NAME'), event)
            if refs:
                # Renames must report both paths: moving runtime code into docs
                # must not hide a deletion from the matrix selection.
                raw = subprocess.check_output(['git', 'diff', '--no-renames', '--name-only', '-z', *refs, '--'])
                full = requires_full([p.decode('utf-8') for p in raw.split(b'\0') if p])
        except (KeyError, OSError, ValueError, TypeError, AttributeError, subprocess.CalledProcessError):
            full = True  # Missing/shallow history and malformed events fail closed.
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f'full={str(full).lower()}\n')
    print('Full runtime matrix required' if full else 'Non-runtime change: release/security guards required')


if __name__ == '__main__':
    main()
