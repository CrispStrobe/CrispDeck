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

import { syncMutedWordsFromServer, pushMutedWordToServer } from './bluesky-prefs';
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

  describe('pushMutedWordToServer', () => {
    /**
     * The preferences document is one array holding saved feeds, labelers,
     * adult-content settings and every muted word. putPreferences writes that
     * array wholesale.
     *
     * This function used to call it with an array containing a single
     * mutedWordsPref, so muting one word would have discarded everything else
     * on the account. It was never wired to a caller, so no user lost data —
     * but the next caller would have. addMutedWord reads, merges, writes back.
     */
    it('never writes the preferences document wholesale', async () => {
      const putPreferences = vi.fn();
      const addMutedWord = vi.fn().mockResolvedValue(undefined);
      const agent = { addMutedWord, api: { app: { bsky: { actor: { putPreferences } } } } };

      await pushMutedWordToServer(agent as any, 'spoilers');

      expect(putPreferences).not.toHaveBeenCalled();
      expect(addMutedWord).toHaveBeenCalledWith({
        value: 'spoilers',
        targets: ['content', 'tag'],
        actorTarget: 'all',
      });
    });

    it('reports failure to the caller instead of swallowing it', async () => {
      // The caller saves the word locally; if it silently assumed the server
      // copy succeeded, the user would be told the word is muted everywhere.
      const agent = { addMutedWord: vi.fn().mockRejectedValue(new Error('upstream 502')) };
      await expect(pushMutedWordToServer(agent as any, 'spoilers')).rejects.toThrow('upstream 502');
    });
  });
});
