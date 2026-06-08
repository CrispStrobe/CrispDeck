import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseKeywords,
  buildKeywordMatcher,
  buildMatcherFromString,
  filterByKeywords,
  createKeywordSet,
  listKeywordSets,
  saveKeywordSet,
  removeKeywordSet,
  getKeywordSet,
  type KeywordEntry,
} from './keyword-monitor';

// Mock localStorage
const store: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
});

describe('parseKeywords', () => {
  it('splits comma-separated keywords', () => {
    const result = parseKeywords('svelte, typescript, rust');
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ value: 'svelte', isRegex: false });
    expect(result[1]).toEqual({ value: 'typescript', isRegex: false });
    expect(result[2]).toEqual({ value: 'rust', isRegex: false });
  });

  it('detects regex patterns wrapped in slashes', () => {
    const result = parseKeywords('svelte, /type.*script/, rust');
    expect(result[1]).toEqual({ value: 'type.*script', isRegex: true });
  });

  it('handles regex with flags', () => {
    const result = parseKeywords('/hello/gi');
    expect(result[0]).toEqual({ value: 'hello', isRegex: true });
  });

  it('ignores empty entries', () => {
    const result = parseKeywords('svelte, , , rust');
    expect(result).toHaveLength(2);
  });

  it('trims whitespace', () => {
    const result = parseKeywords('  svelte  ,  rust  ');
    expect(result[0].value).toBe('svelte');
    expect(result[1].value).toBe('rust');
  });

  it('returns empty array for empty input', () => {
    expect(parseKeywords('')).toHaveLength(0);
    expect(parseKeywords('   ')).toHaveLength(0);
  });
});

describe('buildKeywordMatcher', () => {
  it('matches plain text case-insensitively', () => {
    const match = buildKeywordMatcher([{ value: 'svelte', isRegex: false }]);
    expect(match('I love Svelte!')).toBe(true);
    expect(match('SVELTE is great')).toBe(true);
    expect(match('react is fine')).toBe(false);
  });

  it('OR logic — matches if any keyword matches', () => {
    const match = buildKeywordMatcher([
      { value: 'svelte', isRegex: false },
      { value: 'rust', isRegex: false },
    ]);
    expect(match('Learning Svelte today')).toBe(true);
    expect(match('Rust is fast')).toBe(true);
    expect(match('Python scripting')).toBe(false);
  });

  it('supports regex patterns', () => {
    const match = buildKeywordMatcher([{ value: 'type.*script', isRegex: true }]);
    expect(match('I use TypeScript')).toBe(true);
    expect(match('type checking in script')).toBe(true);
    expect(match('python')).toBe(false);
  });

  it('falls back to string match on invalid regex', () => {
    const match = buildKeywordMatcher([{ value: '[invalid', isRegex: true }]);
    expect(match('contains [invalid here')).toBe(true);
    expect(match('nothing')).toBe(false);
  });

  it('returns false for empty entries', () => {
    const match = buildKeywordMatcher([]);
    expect(match('anything')).toBe(false);
  });
});

describe('buildMatcherFromString', () => {
  it('parses and builds in one step', () => {
    const match = buildMatcherFromString('svelte, rust');
    expect(match('I like Svelte')).toBe(true);
    expect(match('Rust lang')).toBe(true);
    expect(match('Go lang')).toBe(false);
  });
});

describe('filterByKeywords', () => {
  const posts = [
    { text: 'Svelte 5 runes are great', uri: '1' },
    { text: 'Rust is blazingly fast', uri: '2' },
    { text: 'Python for data science', uri: '3' },
    { text: 'TypeScript generics', uri: '4' },
  ];

  it('keeps only posts matching keywords', () => {
    const entries: KeywordEntry[] = [{ value: 'svelte', isRegex: false }, { value: 'rust', isRegex: false }];
    const result = filterByKeywords(posts, entries);
    expect(result).toHaveLength(2);
    expect(result[0].uri).toBe('1');
    expect(result[1].uri).toBe('2');
  });

  it('returns empty for no matches', () => {
    const entries: KeywordEntry[] = [{ value: 'haskell', isRegex: false }];
    expect(filterByKeywords(posts, entries)).toHaveLength(0);
  });

  it('returns empty for empty keywords', () => {
    expect(filterByKeywords(posts, [])).toHaveLength(0);
  });

  it('supports regex filtering', () => {
    const entries: KeywordEntry[] = [{ value: 'type.*script', isRegex: true }];
    const result = filterByKeywords(posts, entries);
    expect(result).toHaveLength(1);
    expect(result[0].uri).toBe('4');
  });
});

describe('keyword set persistence', () => {
  it('creates a keyword set with ID and timestamp', () => {
    const set = createKeywordSet('Frontend', ['svelte', 'react', 'vue']);
    expect(set.id).toMatch(/^km-/);
    expect(set.name).toBe('Frontend');
    expect(set.keywords).toHaveLength(3);
    expect(set.keywords[0]).toEqual({ value: 'svelte', isRegex: false });
    expect(set.createdAt).toBeTruthy();
  });

  it('saves and lists keyword sets', () => {
    const set = createKeywordSet('Test', ['a', 'b']);
    saveKeywordSet(set);
    const all = listKeywordSets();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Test');
  });

  it('updates existing set on save', () => {
    const set = createKeywordSet('Test', ['a']);
    saveKeywordSet(set);
    set.keywords.push({ value: 'b', isRegex: false });
    saveKeywordSet(set);
    const all = listKeywordSets();
    expect(all).toHaveLength(1);
    expect(all[0].keywords).toHaveLength(2);
  });

  it('getKeywordSet finds by ID', () => {
    const set = createKeywordSet('Find me', ['x']);
    saveKeywordSet(set);
    expect(getKeywordSet(set.id)?.name).toBe('Find me');
    expect(getKeywordSet('nonexistent')).toBeUndefined();
  });

  it('removes a keyword set', () => {
    const s1 = createKeywordSet('A', ['a']);
    const s2 = createKeywordSet('B', ['b']);
    saveKeywordSet(s1);
    saveKeywordSet(s2);
    removeKeywordSet(s1.id);
    const all = listKeywordSets();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('B');
  });

  it('returns empty array when nothing saved', () => {
    expect(listKeywordSets()).toEqual([]);
  });

  it('handles corrupted localStorage gracefully', () => {
    store['crispdeck-keyword-monitors'] = 'not-json';
    expect(listKeywordSets()).toEqual([]);
  });
});
