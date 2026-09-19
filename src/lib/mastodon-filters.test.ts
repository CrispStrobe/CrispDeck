/**
 * Tests for Mastodon server-side filters (v2 API).
 *
 * These previously declared their own FilterKeyword/MastodonFilter types and
 * local buildKeywordMatcher/matchesFilter/applyFilters/cache functions, and
 * asserted against those — so they passed no matter what ./mastodon-filters
 * actually did. They now exercise the real module.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  isFilterExpired,
  buildFilterMatcher,
  getCachedFilters,
  setCachedFilters,
  invalidateFilterCache,
  type MastodonFilter,
  type FilterContext,
} from './mastodon-filters';

function filter(over: Partial<MastodonFilter> = {}): MastodonFilter {
  return {
    id: '1',
    title: 'Spoilers',
    context: ['home'],
    expires_at: null,
    filter_action: 'warn',
    keywords: [{ id: 'k1', keyword: 'spoiler', whole_word: false }],
    ...over,
  };
}

const INSTANCE = 'https://mastodon.social';

beforeEach(() => {
  invalidateFilterCache();
  // Matcher compilation is memoised on module state; vary filter ids per test
  // where it matters rather than reaching into that cache.
});
afterEach(() => vi.useRealTimers());

describe('isFilterExpired', () => {
  it('a filter with no expiry never expires', () => {
    expect(isFilterExpired(filter({ expires_at: null }))).toBe(false);
  });

  it('a past expiry is expired', () => {
    expect(isFilterExpired(filter({ expires_at: '2020-01-01T00:00:00.000Z' }))).toBe(true);
  });

  it('a future expiry is not expired', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isFilterExpired(filter({ expires_at: future }))).toBe(false);
  });

  it('expiry exactly now counts as expired', () => {
    vi.useFakeTimers();
    const now = new Date('2026-01-10T12:00:00.000Z');
    vi.setSystemTime(now);
    expect(isFilterExpired(filter({ expires_at: now.toISOString() }))).toBe(true);
  });
});

describe('buildFilterMatcher — matching', () => {
  it('matches a substring keyword, case-insensitively', () => {
    const match = buildFilterMatcher([filter({ id: 'a' })], 'home');
    expect(match('contains a SPOILER here')).toEqual({ action: 'warn', title: 'Spoilers' });
  });

  it('returns null when nothing matches', () => {
    const match = buildFilterMatcher([filter({ id: 'b' })], 'home');
    expect(match('nothing of note')).toBeNull();
  });

  it('whole_word does not match inside a longer word', () => {
    const match = buildFilterMatcher([filter({
      id: 'c', keywords: [{ id: 'k', keyword: 'cat', whole_word: true }],
    })], 'home');
    expect(match('the cat sat')).not.toBeNull();
    expect(match('concatenate')).toBeNull();
  });

  it('a substring keyword does match inside a longer word', () => {
    const match = buildFilterMatcher([filter({
      id: 'd', keywords: [{ id: 'k', keyword: 'cat', whole_word: false }],
    })], 'home');
    expect(match('concatenate')).not.toBeNull();
  });

  it('matches if any keyword in the filter hits', () => {
    const match = buildFilterMatcher([filter({
      id: 'e',
      keywords: [
        { id: 'k1', keyword: 'alpha', whole_word: false },
        { id: 'k2', keyword: 'beta', whole_word: false },
      ],
    })], 'home');
    expect(match('mentions beta only')).not.toBeNull();
  });

  it('returns the first matching filter when several apply', () => {
    const match = buildFilterMatcher([
      filter({ id: 'f1', title: 'First', keywords: [{ id: 'k', keyword: 'x', whole_word: false }] }),
      filter({ id: 'f2', title: 'Second', keywords: [{ id: 'k', keyword: 'x', whole_word: false }] }),
    ], 'home');
    expect(match('x')).toMatchObject({ title: 'First' });
  });

  it('carries the filter action through', () => {
    const match = buildFilterMatcher([filter({ id: 'g', filter_action: 'hide' })], 'home');
    expect(match('spoiler')).toEqual({ action: 'hide', title: 'Spoilers' });
  });

  /** Keywords come from user input and must not be able to break the regex. */
  it('treats regex metacharacters in a keyword literally', () => {
    const match = buildFilterMatcher([filter({
      id: 'h', keywords: [{ id: 'k', keyword: 'c++', whole_word: false }],
    })], 'home');
    expect(match('I write c++ daily')).not.toBeNull();
    expect(match('I write cccc daily')).toBeNull();
  });

  it('never throws on a keyword full of metacharacters', () => {
    const match = buildFilterMatcher([filter({
      id: 'i', keywords: [{ id: 'k', keyword: '[unclosed(', whole_word: true }],
    })], 'home');
    expect(() => match('[unclosed(')).not.toThrow();
  });

  /**
   * whole_word used to wrap the keyword in \b...\b. A word boundary cannot
   * exist between two non-word characters, so a keyword starting or ending with
   * punctuation matched nothing at all — "c++" as a whole word never fired.
   * The boundary is now required only on an edge where the keyword has a word
   * character, which is Mastodon's own rule.
   */
  it('whole_word matches a keyword that ends in punctuation', () => {
    const match = buildFilterMatcher([filter({
      id: 'i2', keywords: [{ id: 'k', keyword: 'c++', whole_word: true }],
    })], 'home');
    expect(match('I write c++ daily')).not.toBeNull();
    expect(match('I write c daily')).toBeNull();
  });

  it('whole_word matches a keyword that starts with punctuation', () => {
    const match = buildFilterMatcher([filter({
      id: 'i3', keywords: [{ id: 'k', keyword: '$AAPL', whole_word: true }],
    })], 'home');
    expect(match('buying $AAPL today')).not.toBeNull();
    // The keyword still has to be present in full.
    expect(match('buying AAPL today')).toBeNull();
    // Its leading edge is '$', a non-word character, so nothing is required of
    // what precedes it — unlike the trailing 'L', which is still guarded.
    expect(match('ticker:$AAPL')).not.toBeNull();
    expect(match('$AAPLX')).toBeNull();
  });

  it('still refuses to match inside a longer word on a guarded edge', () => {
    const match = buildFilterMatcher([filter({
      id: 'i4', keywords: [{ id: 'k', keyword: 'cat', whole_word: true }],
    })], 'home');
    expect(match('the cat sat')).not.toBeNull();
    expect(match('concatenate')).toBeNull();
    expect(match('cats')).toBeNull();
    expect(match('bobcat')).toBeNull();
  });

  it('finds a later occurrence when the first is inside a word', () => {
    const match = buildFilterMatcher([filter({
      id: 'i5', keywords: [{ id: 'k', keyword: 'cat', whole_word: true }],
    })], 'home');
    expect(match('concatenate, then the cat')).not.toBeNull();
  });

  it('matches at the very start and very end of the text', () => {
    const match = buildFilterMatcher([filter({
      id: 'i6', keywords: [{ id: 'k', keyword: 'cat', whole_word: true }],
    })], 'home');
    expect(match('cat')).not.toBeNull();
    expect(match('cat sat')).not.toBeNull();
    expect(match('the cat')).not.toBeNull();
  });

  it('treats non-latin scripts as word characters', () => {
    const match = buildFilterMatcher([filter({
      id: 'i7', keywords: [{ id: 'k', keyword: 'テスト', whole_word: true }],
    })], 'home');
    expect(match('これは テスト です')).not.toBeNull();
    expect(match('テストケース')).toBeNull();  // inside a longer run of word chars
  });

  it('is case-insensitive for whole words too', () => {
    const match = buildFilterMatcher([filter({
      id: 'i8', keywords: [{ id: 'k', keyword: 'Spoiler', whole_word: true }],
    })], 'home');
    expect(match('a SPOILER here')).not.toBeNull();
  });

  it('an empty keyword matches nothing rather than everything', () => {
    const match = buildFilterMatcher([filter({
      id: 'i9', keywords: [{ id: 'k', keyword: '', whole_word: true }],
    })], 'home');
    expect(match('any text at all')).toBeNull();
  });
});

