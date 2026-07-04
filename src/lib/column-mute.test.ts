import { describe, it, expect } from 'vitest';
import { applyColumnMuteFilter } from './column-mute';
import type { UnifiedPost } from '$lib/types';

const makePost = (text: string): UnifiedPost => ({
  uri: `post-${text}`,
  text,
  author: { handle: 'test' },
  createdAt: '2026-01-01',
  platform: 'bluesky',
  isRepost: false,
  raw: {},
});

describe('column-mute', () => {
  describe('applyColumnMuteFilter', () => {
    it('returns all posts when no mute words', () => {
      const posts = [makePost('Hello'), makePost('World')];
      expect(applyColumnMuteFilter(posts, [])).toHaveLength(2);
    });

    it('returns all posts when muteWords is empty array', () => {
      const posts = [makePost('Hello')];
      expect(applyColumnMuteFilter(posts, [])).toHaveLength(1);
    });

    it('filters posts containing muted keyword', () => {
      const posts = [makePost('Hello world'), makePost('Goodbye world'), makePost('Hi there')];
      const result = applyColumnMuteFilter(posts, ['goodbye']);
      expect(result).toHaveLength(2);
      expect(result.map(p => p.text)).toEqual(['Hello world', 'Hi there']);
    });

    it('keyword matching is case-insensitive', () => {
      const posts = [makePost('SPOILER ALERT'), makePost('No spoilers here')];
      const result = applyColumnMuteFilter(posts, ['spoiler']);
      expect(result).toHaveLength(0);
    });

    it('supports regex patterns with /slashes/', () => {
      const posts = [makePost('Post #123'), makePost('Post #abc'), makePost('No number')];
      const result = applyColumnMuteFilter(posts, ['/\\d+/']);
      expect(result).toHaveLength(2);
      expect(result.map(p => p.text)).toEqual(['Post #abc', 'No number']);
    });

    it('handles invalid regex gracefully', () => {
      const posts = [makePost('Hello'), makePost('World')];
      const result = applyColumnMuteFilter(posts, ['/[invalid/']);
      expect(result).toHaveLength(2); // Invalid regex matches nothing
    });

    it('supports multiple mute words (OR logic)', () => {
      const posts = [makePost('Svelte is great'), makePost('React is fine'), makePost('Vue is ok')];
      const result = applyColumnMuteFilter(posts, ['react', 'vue']);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Svelte is great');
    });

    it('stacks on top of global mute (column receives pre-filtered posts)', () => {
      // Simulate: global mute already removed "spam" posts, column adds "politics"
      const globalFiltered = [makePost('Tech news'), makePost('Political debate'), makePost('Cool project')];
      const columnFiltered = applyColumnMuteFilter(globalFiltered, ['political']);
      expect(columnFiltered).toHaveLength(2);
    });

    it('handles empty posts array', () => {
      expect(applyColumnMuteFilter([], ['anything'])).toEqual([]);
    });
  });
});
