#!/usr/bin/env python3
"""Select one final release package, never Gradle's unsigned intermediates."""
import argparse
from pathlib import Path


def find_artifact(root, kind):
    root = Path(root)
    if kind == 'apk':
        candidates = [path for path in root.glob('**/build/outputs/apk/**/release/*.apk')
                      if not path.name.endswith('-unsigned.apk')]
    elif kind == 'aab':
        candidates = [path for path in root.glob('**/build/outputs/bundle/*/*.aab')
                      if path.parent.name.lower().endswith('release')]
    else:
        raise ValueError(f'Unsupported Android package: {kind}')
    if len(candidates) != 1:
        raise ValueError(f'Expected one final release {kind.upper()}, found {len(candidates)}: {candidates}')
    return candidates[0]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=('apk', 'aab'))
    parser.add_argument('root', nargs='?', default='src-tauri/gen/android')
    args = parser.parse_args()
    print(find_artifact(args.root, args.kind))