describe('buildFilterMatcher — applicability', () => {
  it('ignores filters for another context', () => {
    const match = buildFilterMatcher([filter({ id: 'j', context: ['notifications'] })], 'home');
    expect(match('spoiler')).toBeNull();
  });

  it('applies a filter listed for several contexts', () => {
    const f = filter({ id: 'k', context: ['home', 'public'] as FilterContext[] });
    expect(buildFilterMatcher([f], 'home')('spoiler')).not.toBeNull();
    expect(buildFilterMatcher([f], 'public')('spoiler')).not.toBeNull();
    expect(buildFilterMatcher([f], 'thread')('spoiler')).toBeNull();
  });

  it('ignores expired filters', () => {
    const match = buildFilterMatcher([filter({
      id: 'l', expires_at: '2020-01-01T00:00:00.000Z',
    })], 'home');
    expect(match('spoiler')).toBeNull();
  });

  it('ignores filters with no keywords', () => {
    const match = buildFilterMatcher([filter({ id: 'm', keywords: [] })], 'home');
    expect(match('anything')).toBeNull();
  });

  it('an empty filter list matches nothing', () => {
    expect(buildFilterMatcher([], 'home')('anything')).toBeNull();
  });

  it('skips inapplicable filters but still applies the rest', () => {
    const match = buildFilterMatcher([
      filter({ id: 'n1', context: ['notifications'], title: 'Wrong context' }),
      filter({ id: 'n2', title: 'Right context',
               keywords: [{ id: 'k', keyword: 'target', whole_word: false }] }),
    ], 'home');
    expect(match('target')).toMatchObject({ title: 'Right context' });
  });
});

