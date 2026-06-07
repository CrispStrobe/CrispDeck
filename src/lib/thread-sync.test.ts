import { describe, it, expect } from 'vitest';
import { planThreadSync, extractThreadText, isThread, adaptTextForPlatform } from './thread-sync';
import type { UnifiedPost } from './types';

function makePost(text: string, platform = 'bluesky' as const, handle = 'alice.bsky.social'): UnifiedPost {
  return {
    uri: `at://post-${Math.random()}`,
    text,
    author: { handle },
    createdAt: new Date().toISOString(),
    platform,
    isRepost: false,
  };
}

describe('thread sync', () => {
  describe('planThreadSync', () => {
    it('plans sync to different platforms', () => {
      const thread = [
        makePost('Part 1 of my thread (1/3)'),
        makePost('Part 2 continues here (2/3)'),
        makePost('Final part wrapping up (3/3)'),
      ];
      const plan = planThreadSync(thread, ['mastodon', 'threads']);
      expect(plan.sourcePlatform).toBe('bluesky');
      expect(plan.targets).toHaveLength(2);
      expect(plan.targets[0].platform).toBe('mastodon');
      expect(plan.targets[1].platform).toBe('threads');
    });

    it('excludes source platform from targets', () => {
      const thread = [makePost('Hello')];
      const plan = planThreadSync(thread, ['bluesky', 'mastodon']);
      expect(plan.targets).toHaveLength(1);
      expect(plan.targets[0].platform).toBe('mastodon');
    });
  });

  describe('extractThreadText', () => {
    it('removes thread numbering', () => {
      const posts = [
        makePost('First part (1/3)'),
        makePost('Second part (2/3)'),
        makePost('Third part (3/3)'),
      ];
      const text = extractThreadText(posts);
      expect(text).not.toContain('(1/3)');
      expect(text).toContain('First part');
      expect(text).toContain('Second part');
    });

    it('joins with double newlines', () => {
      const posts = [makePost('A'), makePost('B')];
      expect(extractThreadText(posts)).toBe('A\n\nB');
    });
  });

  describe('isThread', () => {
    it('returns true for posts by same author', () => {
      expect(isThread([makePost('A'), makePost('B')])).toBe(true);
    });

    it('returns false for single post', () => {
      expect(isThread([makePost('A')])).toBe(false);
    });

    it('returns false for different authors', () => {
      expect(isThread([
        makePost('A', 'bluesky', 'alice.bsky.social'),
        makePost('B', 'bluesky', 'bob.bsky.social'),
      ])).toBe(false);
    });
  });

  describe('adaptTextForPlatform', () => {
    it('strips instance from mentions for Threads', () => {
      expect(adaptTextForPlatform('Hello @user@mastodon.social!', 'threads')).toBe('Hello @user!');
    });

    it('strips instance from mentions for Bluesky', () => {
      expect(adaptTextForPlatform('Hey @alice@fosstodon.org', 'bluesky')).toBe('Hey @alice');
    });

    it('keeps full handles for Mastodon', () => {
      expect(adaptTextForPlatform('Hey @alice@fosstodon.org', 'mastodon')).toBe('Hey @alice@fosstodon.org');
    });
  });
});
