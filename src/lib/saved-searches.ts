/**
 * Saved searches — persist search queries for quick re-access.
 * Stored in localStorage, can be opened as deck columns.
 */

const STORAGE_KEY = 'crispdeck-saved-searches';

export interface SavedSearch {
  id: string;
  query: string;
  createdAt: string;
}

export function listSavedSearches(): SavedSearch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveSearch(query: string): SavedSearch {
  const searches = listSavedSearches();
  // Don't duplicate
  const existing = searches.find(s => s.query === query);
  if (existing) return existing;

  const saved: SavedSearch = {
    id: `search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    query,
    createdAt: new Date().toISOString(),
  };
  searches.push(saved);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
  return saved;
}

export function deleteSavedSearch(id: string): void {
  const searches = listSavedSearches().filter(s => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
}

export function isSaved(query: string): boolean {
  return listSavedSearches().some(s => s.query === query);
}