describe('filter cache', () => {
  it('returns null before anything is stored', () => {
    expect(getCachedFilters(INSTANCE)).toBeNull();
  });

  it('round-trips filters for an instance', () => {
    const filters = [filter({ id: 'c1' })];
    setCachedFilters(INSTANCE, filters);
    expect(getCachedFilters(INSTANCE)).toEqual(filters);
  });

  it('keeps instances separate', () => {
    setCachedFilters(INSTANCE, [filter({ id: 'c2', title: 'A' })]);
    setCachedFilters('https://other.example', [filter({ id: 'c3', title: 'B' })]);
    expect(getCachedFilters(INSTANCE)![0].title).toBe('A');
    expect(getCachedFilters('https://other.example')![0].title).toBe('B');
  });

  it('expires after the TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'));
    setCachedFilters(INSTANCE, [filter({ id: 'c4' })]);
    expect(getCachedFilters(INSTANCE)).not.toBeNull();

    vi.setSystemTime(new Date('2026-01-10T12:04:59.000Z'));
    expect(getCachedFilters(INSTANCE)).not.toBeNull();   // still inside 5 minutes

    vi.setSystemTime(new Date('2026-01-10T12:05:01.000Z'));
    expect(getCachedFilters(INSTANCE)).toBeNull();       // past it
  });

  it('invalidates one instance without touching the others', () => {
    setCachedFilters(INSTANCE, [filter({ id: 'c5' })]);
    setCachedFilters('https://other.example', [filter({ id: 'c6' })]);
    invalidateFilterCache(INSTANCE);
    expect(getCachedFilters(INSTANCE)).toBeNull();
    expect(getCachedFilters('https://other.example')).not.toBeNull();
  });

  it('invalidates everything when given no instance', () => {
    setCachedFilters(INSTANCE, [filter({ id: 'c7' })]);
    setCachedFilters('https://other.example', [filter({ id: 'c8' })]);
    invalidateFilterCache();
    expect(getCachedFilters(INSTANCE)).toBeNull();
    expect(getCachedFilters('https://other.example')).toBeNull();
  });
});
