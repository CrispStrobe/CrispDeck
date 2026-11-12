"""Reuse completed source CI before any release builders consume runner time."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess


def git_tree(commit):
    return subprocess.check_output(['git', 'rev-parse', f'{commit}^{{tree}}'], text=True).strip()


def is_ancestor(commit, source):
    return subprocess.run(['git', 'merge-base', '--is-ancestor', commit, source], capture_output=True).returncode == 0


def select_receipt(source, runs, jobs_for, tree=git_tree, ancestor=is_ancestor):
    if not re.fullmatch(r'[0-9a-f]{40}', source):
        raise ValueError('A full release source SHA is required')
    source_tree = tree(source)
    for run in runs:
        commit = run.get('head_sha', '')
        if (run.get('status') != 'completed' or run.get('conclusion') != 'success' or
                run.get('path', '').split('@')[0] != '.github/workflows/ci.yml' or
                not re.fullmatch(r'[0-9a-f]{40}', commit)):
            continue
        # A PR commit is reusable only after it is merged into this source and
        # every tracked byte matches. Similar paths/versions are insufficient.
        if not ancestor(commit, source) or tree(commit) != source_tree:
            continue
        jobs = jobs_for(run['id'])
        required = {'Release guards and change scope', 'Required CI'}
        passed = {job.get('name') for job in jobs
                  if job.get('status') == 'completed' and job.get('conclusion') == 'success'}
        if not required.issubset(passed):
            continue
        return {'source': source, 'validated_commit': commit, 'tree': source_tree,
                'ci_run_id': run['id'], 'ci_run_attempt': run.get('run_attempt'),
                'ci_url': run.get('html_url'), 'required_jobs': sorted(required)}
    raise ValueError('No successful CI receipt for this source. Complete its existing PR/main checks before release.')


def api(path):
    return json.loads(subprocess.check_output(['gh', 'api', path], text=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('--output', type=Path, default=Path('ci-receipt.json'))
    args = parser.parse_args()
    repo = os.environ['GITHUB_REPOSITORY']
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
        raise SystemExit('Invalid repository identity')
    # Prefer exact-source CI; then examine recent successful PR/main runs for
    # the same tree. Bounded reads fail closed rather than searching indefinitely.
    endpoint = f'repos/{repo}/actions/workflows/ci.yml/runs'
    runs = api(f'{endpoint}?head_sha={args.source}&status=success&per_page=30')['workflow_runs']
    runs += api(f'{endpoint}?status=success&per_page=100')['workflow_runs']

    def jobs_for(run):
        pages = json.loads(subprocess.check_output(['gh', 'api', '--paginate', '--slurp',
            f'repos/{repo}/actions/runs/{run}/jobs?filter=latest&per_page=100'], text=True))
        return [job for page in pages for job in page['jobs']]

    receipt = select_receipt(args.source, runs, jobs_for)
    args.output.write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt))


if __name__ == '__main__':
    main()
