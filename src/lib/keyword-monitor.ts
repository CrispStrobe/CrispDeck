/**
 * Keyword monitoring for deck columns.
 *
 * Saved keyword sets that can be used as deck column filters.
 * Posts matching ANY keyword are shown (OR logic).
 * Supports plain text (case-insensitive) and regex patterns.
 */

const STORAGE_KEY = 'crispdeck-keyword-monitors';

export interface KeywordSet {
  id: string;
  name: string;
  keywords: KeywordEntry[];
  createdAt: string;
}

export interface KeywordEntry {
  value: string;
  isRegex: boolean;
}

let counter = 0;

// ── Persistence ────────────────────────────────────────────────────────────

export function listKeywordSets(): KeywordSet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function getKeywordSet(id: string): KeywordSet | undefined {
  return listKeywordSets().find(s => s.id === id);
}

export function saveKeywordSet(set: KeywordSet): KeywordSet[] {
  const sets = listKeywordSets();
  const idx = sets.findIndex(s => s.id === set.id);
  if (idx >= 0) {
    sets[idx] = set;
  } else {
    sets.push(set);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
  return sets;
}

export function removeKeywordSet(id: string): KeywordSet[] {
  const sets = listKeywordSets().filter(s => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
  return sets;
}

export function createKeywordSet(name: string, keywords: string[]): KeywordSet {
  return {
    id: `km-${Date.now()}-${counter++}`,
    name,
    keywords: keywords.map(k => ({ value: k, isRegex: false })),
    createdAt: new Date().toISOString(),
  };
}

// ── Matching ───────────────────────────────────────────────────────────────

/**
 * Parse a user-input keyword string into entries.
 * Comma-separated. Entries wrapped in /.../ are treated as regex.
 */
export function parseKeywords(input: string): KeywordEntry[] {
  return input
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const regexMatch = s.match(/^\/(.+)\/([gimsuy]*)$/);
      if (regexMatch) {
        return { value: regexMatch[1], isRegex: true };
      }
      return { value: s, isRegex: false };
    });
}

/**
 * Build a matcher function from keyword entries.
 * Returns true if the text matches ANY keyword (OR logic).
 * Caches compiled matchers to avoid re-creating regexes on repeated calls.
 */
let _matcherCache: { key: string; fn: (text: string) => boolean } | null = null;

export function buildKeywordMatcher(entries: KeywordEntry[]): (text: string) => boolean {
  if (entries.length === 0) return () => false;

  const cacheKey = entries.map(e => `${e.value}:${e.isRegex}`).join('|');
  if (_matcherCache && _matcherCache.key === cacheKey) return _matcherCache.fn;

  const matchers: ((text: string) => boolean)[] = entries.map(entry => {
    if (entry.isRegex) {
      try {
        const re = new RegExp(entry.value, 'i');
        return (text: string) => re.test(text);
      } catch {
        const lower = entry.value.toLowerCase();
        return (text: string) => text.toLowerCase().includes(lower);
      }
    }
    const lower = entry.value.toLowerCase();
    return (text: string) => text.toLowerCase().includes(lower);
  });

  const fn = (text: string) => matchers.some(m => m(text));
  _matcherCache = { key: cacheKey, fn };
  return fn;
}

/**
 * Convenience: parse a keyword string and build a matcher in one step.
 */
export function buildMatcherFromString(input: string): (text: string) => boolean {
  return buildKeywordMatcher(parseKeywords(input));
}

/**
 * Filter posts, keeping only those matching keywords.
 * Opposite of applyMuteFilter — this INCLUDES matches instead of excluding.
 */
export function filterByKeywords<T extends { text: string }>(
  posts: T[],
  entries: KeywordEntry[],
): T[] {
  const matches = buildKeywordMatcher(entries);
  return posts.filter(p => matches(p.text));
}
