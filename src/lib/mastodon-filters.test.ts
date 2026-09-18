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
   * Known limitation, pinned rather than endorsed: whole_word wraps the keyword
   * in \b...\b, and a word boundary cannot exist between two non-word
   * characters. So a whole-word keyword that starts or ends with punctuation
   * matches nothing at all — "c++" as a whole word never fires, while the same
   * keyword as a substring does. Worth revisiting; changing it changes what
   * people's existing filters hide.
   */
  it('whole_word keywords bounded by punctuation match nothing', () => {
    const wholeWord = buildFilterMatcher([filter({
      id: 'i2', keywords: [{ id: 'k', keyword: 'c++', whole_word: true }],
    })], 'home');
    expect(wholeWord('I write c++ daily')).toBeNull();

    const substring = buildFilterMatcher([filter({
      id: 'i3', keywords: [{ id: 'k', keyword: 'c++', whole_word: false }],
    })], 'home');
    expect(substring('I write c++ daily')).not.toBeNull();
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
