import { describe, it, expect } from 'vitest';
import { groupNotifications, type UnifiedNotification } from './notification-grouping';

function makeNotif(overrides: Partial<UnifiedNotification> & { id: string }): UnifiedNotification {
  return {
    platform: 'bluesky',
    type: 'like',
    createdAt: '2026-06-05T12:00:00Z',
    author: { handle: 'alice.bsky.social', displayName: 'Alice' },
    text: 'Hello world',
    postUri: 'at://did:plc:abc/app.bsky.feed.post/123',
    ...overrides,
  };
}

describe('notification-grouping', () => {
  describe('groupNotifications', () => {
    it('returns empty array for empty input', () => {
      expect(groupNotifications([])).toEqual([]);
    });

    it('does not group single notifications', () => {
      const notifs = [makeNotif({ id: '1' })];
      const groups = groupNotifications(notifs);
      expect(groups).toHaveLength(1);
      expect(groups[0].actors).toHaveLength(1);
      expect(groups[0].type).toBe('like');
    });

    it('groups multiple likes on the same post', () => {
      const notifs = [
        makeNotif({ id: '1', author: { handle: 'alice', displayName: 'Alice' }, createdAt: '2026-06-05T12:00:00Z' }),
        makeNotif({ id: '2', author: { handle: 'bob', displayName: 'Bob' }, createdAt: '2026-06-05T12:01:00Z' }),
        makeNotif({ id: '3', author: { handle: 'carol', displayName: 'Carol' }, createdAt: '2026-06-05T12:02:00Z' }),
      ];
      const groups = groupNotifications(notifs);
      expect(groups).toHaveLength(1);
      expect(groups[0].actors).toHaveLength(3);
      expect(groups[0].type).toBe('like');
    });

    it('keeps the most recent timestamp for the group', () => {
      const notifs = [
        makeNotif({ id: '1', author: { handle: 'alice' }, createdAt: '2026-06-05T10:00:00Z' }),
        makeNotif({ id: '2', author: { handle: 'bob' }, createdAt: '2026-06-05T14:00:00Z' }),
        makeNotif({ id: '3', author: { handle: 'carol' }, createdAt: '2026-06-05T12:00:00Z' }),
      ];
      const groups = groupNotifications(notifs);
      expect(groups[0].latestAt).toBe('2026-06-05T14:00:00Z');
    });

    it('separates likes and reposts on the same post into different groups', () => {
      const postUri = 'at://did:plc:abc/app.bsky.feed.post/123';
      const notifs = [
        makeNotif({ id: '1', type: 'like', author: { handle: 'alice' }, postUri }),
        makeNotif({ id: '2', type: 'repost', author: { handle: 'bob' }, postUri }),
        makeNotif({ id: '3', type: 'like', author: { handle: 'carol' }, postUri }),
      ];
      const groups = groupNotifications(notifs);
      expect(groups).toHaveLength(2);
      const likeGroup = groups.find(g => g.type === 'like')!;
      const repostGroup = groups.find(g => g.type === 'repost')!;
      expect(likeGroup.actors).toHaveLength(2);
      expect(repostGroup.actors).toHaveLength(1);
    });

    it('separates likes on different posts', () => {
      const notifs = [
        makeNotif({ id: '1', author: { handle: 'alice' }, postUri: 'at://post/1' }),
        makeNotif({ id: '2', author: { handle: 'bob' }, postUri: 'at://post/2' }),
      ];
      const groups = groupNotifications(notifs);
      expect(groups).toHaveLength(2);
    });

    it('groups all follows into one group', () => {
      const notifs = [
        makeNotif({ id: '1', type: 'follow', author: { handle: 'alice' }, postUri: undefined, text: undefined }),
        makeNotif({ id: '2', type: 'follow', author: { handle: 'bob' }, postUri: undefined, text: undefined }),
        makeNotif({ id: '3', type: 'follow', author: { handle: 'carol' }, postUri: undefined, text: undefined }),
      ];
      const groups = groupNotifications(notifs);
      expect(groups).toHaveLength(1);
      expect(groups[0].type).toBe('follow');
      expect(groups[0].actors).toHaveLength(3);
    });

    it('does NOT group mentions (each is unique)', () => {
      const notifs = [
        makeNotif({ id: '1', type: 'mention', author: { handle: 'alice' }, text: 'Hey @you' }),
        makeNotif({ id: '2', type: 'mention', author: { handle: 'bob' }, text: 'Yo @you' }),
      ];
      const groups = groupNotifications(notifs);
      expect(groups).toHaveLength(2);
    });

    it('does NOT group replies (each is unique)', () => {
      const notifs = [
        makeNotif({ id: '1', type: 'reply', author: { handle: 'alice' }, text: 'Nice post!' }),
        makeNotif({ id: '2', type: 'reply', author: { handle: 'bob' }, text: 'Agree!' }),
      ];
      const groups = groupNotifications(notifs);
      expect(groups).toHaveLength(2);
    });

    it('does NOT group quotes (each is unique)', () => {
      const notifs = [
        makeNotif({ id: '1', type: 'quote', author: { handle: 'alice' }, text: 'Great thread' }),
        makeNotif({ id: '2', type: 'quote', author: { handle: 'bob' }, text: 'Interesting' }),
      ];
      const groups = groupNotifications(notifs);
      expect(groups).toHaveLength(2);
    });

    it('normalizes Mastodon favourite to like', () => {
      const postUri = 'https://mastodon.social/@alice/123';
      const notifs = [
        makeNotif({ id: '1', platform: 'mastodon', type: 'favourite', author: { handle: '@alice' }, postUri }),
        makeNotif({ id: '2', platform: 'mastodon', type: 'favourite', author: { handle: '@bob' }, postUri }),
      ];
      const groups = groupNotifications(notifs);
      expect(groups).toHaveLength(1);
      expect(groups[0].type).toBe('like');
      expect(groups[0].actors).toHaveLength(2);
    });

    it('normalizes Mastodon reblog to repost', () => {
      const postUri = 'https://mastodon.social/@alice/123';
      const notifs = [
        makeNotif({ id: '1', platform: 'mastodon', type: 'reblog', author: { handle: '@alice' }, postUri }),
      ];
      const groups = groupNotifications(notifs);
      expect(groups[0].type).toBe('repost');
    });

    it('groups cross-platform likes on the same post URI', () => {
      const postUri = 'shared-post-uri';
      const notifs = [
        makeNotif({ id: '1', platform: 'bluesky', type: 'like', author: { handle: 'alice.bsky' }, postUri }),
        makeNotif({ id: '2', platform: 'mastodon', type: 'favourite', author: { handle: '@alice' }, postUri }),
      ];
      const groups = groupNotifications(notifs);
      // Same postUri = same group (cross-platform)
      expect(groups).toHaveLength(1);
      expect(groups[0].platforms.size).toBe(2);
      expect(groups[0].platforms.has('bluesky')).toBe(true);
      expect(groups[0].platforms.has('mastodon')).toBe(true);
    });

    it('deduplicates actors with the same handle and platform', () => {
      const notifs = [
        makeNotif({ id: '1', author: { handle: 'alice' } }),
        makeNotif({ id: '2', author: { handle: 'alice' } }), // duplicate
      ];
      const groups = groupNotifications(notifs);
      expect(groups[0].actors).toHaveLength(1);
    });

    it('sorts groups by most recent timestamp', () => {
      const notifs = [
        makeNotif({ id: '1', type: 'mention', createdAt: '2026-06-05T10:00:00Z', author: { handle: 'old' } }),
        makeNotif({ id: '2', type: 'mention', createdAt: '2026-06-05T14:00:00Z', author: { handle: 'new' } }),
        makeNotif({ id: '3', type: 'mention', createdAt: '2026-06-05T12:00:00Z', author: { handle: 'mid' } }),
      ];
      const groups = groupNotifications(notifs);
      expect(groups[0].actors[0].handle).toBe('new');
      expect(groups[1].actors[0].handle).toBe('mid');
      expect(groups[2].actors[0].handle).toBe('old');
    });

    it('handles mixed notification types correctly', () => {
      const postUri = 'at://post/1';
      const notifs = [
        makeNotif({ id: '1', type: 'like', author: { handle: 'a' }, postUri }),
        makeNotif({ id: '2', type: 'like', author: { handle: 'b' }, postUri }),
        makeNotif({ id: '3', type: 'follow', author: { handle: 'c' }, postUri: undefined }),
        makeNotif({ id: '4', type: 'follow', author: { handle: 'd' }, postUri: undefined }),
        makeNotif({ id: '5', type: 'mention', author: { handle: 'e' }, text: 'hey' }),
        makeNotif({ id: '6', type: 'repost', author: { handle: 'f' }, postUri }),
        makeNotif({ id: '7', type: 'reply', author: { handle: 'g' }, text: 'nice' }),
      ];
      const groups = groupNotifications(notifs);
      // 1 like group + 1 follow group + 1 mention + 1 repost group + 1 reply = 5 groups
      expect(groups).toHaveLength(5);
    });

    it('preserves text from first notification with text', () => {
      const postUri = 'at://post/1';
      const notifs = [
        makeNotif({ id: '1', author: { handle: 'a' }, postUri, text: undefined }),
        makeNotif({ id: '2', author: { handle: 'b' }, postUri, text: 'Hello world' }),
        makeNotif({ id: '3', author: { handle: 'c' }, postUri, text: 'Another text' }),
      ];
      const groups = groupNotifications(notifs);
      expect(groups[0].text).toBe('Hello world');
    });

    it('Set-based dedup is O(1) per actor check', () => {
      // With 100 duplicate actors, should still be fast
      const postUri = 'at://post/dedup-perf';
      const notifs = Array.from({ length: 100 }, (_, i) =>
        makeNotif({ id: `dup-${i}`, author: { handle: 'same-actor' }, postUri })
      );
      const start = performance.now();
      const groups = groupNotifications(notifs);
      const elapsed = performance.now() - start;
      expect(groups).toHaveLength(1);
      expect(groups[0].actors).toHaveLength(1); // all deduped to 1
      expect(elapsed).toBeLessThan(50); // should be instant
    });

    it('handles cross-platform actor dedup correctly', () => {
      const postUri = 'at://post/cross-plat';
      const notifs = [
        makeNotif({ id: '1', platform: 'bluesky', author: { handle: 'alice' }, postUri }),
        makeNotif({ id: '2', platform: 'mastodon', type: 'favourite', author: { handle: 'alice' }, postUri }),
      ];
      const groups = groupNotifications(notifs);
      // Same handle but different platform = 2 separate actors
      expect(groups[0].actors).toHaveLength(2);
    });

    it('scales to many unique actors without performance degradation', () => {
      const postUri = 'at://post/scale';
      const notifs = Array.from({ length: 500 }, (_, i) =>
        makeNotif({ id: `scale-${i}`, author: { handle: `user-${i}` }, postUri })
      );
      const start = performance.now();
      const groups = groupNotifications(notifs);
      const elapsed = performance.now() - start;
      expect(groups).toHaveLength(1);
      expect(groups[0].actors).toHaveLength(500);
      expect(elapsed).toBeLessThan(100);
    });
  });
});
