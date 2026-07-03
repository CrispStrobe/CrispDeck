/**
 * Muted words / content filter.
 * Hides posts containing user-defined words or regex patterns across all platforms.
 * Stored in localStorage.
 */

const STORAGE_KEY = 'crispdeck-muted-words';

export interface MutedWord {
  id: string;
  value: string;
  isRegex: boolean;
  enabled: boolean;
}

let counter = 0;

export function createMutedWord(value: string, isRegex = false): MutedWord {
  return {
    id: `mw-${Date.now()}-${counter++}`,
    value,
    isRegex,
    enabled: true,
  };
}

export function listMutedWords(): MutedWord[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export function saveMutedWords(words: MutedWord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(words));
}

export function addMutedWord(value: string, isRegex = false): MutedWord[] {
  const words = listMutedWords();
  words.push(createMutedWord(value, isRegex));
  saveMutedWords(words);
  return words;
}

export function removeMutedWord(id: string): MutedWord[] {
  const words = listMutedWords().filter(w => w.id !== id);
  saveMutedWords(words);
  return words;
}

export function toggleMutedWord(id: string): MutedWord[] {
  const words = listMutedWords().map(w =>
    w.id === id ? { ...w, enabled: !w.enabled } : w
  );
  saveMutedWords(words);
  return words;
}

/**
 * Build a filter function from the current muted words list.
 * Returns a function that returns true if the text should be HIDDEN.
 * Caches compiled matchers to avoid recompiling regexes on every call.
 */
let _muteCache: { key: string; filter: (text: string) => boolean } | null = null;

export function buildMuteFilter(words?: MutedWord[]): (text: string) => boolean {
  const active = (words ?? listMutedWords()).filter(w => w.enabled && w.value.trim());
  if (active.length === 0) return () => false;

  // Cache key: serialize active words so we only recompile when they change
  const cacheKey = active.map(w => `${w.id}:${w.value}:${w.isRegex}`).join('|');
  if (_muteCache && _muteCache.key === cacheKey) return _muteCache.filter;

  const matchers: ((text: string) => boolean)[] = active.map(w => {
    if (w.isRegex) {
      try {
        const re = new RegExp(w.value, 'i');
        return (text: string) => re.test(text);
      } catch {
        // Invalid regex — fall back to plain string match
        const lower = w.value.toLowerCase();
        return (text: string) => text.toLowerCase().includes(lower);
      }
    }
    const lower = w.value.toLowerCase();
    return (text: string) => text.toLowerCase().includes(lower);
  });

  const filter = (text: string) => matchers.some(m => m(text));
  _muteCache = { key: cacheKey, filter };
  return filter;
}

/**
 * Filter an array of posts, removing any that match muted words.
 */
export function applyMuteFilter<T extends { text: string }>(posts: T[], words?: MutedWord[]): T[] {
  const shouldHide = buildMuteFilter(words);
  return posts.filter(p => !shouldHide(p.text));
}
