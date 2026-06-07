/**
 * Hashtag bank: saved sets of hashtags for quick insertion into compose.
 *
 * Similar to tag-groups (deck column source) but oriented toward compose.
 * Each set can be one-click inserted into the compose text.
 */

export interface HashtagSet {
  id: string;
  name: string;
  hashtags: string[]; // with # prefix
}

const STORAGE_KEY = 'crispdeck-hashtag-bank';

export function listHashtagSets(): HashtagSet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveHashtagSet(set: Omit<HashtagSet, 'id'>): HashtagSet {
  const sets = listHashtagSets();
  const newSet: HashtagSet = {
    ...set,
    hashtags: set.hashtags.map(h => h.startsWith('#') ? h : `#${h}`),
    id: `hs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  };
  sets.push(newSet);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
  return newSet;
}

export function updateHashtagSet(id: string, updates: Partial<Omit<HashtagSet, 'id'>>): void {
  const sets = listHashtagSets();
  const idx = sets.findIndex(s => s.id === id);
  if (idx >= 0) {
    if (updates.hashtags) {
      updates.hashtags = updates.hashtags.map(h => h.startsWith('#') ? h : `#${h}`);
    }
    sets[idx] = { ...sets[idx], ...updates };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
  }
}

export function deleteHashtagSet(id: string): void {
  const sets = listHashtagSets().filter(s => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
}

/** Format a hashtag set as a string ready to append to compose text */
export function formatHashtagSet(set: HashtagSet): string {
  return set.hashtags.join(' ');
}
