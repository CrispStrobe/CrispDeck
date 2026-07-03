/**
 * Tests for Mastodon server-side filter logic (v2 API filter matching).
 * These tests cover the client-side filter application that mirrors
 * Mastodon's server-side v2 filter behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Types mirroring Mastodon v2 filter API ─────────────────────────────────

type FilterAction = 'warn' | 'hide';
type FilterContext = 'home' | 'notifications' | 'public' | 'thread' | 'account';

interface FilterKeyword {
  id: string;
  keyword: string;
  whole_word: boolean;
}

interface MastodonFilter {
  id: string;
  title: string;
  context: FilterContext[];
  filter_action: FilterAction;
  keywords: FilterKeyword[];
  expires_at: string | null;
}

// ── Filter matching logic (mirrors server-side behavior) ───────────────────

function buildKeywordMatcher(kw: FilterKeyword): (text: string) => boolean {
  if (kw.whole_word) {
    try {
      const re = new RegExp(`\\b${kw.keyword}\\b`, 'i');
      return (text: string) => re.test(text);
    } catch {
      const lower = kw.keyword.toLowerCase();
      return (text: string) => text.toLowerCase().includes(lower);
    }
  }
  const lower = kw.keyword.toLowerCase();
  return (text: string) => text.toLowerCase().includes(lower);
}

function matchesFilter(text: string, filter: MastodonFilter, context: FilterContext): boolean {
  if (!filter.context.includes(context)) return false;
  if (filter.expires_at && new Date(filter.expires_at) < new Date()) return false;
  if (filter.keywords.length === 0) return false;
  return filter.keywords.some(kw => buildKeywordMatcher(kw)(text));
}

function applyFilters(
  text: string,
  filters: MastodonFilter[],
  context: FilterContext
): { action: FilterAction | null; matchedFilters: MastodonFilter[] } {
  const matched = filters.filter(f => matchesFilter(text, f, context));
  if (matched.length === 0) return { action: null, matchedFilters: [] };
  // 'hide' takes precedence over 'warn'
  const action = matched.some(f => f.filter_action === 'hide') ? 'hide' : 'warn';
  return { action, matchedFilters: matched };
}

// ── Filter cache ───────────────────────────────────────────────────────────

let _filterCache: { filters: MastodonFilter[]; fetchedAt: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function setCachedFilters(filters: MastodonFilter[]): void {
  _filterCache = { filters, fetchedAt: Date.now() };
}

function getCachedFilters(): MastodonFilter[] | null {
  if (!_filterCache) return null;
  if (Date.now() - _filterCache.fetchedAt > CACHE_TTL) {
    _filterCache = null;
    return null;
  }
  return _filterCache.filters;
}

function invalidateFilterCache(): void {
  _filterCache = null;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Mastodon server-side filters', () => {
  beforeEach(() => {
    invalidateFilterCache();
  });

  const makeFilter = (overrides: Partial<MastodonFilter> = {}): MastodonFilter => ({
    id: 'f1',
    title: 'Test Filter',
    context: ['home'],
    filter_action: 'warn',
    keywords: [{ id: 'kw1', keyword: 'spoiler', whole_word: false }],
    expires_at: null,
    ...overrides,
  });

  describe('keyword matching', () => {
    it('matches substring when whole_word is false', () => {
      const kw: FilterKeyword = { id: 'k1', keyword: 'test', whole_word: false };
      const matcher = buildKeywordMatcher(kw);
      expect(matcher('this is a test post')).toBe(true);
      expect(matcher('testing 123')).toBe(true);
      expect(matcher('contest results')).toBe(true);
    });

    it('matches only whole words when whole_word is true', () => {
      const kw: FilterKeyword = { id: 'k1', keyword: 'test', whole_word: true };
      const matcher = buildKeywordMatcher(kw);
      expect(matcher('this is a test post')).toBe(true);
      expect(matcher('testing 123')).toBe(false);
      expect(matcher('contest results')).toBe(false);
    });

    it('is case-insensitive for both modes', () => {
      const substring: FilterKeyword = { id: 'k1', keyword: 'Hello', whole_word: false };
      const wholeWord: FilterKeyword = { id: 'k2', keyword: 'Hello', whole_word: true };
      expect(buildKeywordMatcher(substring)('HELLO WORLD')).toBe(true);
      expect(buildKeywordMatcher(substring)('say hello')).toBe(true);
      expect(buildKeywordMatcher(wholeWord)('HELLO there')).toBe(true);
      expect(buildKeywordMatcher(wholeWord)('say hello!')).toBe(true);
    });

    it('handles unicode text', () => {
      const kw: FilterKeyword = { id: 'k1', keyword: 'cafe', whole_word: false };
      const matcher = buildKeywordMatcher(kw);
      expect(matcher('visit the cafe today')).toBe(true);
      // unicode variant won't match plain ASCII
      expect(matcher('visit the caf\u00e9 today')).toBe(false);
    });

    it('handles unicode keyword', () => {
      const kw: FilterKeyword = { id: 'k1', keyword: '\u00fc\u00f6\u00e4', whole_word: false };
      const matcher = buildKeywordMatcher(kw);
      expect(matcher('German umlauts: \u00fc\u00f6\u00e4')).toBe(true);
      expect(matcher('no match here')).toBe(false);
    });

    it('handles regex special chars in keyword gracefully', () => {
      // whole_word uses RegExp, so special chars need to not crash
      const kw: FilterKeyword = { id: 'k1', keyword: 'c++', whole_word: true };
      const matcher = buildKeywordMatcher(kw);
      // The regex may fail to compile due to unescaped +, falls back to includes
      expect(matcher('I love c++')).toBe(true);
    });

    it('matches mixed whole-word and non-whole-word keywords', () => {
      const filter = makeFilter({
        keywords: [
          { id: 'k1', keyword: 'spoiler', whole_word: true },
          { id: 'k2', keyword: 'nsfw', whole_word: false },
        ],
      });
      // whole-word 'spoiler' should not match 'spoilers' (no nsfw either)
      expect(matchesFilter('spoilers ahead', filter, 'home')).toBe(false);
      // exact whole word 'spoiler' should match
      expect(matchesFilter('this is a spoiler warning', filter, 'home')).toBe(true);
      expect(matchesFilter('nsfw content here', filter, 'home')).toBe(true); // substring match
      expect(matchesFilter('nsfwcontent', filter, 'home')).toBe(true); // substring match (not whole word)
      expect(matchesFilter('safe content about spoilers', filter, 'home')).toBe(false); // 'spoilers' != whole word 'spoiler', no nsfw
    });
  });

  describe('filter context matching', () => {
    it('applies filter only in matching context', () => {
      const filter = makeFilter({ context: ['home'] });
      expect(matchesFilter('spoiler alert', filter, 'home')).toBe(true);
      expect(matchesFilter('spoiler alert', filter, 'notifications')).toBe(false);
      expect(matchesFilter('spoiler alert', filter, 'public')).toBe(false);
    });

    it('applies filter in multiple contexts', () => {
      const filter = makeFilter({ context: ['home', 'public', 'thread'] });
      expect(matchesFilter('spoiler alert', filter, 'home')).toBe(true);
      expect(matchesFilter('spoiler alert', filter, 'public')).toBe(true);
      expect(matchesFilter('spoiler alert', filter, 'thread')).toBe(true);
      expect(matchesFilter('spoiler alert', filter, 'notifications')).toBe(false);
      expect(matchesFilter('spoiler alert', filter, 'account')).toBe(false);
    });

    it('supports all 5 filter contexts', () => {
      const allContexts: FilterContext[] = ['home', 'notifications', 'public', 'thread', 'account'];
      const filter = makeFilter({ context: allContexts });
      for (const ctx of allContexts) {
        expect(matchesFilter('spoiler alert', filter, ctx)).toBe(true);
      }
    });
  });

  describe('filter expiry', () => {
    it('ignores expired filters', () => {
      const expired = makeFilter({
        expires_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      });
      expect(matchesFilter('spoiler alert', expired, 'home')).toBe(false);
    });

    it('applies non-expired filters', () => {
      const active = makeFilter({
        expires_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
      });
      expect(matchesFilter('spoiler alert', active, 'home')).toBe(true);
    });

    it('applies filters with no expiry (null)', () => {
      const permanent = makeFilter({ expires_at: null });
      expect(matchesFilter('spoiler alert', permanent, 'home')).toBe(true);
    });
  });

  describe('filter with empty keyword list', () => {
    it('never matches when keywords array is empty', () => {
      const filter = makeFilter({ keywords: [] });
      expect(matchesFilter('anything at all', filter, 'home')).toBe(false);
      expect(matchesFilter('spoiler', filter, 'home')).toBe(false);
      expect(matchesFilter('', filter, 'home')).toBe(false);
    });
  });

  describe('filter actions', () => {
    it('returns warn action', () => {
      const filter = makeFilter({ filter_action: 'warn' });
      const result = applyFilters('spoiler alert', [filter], 'home');
      expect(result.action).toBe('warn');
      expect(result.matchedFilters).toHaveLength(1);
    });

    it('returns hide action', () => {
      const filter = makeFilter({ filter_action: 'hide' });
      const result = applyFilters('spoiler alert', [filter], 'home');
      expect(result.action).toBe('hide');
    });

    it('hide takes precedence over warn when both match', () => {
      const warnFilter = makeFilter({ id: 'f1', filter_action: 'warn' });
      const hideFilter = makeFilter({
        id: 'f2',
        filter_action: 'hide',
        keywords: [{ id: 'k2', keyword: 'spoiler', whole_word: false }],
      });
      const result = applyFilters('spoiler alert', [warnFilter, hideFilter], 'home');
      expect(result.action).toBe('hide');
      expect(result.matchedFilters).toHaveLength(2);
    });

    it('returns null action when no filters match', () => {
      const filter = makeFilter();
      const result = applyFilters('clean content', [filter], 'home');
      expect(result.action).toBeNull();
      expect(result.matchedFilters).toHaveLength(0);
    });

    it('returns null action when context does not match', () => {
      const filter = makeFilter({ context: ['public'] });
      const result = applyFilters('spoiler alert', [filter], 'home');
      expect(result.action).toBeNull();
    });
  });

  describe('multiple filters', () => {
    it('applies multiple independent filters', () => {
      const filters = [
        makeFilter({ id: 'f1', keywords: [{ id: 'k1', keyword: 'spoiler', whole_word: false }] }),
        makeFilter({ id: 'f2', keywords: [{ id: 'k2', keyword: 'nsfw', whole_word: false }] }),
      ];
      expect(applyFilters('spoiler warning', filters, 'home').matchedFilters).toHaveLength(1);
      expect(applyFilters('nsfw content', filters, 'home').matchedFilters).toHaveLength(1);
      expect(applyFilters('spoiler nsfw', filters, 'home').matchedFilters).toHaveLength(2);
      expect(applyFilters('clean post', filters, 'home').matchedFilters).toHaveLength(0);
    });
  });

  describe('filter cache', () => {
    it('returns null when cache is empty', () => {
      expect(getCachedFilters()).toBeNull();
    });

    it('stores and retrieves filters', () => {
      const filters = [makeFilter()];
      setCachedFilters(filters);
      const cached = getCachedFilters();
      expect(cached).toEqual(filters);
    });

    it('invalidateFilterCache clears cache', () => {
      setCachedFilters([makeFilter()]);
      expect(getCachedFilters()).not.toBeNull();
      invalidateFilterCache();
      expect(getCachedFilters()).toBeNull();
    });

    it('returns null after TTL expiry', () => {
      setCachedFilters([makeFilter()]);
      expect(getCachedFilters()).not.toBeNull();

      // Advance time past TTL (5 minutes)
      vi.useFakeTimers();
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      expect(getCachedFilters()).toBeNull();
      vi.useRealTimers();
    });

    it('returns filters before TTL expiry', () => {
      vi.useFakeTimers();
      const filters = [makeFilter()];
      setCachedFilters(filters);

      // Advance less than TTL
      vi.advanceTimersByTime(4 * 60 * 1000);
      expect(getCachedFilters()).toEqual(filters);
      vi.useRealTimers();
    });

    it('setCachedFilters replaces previous cache', () => {
      const first = [makeFilter({ id: 'f1' })];
      const second = [makeFilter({ id: 'f2' })];
      setCachedFilters(first);
      setCachedFilters(second);
      const cached = getCachedFilters();
      expect(cached).toHaveLength(1);
      expect(cached![0].id).toBe('f2');
    });
  });
});
