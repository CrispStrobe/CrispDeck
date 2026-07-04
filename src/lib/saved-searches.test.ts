import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listSavedSearches, saveSearch, deleteSavedSearch, isSaved } from './saved-searches';

describe('saved-searches', () => {
  const store: Record<string, string> = {};

  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
    });
  });

  describe('listSavedSearches', () => {
    it('returns empty array when no searches saved', () => {
      expect(listSavedSearches()).toEqual([]);
    });

    it('returns saved searches', () => {
      store['crispdeck-saved-searches'] = JSON.stringify([
        { id: 's1', query: 'svelte', createdAt: '2026-01-01' },
      ]);
      const result = listSavedSearches();
      expect(result).toHaveLength(1);
      expect(result[0].query).toBe('svelte');
    });

    it('handles corrupted localStorage gracefully', () => {
      store['crispdeck-saved-searches'] = 'not json';
      expect(listSavedSearches()).toEqual([]);
    });
  });

  describe('saveSearch', () => {
    it('saves a new search', () => {
      const saved = saveSearch('svelte 5');
      expect(saved.query).toBe('svelte 5');
      expect(saved.id).toMatch(/^search-/);
      expect(listSavedSearches()).toHaveLength(1);
    });

    it('does not duplicate existing queries', () => {
      saveSearch('svelte');
      saveSearch('svelte');
      expect(listSavedSearches()).toHaveLength(1);
    });

    it('adds multiple different searches', () => {
      saveSearch('svelte');
      saveSearch('rust');
      saveSearch('typescript');
      expect(listSavedSearches()).toHaveLength(3);
    });

    it('returns existing search if duplicate', () => {
      const first = saveSearch('svelte');
      const second = saveSearch('svelte');
      expect(first.id).toBe(second.id);
    });
  });

  describe('deleteSavedSearch', () => {
    it('removes a saved search by id', () => {
      const saved = saveSearch('svelte');
      expect(listSavedSearches()).toHaveLength(1);
      deleteSavedSearch(saved.id);
      expect(listSavedSearches()).toHaveLength(0);
    });

    it('does nothing if id not found', () => {
      saveSearch('svelte');
      deleteSavedSearch('nonexistent');
      expect(listSavedSearches()).toHaveLength(1);
    });

    it('only removes the targeted search', () => {
      const s1 = saveSearch('svelte');
      const s2 = saveSearch('rust');
      const s3 = saveSearch('typescript');
      const before = listSavedSearches();
      expect(before).toHaveLength(3);
      deleteSavedSearch(s2.id);
      const remaining = listSavedSearches();
      expect(remaining).toHaveLength(2);
      expect(remaining.map(s => s.query)).toEqual(['svelte', 'typescript']);
    });
  });

  describe('isSaved', () => {
    it('returns false for unsaved query', () => {
      expect(isSaved('unknown')).toBe(false);
    });

    it('returns true for saved query', () => {
      saveSearch('svelte');
      expect(isSaved('svelte')).toBe(true);
    });

    it('is case-sensitive', () => {
      saveSearch('Svelte');
      expect(isSaved('svelte')).toBe(false);
      expect(isSaved('Svelte')).toBe(true);
    });
  });
});
