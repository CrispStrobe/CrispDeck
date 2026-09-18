/**
 * Guard: a test file should exercise application code.
 *
 * A large part of this suite asserts against fixtures declared inside the test
 * file itself — a local copy of the nav items, a local DeckColumnConfig, a
 * local reimplementation of the filter matcher. Those tests pass whatever the
 * app does, so the headline test count overstates the safety net. The worst
 * case found was mastodon-filters.test.ts, which reimplemented
 * buildKeywordMatcher/matchesFilter/applyFilters and never touched the module
 * of the same name; it has since been rebound to the real one.
 *
 * Fixing them all means extracting logic that currently lives inline in
 * .svelte files, which is a refactor rather than a test change. This pins the
 * known set instead: the list may shrink, never grow. If a file here gains real
 * imports, delete its entry.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/** Matches a whole import statement, including multi-line named imports. */
const IMPORT = /import\s+(?:type\s+)?[\s\S]*?from\s*['"]([^'"]+)['"]/g;
const APP = /^(\.\.?\/|\$lib\/|\$app\/)/;

function exercisesAppCode(src: string): boolean {
  IMPORT.lastIndex = 0;
  for (const m of src.matchAll(IMPORT)) {
    if (APP.test(m[1])) return true;
  }
  if (/await\s+import\(\s*['"](\.\.?\/|\$lib\/)/.test(src)) return true;  // dynamic
  if (/vi\.mock\(\s*['"](\.\.?\/|\$lib\/)/.test(src)) return true;        // mocked module
  if (src.includes('readFileSync')) return true;                          // source-reading guard
  return false;
}

/**
 * Known offenders. Each asserts against fixtures declared in the test file,
 * so it cannot fail when the corresponding app code breaks.
 */
const ACCEPTED = new Set([
  'src/lib/api/bluesky.live.test.ts',
  'src/lib/api/bluesky.pds.unit.test.ts',
  'src/lib/archive.test.ts',
  'src/lib/deck-keyboard.test.ts',
  'src/lib/deck.test.ts',
  'src/lib/delayed-spinner.test.ts',
  'src/lib/engagement-history.test.ts',
  'src/lib/fixes.test.ts',
  'src/lib/homepage.test.ts',
  'src/lib/layout.test.ts',
  'src/lib/messages.test.ts',
  'src/lib/new-column-types.test.ts',
  'src/lib/offline-feed-wiring.test.ts',
  'src/lib/perf-optimizations.test.ts',
  'src/lib/quick-schedule.test.ts',
  'src/lib/scroll-lock.test.ts',
  'src/lib/search-operators.test.ts',
  'src/lib/streaming-columns.test.ts',
]);

describe('tests exercise application code', () => {
  const files = walk('src').map((f) => f.replace(/\\/g, '/'));

  it('no new test file asserts only against its own fixtures', () => {
    const offenders = files.filter(
      (f) => !exercisesAppCode(readFileSync(f, 'utf8')) && !ACCEPTED.has(f)
    );
    expect(offenders).toEqual([]);
  });

  it('the accepted list has no stale entries', () => {
    // A file that has since been rebound, or deleted, should leave the list.
    const stale = [...ACCEPTED].filter(
      (f) => !files.includes(f) || exercisesAppCode(readFileSync(f, 'utf8'))
    );
    expect(stale).toEqual([]);
  });

  it('most of the suite does exercise application code', () => {
    const real = files.filter((f) => exercisesAppCode(readFileSync(f, 'utf8')));
    expect(real.length).toBeGreaterThan(files.length / 2);
  });
});
