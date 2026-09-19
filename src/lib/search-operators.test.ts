/**
 * Search quick-filter operators.
 *
 * This previously rebuilt each expression in the test body
 * (`(query.trim() + ' has:media').trim()`) and asserted the result, so it
 * passed whatever the search page did. The "documents from:handle — posts by a
 * user" cases were tautologies: they asserted that a string literal the test
 * had just written was truthy.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  appendOperator, fromMeOperator, pastWeekOperator, BLUESKY_SEARCH_OPERATORS,
} from './search-operators';

afterEach(() => vi.useRealTimers());

describe('appendOperator', () => {
  it('is the whole operator when the query is empty', () => {
    expect(appendOperator('', 'has:media')).toBe('has:media');
  });

  it('appends to an existing query', () => {
    expect(appendOperator('svelte', 'has:media')).toBe('svelte has:media');
  });

  it('collapses trailing whitespace rather than doubling the space', () => {
    expect(appendOperator('svelte  ', 'from:alice.bsky.social'))
      .toBe('svelte from:alice.bsky.social');
  });

  it('trims a leading space too', () => {
    expect(appendOperator('  svelte', 'lang:en')).toBe('svelte lang:en');
  });

  it('leaves a whitespace-only query with just the operator', () => {
    expect(appendOperator('   ', 'has:media')).toBe('has:media');
  });

  it('stacks operators as they are added', () => {
    let q = '';
    q = appendOperator(q, 'has:media');
    q = appendOperator(q, 'lang:en');
    q = appendOperator(q, 'from:alice.bsky.social');
    expect(q).toBe('has:media lang:en from:alice.bsky.social');
  });
});

describe('fromMeOperator', () => {
  it('builds from: for the signed-in handle', () => {
    expect(fromMeOperator('alice.bsky.social')).toBe('from:alice.bsky.social');
  });

  it('is null with no account, so the button does nothing', () => {
    expect(fromMeOperator(undefined)).toBeNull();
    expect(fromMeOperator(null)).toBeNull();
    expect(fromMeOperator('')).toBeNull();
  });
});

describe('pastWeekOperator', () => {
  it('is seven days before the given date', () => {
    expect(pastWeekOperator(new Date('2026-01-15T12:00:00.000Z'))).toBe('since:2026-01-08');
  });

  it('crosses a month boundary correctly', () => {
    expect(pastWeekOperator(new Date('2026-03-03T00:00:00.000Z'))).toBe('since:2026-02-24');
  });

  it('crosses a year boundary correctly', () => {
    expect(pastWeekOperator(new Date('2026-01-03T00:00:00.000Z'))).toBe('since:2025-12-27');
  });

  it('emits a plain date with no time component', () => {
    expect(pastWeekOperator(new Date('2026-06-20T23:59:59.000Z'))).toMatch(/^since:\d{4}-\d{2}-\d{2}$/);
  });

  it('does not mutate the date it was given', () => {
    const now = new Date('2026-01-15T12:00:00.000Z');
    pastWeekOperator(now);
    expect(now.toISOString()).toBe('2026-01-15T12:00:00.000Z');
  });

  it('defaults to today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T08:00:00.000Z'));
    expect(pastWeekOperator()).toBe('since:2026-05-03');
  });
});

describe('the documented Bluesky operators', () => {
  it('are all well-formed name:value pairs', () => {
    for (const { op } of BLUESKY_SEARCH_OPERATORS) {
      expect(op, op).toMatch(/^[a-z]+:.+$/);
    }
  });

  it('each carry a description', () => {
    for (const { op, desc } of BLUESKY_SEARCH_OPERATORS) {
      expect(desc.trim().length, op).toBeGreaterThan(0);
    }
  });

  it('have no duplicate operator names', () => {
    const names = BLUESKY_SEARCH_OPERATORS.map(({ op }) => op.split(':')[0]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('cover the filters the quick buttons produce', () => {
    const names = BLUESKY_SEARCH_OPERATORS.map(({ op }) => op.split(':')[0]);
    expect(names).toContain('has');    // Has media
    expect(names).toContain('from');   // From me
    expect(names).toContain('since');  // Past week
  });

  it('survive being appended to a query', () => {
    for (const { op } of BLUESKY_SEARCH_OPERATORS) {
      expect(appendOperator('svelte', op)).toBe(`svelte ${op}`);
    }
  });
});
