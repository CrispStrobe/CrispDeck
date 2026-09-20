import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Live suites must be opt-in.
 *
 * They hit real Bluesky, Mastodon and PLC endpoints, which is exactly why
 * they are valuable — they catch a third-party API changing shape under us in
 * a way no fixture ever will. It is also why they do not belong in a required
 * pull-request check: mastodon.social timing out at 15 seconds had already
 * turned a run red twice with nothing wrong in the repository, and a check
 * that is red for reasons outside the change is a check people learn to
 * ignore.
 *
 * The Live APIs workflow runs them nightly and on demand with CRISPDECK_LIVE
 * set. This guard keeps a new one from quietly joining the PR path.
 */

const ENV_FLAG = 'CRISPDECK_LIVE';

/** Endpoints that mean a test talks to something outside this repository. */
const REAL_HOSTS = [
  'public.api.bsky.app',
  'bsky.social',
  'plc.directory',
  'mastodon.social',
  'graph.threads.net',
];

function testFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) testFiles(path, out);
    else if (name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

/**
 * Does this file actually issue a request, rather than just name a host?
 *
 * Constructing a client is not a request: bluesky.unit.test.ts and
 * client-factory.test.ts both build clients and never call out, and an
 * earlier version of this check flagged all three for `new BlueskyClient(`
 * alone. Only a call that fetches counts.
 */
function hitsTheNetwork(src: string): boolean {
  const namesHost = REAL_HOSTS.some((h) => src.includes(h));
  if (!namesHost) return false;
  // A fixture can mention a host in sample data without ever calling out.
  const stubsFetch = /vi\.stubGlobal\(\s*['"]fetch['"]/.test(src) || /vi\.mock\(/.test(src);
  const calls =
    /await fetch\(|\bfetchOk\(|\bfetchJson\(|resolvePds\(|listRecords\(/.test(src) ||
    /\.(getProfile|getAuthorFeed|searchActors|getAccountByHandle|getAccountStatuses|getPostThread|addToList)\(/.test(src);
  return calls && !stubsFetch;
}

/**
 * Any env gate counts, not only ours: threads.live.test.ts predates this and
 * is gated on THREADS_ACCESS_TOKEN, which is the same promise — it cannot run
 * unless someone deliberately supplies something.
 */
const GATES = [ENV_FLAG, 'THREADS_ACCESS_TOKEN'];
const isEnvGated = (src: string) => GATES.some((g) => src.includes(g));

/** Is every describe in the file gated on the env flag? */
function isGated(src: string): boolean {
  const ungated = (src.match(/^describe\(/gm) ?? []).length;
  return src.includes(ENV_FLAG) && ungated === 0;
}

describe('live suites are opt-in', () => {
  const files = testFiles('src');

  it('finds the test files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('every suite that talks to a real service is gated', () => {
    const offenders = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      // A file may keep offline describes alongside gated ones; only flag a
      // file that reaches the network with no gate at all.
      return hitsTheNetwork(src) && !isEnvGated(src);
    });
    expect(
      offenders,
      `gate these behind ${ENV_FLAG} and add them to .github/workflows/live.yml:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the nightly workflow runs every gated suite', () => {
    // A suite that is gated but listed nowhere never runs at all, which is
    // worse than running it in PR CI: it looks like coverage and is not.
    const workflow = readFileSync('.github/workflows/live.yml', 'utf8');
    const gated = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return src.includes(ENV_FLAG) && /describe\.skipIf\(!LIVE\)/.test(src);
    });
    expect(gated.length).toBeGreaterThan(0);

    const missing = gated.filter((f) => !workflow.includes(f.replace(/\\/g, '/')));
    expect(missing, `gated but never run:\n${missing.join('\n')}`).toEqual([]);
  });

  it('the flag is not baked into the default test setup', () => {
    // If CRISPDECK_LIVE were set in the shared config, the suites would be
    // back in the PR path without anyone choosing that.
    //
    // Checked by reading the config rather than by reading process.env: the
    // nightly workflow sets the flag on purpose, and an env assertion would
    // fail there — a guard that goes red on the one run it is meant to
    // protect teaches people to ignore it.
    for (const file of ['vite.config.js', 'vitest.setup.ts', 'package.json']) {
      expect(readFileSync(file, 'utf8'), `${file} sets ${ENV_FLAG}`).not.toContain(ENV_FLAG);
    }
  });

  it('only the live workflow turns the flag on', () => {
    const workflows = readdirSync('.github/workflows').filter((f) => f.endsWith('.yml'));
    const setters = workflows.filter((f) =>
      readFileSync(join('.github/workflows', f), 'utf8').includes(ENV_FLAG),
    );
    expect(setters).toEqual(['live.yml']);
  });
});

describe('hitsTheNetwork', () => {
  it('flags a suite that calls a real host', () => {
    expect(hitsTheNetwork(`await fetch('https://mastodon.social/api/v2/instance')`)).toBe(true);
  });

  it('ignores a fixture that merely names a host', () => {
    expect(hitsTheNetwork(`const post = { uri: 'https://bsky.social/x' };`)).toBe(false);
  });

  it('ignores a suite that stubs fetch', () => {
    expect(
      hitsTheNetwork(`vi.stubGlobal('fetch', vi.fn());\nawait fetch('https://mastodon.social/x')`),
    ).toBe(false);
  });

  it('does not treat constructing a client as a request', () => {
    // Three unit suites build clients against real-looking hosts and never
    // call out; an earlier version of this check flagged all of them.
    expect(hitsTheNetwork(`const c = new BlueskyClient('https://bsky.social');`)).toBe(false);
  });
});
