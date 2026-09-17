import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// Plain .mjs build tooling; svelte-check reads its JSDoc types.
import { checkBudget } from '../../bench/check-budget.mjs';

/**
 * Tests for the guard, not for the bundle.
 *
 * The guard protects a result that is easy to undo by accident: one value
 * import of @atproto/api in a shared module puts 221 KB back on the critical
 * path of every route, and nothing else in CI would notice. A guard that
 * cannot fail is worse than no guard, because it reads as evidence.
 */

const BUDGET = JSON.parse(readFileSync('bench/bundle-budget.json', 'utf8'));

function report(over: Partial<Record<string, unknown>> = {}) {
  return {
    entryGzip: 67_000,
    entryPackages: ['svelte', '@sveltejs/kit'],
    routes: [
      { route: '/deck', extraGzip: 72_000, eagerPackages: ['@lucide/svelte', 'dompurify'] },
      { route: '/feed', extraGzip: 56_000, eagerPackages: ['dompurify'] }
    ],
    ...over
  };
}

describe('bundle budget guard', () => {
  it('passes a build shaped like the current one', () => {
    expect(checkBudget(report(), BUDGET)).toEqual([]);
  });

  it('fails when a must-stay-lazy package returns to a route', () => {
    const r = report();
    r.routes[0].eagerPackages.push('@atproto/api');
    const failures = checkBudget(r, BUDGET);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('@atproto/api');
    expect(failures[0]).toContain('/deck');
  });

  it('names every offending route, not just the first', () => {
    const r = report();
    r.routes[0].eagerPackages.push('zod');
    r.routes[1].eagerPackages.push('zod');
    const [msg] = checkBudget(r, BUDGET);
    expect(msg).toContain('2 route(s)');
    expect(msg).toContain('/deck');
    expect(msg).toContain('/feed');
  });

  it('calls out the entry separately — it is the worse case', () => {
    const failures = checkBudget(
      report({ entryPackages: ['svelte', '@atproto/api'] }),
      BUDGET
    );
    expect(failures[0]).toContain('every visitor');
  });

  it('fails when the heaviest route exceeds its ceiling', () => {
    const failures = checkBudget(
      report({ routes: [{ route: '/deck', extraGzip: 300_000, eagerPackages: ['dompurify'] }] }),
      BUDGET
    );
    expect(failures.some((f: string) => f.includes('/deck') && f.includes('budget'))).toBe(true);
  });

  it('fails when the entry exceeds its ceiling', () => {
    const failures = checkBudget(report({ entryGzip: 200_000 }), BUDGET);
    expect(failures.some((f: string) => f.includes('entry is'))).toBe(true);
  });

  it('refuses to pass vacuously when the package map is missing', () => {
    // The dangerous case: without BENCH_CHUNK_MAP every closure looks empty,
    // so every must-stay-lazy check would trivially pass and the job would go
    // green having verified nothing at all.
    const failures = checkBudget(
      { entryGzip: 67_000, routes: [{ route: '/deck', extraGzip: 72_000 }] },
      BUDGET
    );
    expect(failures.some((f: string) => f.includes('vacuous'))).toBe(true);
  });

  it('fails when there are no routes to check', () => {
    const failures = checkBudget({ entryGzip: 67_000, routes: [] }, BUDGET);
    expect(failures.some((f: string) => f.includes('no routes'))).toBe(true);
  });

  it('the shipped budget actually lists the SDK it was written for', () => {
    expect(BUDGET.mustStayLazy).toContain('@atproto/api');
    expect(BUDGET.maxRouteGzip).toBeGreaterThan(0);
  });
});
