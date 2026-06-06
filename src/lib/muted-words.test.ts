/**
 * Tests for muted words / content filter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMutedWord, listMutedWords, saveMutedWords,
  addMutedWord, removeMutedWord, toggleMutedWord,
  buildMuteFilter, applyMuteFilter,
  type MutedWord,
} from './muted-words';

describe('muted words', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
    });
  });

  describe('createMutedWord', () => {
    it('creates with unique IDs', () => {
      const w1 = createMutedWord('test');
      const w2 = createMutedWord('test');
      expect(w1.id).not.toBe(w2.id);
    });

    it('defaults to enabled, non-regex', () => {
      const w = createMutedWord('hello');
      expect(w.enabled).toBe(true);
      expect(w.isRegex).toBe(false);
      expect(w.value).toBe('hello');
    });

    it('supports regex flag', () => {
      const w = createMutedWord('\\btest\\b', true);
      expect(w.isRegex).toBe(true);
    });
  });

  describe('persistence', () => {
    it('returns empty list when nothing saved', () => {
      expect(listMutedWords()).toEqual([]);
    });

    it('adds and retrieves muted words', () => {
      addMutedWord('politics');
      addMutedWord('drama');
      const words = listMutedWords();
      expect(words).toHaveLength(2);
      expect(words[0].value).toBe('politics');
      expect(words[1].value).toBe('drama');
    });

    it('removes a muted word', () => {
      const words = addMutedWord('remove-me');
      expect(words).toHaveLength(1);
      const after = removeMutedWord(words[0].id);
      expect(after).toHaveLength(0);
    });

    it('toggles a muted word', () => {
      const words = addMutedWord('toggle-me');
      expect(words[0].enabled).toBe(true);
      const toggled = toggleMutedWord(words[0].id);
      expect(toggled[0].enabled).toBe(false);
      const reToggled = toggleMutedWord(words[0].id);
      expect(reToggled[0].enabled).toBe(true);
    });
  });

  describe('buildMuteFilter', () => {
    it('returns false for empty list', () => {
      const shouldHide = buildMuteFilter([]);
      expect(shouldHide('anything')).toBe(false);
    });

    it('matches case-insensitive', () => {
      const words = [createMutedWord('POLITICS')];
      const shouldHide = buildMuteFilter(words);
      expect(shouldHide('I hate politics')).toBe(true);
      expect(shouldHide('POLITICS are boring')).toBe(true);
      expect(shouldHide('fun times')).toBe(false);
    });

    it('skips disabled words', () => {
      const words = [{ ...createMutedWord('hidden'), enabled: false }];
      const shouldHide = buildMuteFilter(words);
      expect(shouldHide('hidden content')).toBe(false);
    });

    it('matches regex patterns', () => {
      const words = [createMutedWord('\\btest\\b', true)];
      const shouldHide = buildMuteFilter(words);
      expect(shouldHide('this is a test post')).toBe(true);
      expect(shouldHide('testing 123')).toBe(false); // \b boundary
      expect(shouldHide('contest results')).toBe(false);
    });

    it('handles invalid regex gracefully', () => {
      const words = [createMutedWord('[invalid', true)];
      const shouldHide = buildMuteFilter(words);
      // Falls back to plain string match
      expect(shouldHide('contains [invalid regex')).toBe(true);
      expect(shouldHide('clean text')).toBe(false);
    });

    it('matches any of multiple words', () => {
      const words = [
        createMutedWord('spam'),
        createMutedWord('crypto'),
      ];
      const shouldHide = buildMuteFilter(words);
      expect(shouldHide('check out this crypto deal')).toBe(true);
      expect(shouldHide('spam alert')).toBe(true);
      expect(shouldHide('normal post')).toBe(false);
    });
  });

  describe('applyMuteFilter', () => {
    it('filters posts by muted words', () => {
      const posts = [
        { text: 'I love svelte' },
        { text: 'crypto spam alert' },
        { text: 'nice weather today' },
        { text: 'politics are exhausting' },
      ];
      const words = [
        createMutedWord('crypto'),
        createMutedWord('politics'),
      ];
      const filtered = applyMuteFilter(posts, words);
      expect(filtered).toHaveLength(2);
      expect(filtered[0].text).toBe('I love svelte');
      expect(filtered[1].text).toBe('nice weather today');
    });

    it('returns all posts when no words', () => {
      const posts = [{ text: 'a' }, { text: 'b' }];
      const filtered = applyMuteFilter(posts, []);
      expect(filtered).toHaveLength(2);
    });
  });
});
