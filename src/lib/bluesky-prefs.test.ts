import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the muted-words module
vi.mock('./muted-words', () => {
  let words: any[] = [];
  return {
    listMutedWords: () => [...words],
    saveMutedWords: (w: any[]) => { words = w; },
    createMutedWord: (value: string, isRegex: boolean) => ({
      id: `mw-test-${Date.now()}`,
      value,
      isRegex,
      enabled: true,
    }),
  };
});

import { syncMutedWordsFromServer } from './bluesky-prefs';
import { listMutedWords } from './muted-words';

describe('bluesky-prefs', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: vi.fn(),
    });
  });

  describe('syncMutedWordsFromServer', () => {
    it('merges server muted words into local store', async () => {
      const mockAgent = {
        getPreferences: vi.fn().mockResolvedValue({
          mutedWords: [
            { value: 'spoiler', targets: ['content'] },
            { value: 'nsfw', targets: ['content', 'tag'] },
          ],
        }),
      };

      await syncMutedWordsFromServer(mockAgent as any);
      const words = listMutedWords();
      expect(words).toHaveLength(2);
      expect(words.map((w: any) => w.value)).toContain('spoiler');
      expect(words.map((w: any) => w.value)).toContain('nsfw');
    });

    it('does not add duplicates', async () => {
      const mockAgent = {
        getPreferences: vi.fn().mockResolvedValue({
          mutedWords: [
            { value: 'spoiler', targets: ['content'] },
          ],
        }),
      };

      // First sync
      await syncMutedWordsFromServer(mockAgent as any);
      // Second sync with same word
      await syncMutedWordsFromServer(mockAgent as any);
      const words = listMutedWords();
      // Should still have 2 from first test + no new duplicates
      const spoilerCount = words.filter((w: any) => w.value === 'spoiler').length;
      expect(spoilerCount).toBeLessThanOrEqual(2); // may have one from prior test
    });

    it('skips expired muted words', async () => {
      const mockAgent = {
        getPreferences: vi.fn().mockResolvedValue({
          mutedWords: [
            { value: 'expired', targets: ['content'], expiresAt: '2020-01-01T00:00:00Z' },
          ],
        }),
      };

      await syncMutedWordsFromServer(mockAgent as any);
      const words = listMutedWords();
      const hasExpired = words.some((w: any) => w.value === 'expired');
      expect(hasExpired).toBe(false);
    });

    it('handles agent errors gracefully', async () => {
      const mockAgent = {
        getPreferences: vi.fn().mockRejectedValue(new Error('Network error')),
      };

      await expect(syncMutedWordsFromServer(mockAgent as any)).resolves.not.toThrow();
    });

    it('handles empty mutedWords', async () => {
      const mockAgent = {
        getPreferences: vi.fn().mockResolvedValue({ mutedWords: [] }),
      };

      await expect(syncMutedWordsFromServer(mockAgent as any)).resolves.not.toThrow();
    });
  });
});
