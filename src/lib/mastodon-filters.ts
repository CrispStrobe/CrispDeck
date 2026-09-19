/**
 * Mastodon server-side filters (v2 API).
 * Handles filter types, matching logic, and caching for efficient per-post evaluation.
 */

export type FilterContext = 'home' | 'notifications' | 'thread' | 'public' | 'account';

export interface MastodonFilterKeyword {
  id: string;
  keyword: string;
  whole_word: boolean;
}

export interface MastodonFilter {
  id: string;
  title: string;
  context: FilterContext[];
  expires_at: string | null;
  filter_action: 'warn' | 'hide';
  keywords: MastodonFilterKeyword[];
}

export interface CreateFilterParams {
  title: string;
  context: FilterContext[];
  filter_action: 'warn' | 'hide';
  expires_in?: number | null; // seconds until expiry, null = never
  keywords_attributes: { keyword: string; whole_word: boolean }[];
}

export interface FilterMatchResult {
  action: 'warn' | 'hide';
  title: string;
}

/** Check whether a filter has expired. Returns true if expired. */
export function isFilterExpired(filter: MastodonFilter): boolean {
  if (!filter.expires_at) return false;
  return new Date(filter.expires_at).getTime() <= Date.now();
}

/**
 * Build a filter matcher function for a given context.
 * Returns a function that checks text against all applicable filters.
 * Caches compiled matchers to avoid recompiling regexes on every call.
 */
let _filterCache: { key: string; matcher: (text: string) => FilterMatchResult | null } | null = null;

export function buildFilterMatcher(
  filters: MastodonFilter[],
  context: FilterContext,
): (text: string) => FilterMatchResult | null {
  // Only include filters that match the context and are not expired
  const applicable = filters.filter(
    f => f.context.includes(context) && !isFilterExpired(f) && f.keywords.length > 0,
  );

  if (applicable.length === 0) return () => null;

  // Cache key: serialize applicable filters so we only recompile when they change
  const cacheKey = `${context}|${applicable.map(f => `${f.id}:${f.filter_action}:${f.keywords.map(k => `${k.keyword}:${k.whole_word}`).join(',')}`).join('|')}`;
  if (_filterCache && _filterCache.key === cacheKey) return _filterCache.matcher;

  // Build per-filter matchers
  const filterMatchers: Array<{ test: (text: string) => boolean; result: FilterMatchResult }> = applicable.map(f => {
    const keywordTests = f.keywords.map(kw => {
      const lower = kw.keyword.toLowerCase();
      if (kw.whole_word) {
        return (text: string) => containsWholeWord(text.toLowerCase(), lower);
      }
      return (text: string) => text.toLowerCase().includes(lower);
    });

    return {
      test: (text: string) => keywordTests.some(kt => kt(text)),
      result: { action: f.filter_action, title: f.title },
    };
  });

  const matcher = (text: string): FilterMatchResult | null => {
    for (const fm of filterMatchers) {
      if (fm.test(text)) return fm.result;
    }
    return null;
  };

  _filterCache = { key: cacheKey, matcher };
  return matcher;
}

/** Letters, digits and underscore — what counts as "inside a word". */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

/**
 * Whole-word containment, without \b.
 *
 * \b asserts a transition between a word character and a non-word character,
 * which cannot exist between two non-word characters — so `\bc\+\+\b` never
 * matched "c++" in any text, and a whole-word keyword starting or ending with
 * punctuation silently filtered nothing.
 *
 * Mastodon's own rule is to require the boundary only on an edge where the
 * keyword actually has a word character to protect, which is what this does:
 * "cat" still does not match inside "concatenate", while "c++" matches "c++"
 * wherever it appears.
 *
 * Written as a scan rather than a regex deliberately: the lookbehind that would
 * express this cleanly is unsupported by the WebKit shipped on iOS 15, which is
 * this app's minimum, and the previous code's try/catch would have quietly
 * downgraded those users to substring matching.
 *
 * Both arguments are expected lower-cased by the caller.
 */
function containsWholeWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const guardStart = isWordChar(needle[0]);
  const guardEnd = isWordChar(needle[needle.length - 1]);

  for (let from = 0; ; ) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    const before = at > 0 ? haystack[at - 1] : undefined;
    const after = haystack[at + needle.length];
    if ((!guardStart || !isWordChar(before)) && (!guardEnd || !isWordChar(after))) return true;
    from = at + 1;
  }
}

// ── Filter cache for feed pages (TTL-based) ─────────────────────────────────

interface CachedFilters {
  filters: MastodonFilter[];
  fetchedAt: number;
}

const _filtersCache = new Map<string, CachedFilters>();
const FILTER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached filters for an instance, or null if cache is stale/missing.
 */
export function getCachedFilters(instanceUrl: string): MastodonFilter[] | null {
  const cached = _filtersCache.get(instanceUrl);
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > FILTER_CACHE_TTL) {
    _filtersCache.delete(instanceUrl);
    return null;
  }
  return cached.filters;
}

/**
 * Store filters in the cache.
 */
export function setCachedFilters(instanceUrl: string, filters: MastodonFilter[]): void {
  _filtersCache.set(instanceUrl, { filters, fetchedAt: Date.now() });
}

/**
 * Invalidate the filter cache for an instance (e.g. after create/update/delete).
 */
export function invalidateFilterCache(instanceUrl?: string): void {
  if (instanceUrl) {
    _filtersCache.delete(instanceUrl);
  } else {
    _filtersCache.clear();
  }
}
