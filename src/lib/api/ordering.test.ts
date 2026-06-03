/**
 * Tests specifically for feed ordering — verifying posts come back
 * sorted by date correctly across platforms.
 */
import { describe, it, expect } from 'vitest';
import { BlueskyClient } from './bluesky';
import { MastodonClient } from './mastodon';
import { normalizePost, sortPosts, filterPosts, detectCrossposts } from './unified';
import type { UnifiedPost } from '$lib/types';

describe('Feed ordering (live API)', () => {
  it('Bluesky feed posts are correctly ordered after sortPosts', async () => {
    const client = BlueskyClient.readOnly('bsky.app');
    const { feed } = await client.getAuthorFeed('bsky.app');
    const posts = feed.map(p => normalizePost(p, 'bluesky'));

    // API may not return strict order (reposts, pins), but after sorting they must be ordered
    const sorted = sortPosts(posts, 'newest');
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = new Date(sorted[i].createdAt).getTime();
      const next = new Date(sorted[i + 1].createdAt).getTime();
      expect(current).toBeGreaterThanOrEqual(next);
    }
  }, 15000);

  it('Mastodon feed posts are correctly ordered after sortPosts', async () => {
    const client = new MastodonClient('https://mastodon.social');
    const acct = await client.getAccountByHandle('Gargron');
    const statuses = await client.getAccountStatuses(acct.id);
    const posts = statuses.map(s => normalizePost(s, 'mastodon'));

    const sorted = sortPosts(posts, 'newest');
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = new Date(sorted[i].createdAt).getTime();
      const next = new Date(sorted[i + 1].createdAt).getTime();
      expect(current).toBeGreaterThanOrEqual(next);
    }
  }, 15000);

  it('sortPosts with "newest" gives descending date order', () => {
    const posts: UnifiedPost[] = [
      { uri: '1', text: 'old', createdAt: '2024-01-01T00:00:00Z', author: { handle: 'a' }, platform: 'bluesky', isRepost: false },
      { uri: '2', text: 'new', createdAt: '2024-06-01T00:00:00Z', author: { handle: 'a' }, platform: 'bluesky', isRepost: false },
      { uri: '3', text: 'mid', createdAt: '2024-03-01T00:00:00Z', author: { handle: 'a' }, platform: 'bluesky', isRepost: false },
    ];
    const sorted = sortPosts(posts, 'newest');
    expect(sorted[0].text).toBe('new');
    expect(sorted[1].text).toBe('mid');
    expect(sorted[2].text).toBe('old');
  });

  it('detectCrossposts preserves input order for non-grouped posts', () => {
    const posts: UnifiedPost[] = [
      { uri: '1', text: 'First post', createdAt: '2024-06-01T00:00:00Z', author: { handle: 'a' }, platform: 'bluesky', isRepost: false },
      { uri: '2', text: 'Second post', createdAt: '2024-05-01T00:00:00Z', author: { handle: 'a' }, platform: 'bluesky', isRepost: false },
      { uri: '3', text: 'Third post', createdAt: '2024-04-01T00:00:00Z', author: { handle: 'a' }, platform: 'mastodon', isRepost: false },
    ];
    const result = detectCrossposts(posts);
    // Since no crossposts match (different texts), order should be preserved
    expect(result).toHaveLength(3);
    expect((result[0] as UnifiedPost).text).toBe('First post');
    expect((result[1] as UnifiedPost).text).toBe('Second post');
    expect((result[2] as UnifiedPost).text).toBe('Third post');
  });

  it('detectCrossposts places crosspost group at position of first match', () => {
    const posts: UnifiedPost[] = [
      { uri: '1', text: 'Unique post A', createdAt: '2024-06-03T00:00:00Z', author: { handle: 'a' }, platform: 'bluesky', isRepost: false },
      { uri: '2', text: 'This is a crossposted announcement about our product launch today', createdAt: '2024-06-02T00:00:00Z', author: { handle: 'a' }, platform: 'bluesky', isRepost: false },
      { uri: '3', text: 'This is a crossposted announcement about our product launch today', createdAt: '2024-06-02T01:00:00Z', author: { handle: 'b' }, platform: 'mastodon', isRepost: false },
      { uri: '4', text: 'Unique post B', createdAt: '2024-06-01T00:00:00Z', author: { handle: 'a' }, platform: 'bluesky', isRepost: false },
    ];
    const result = detectCrossposts(posts);
    // Should be: [Unique A, CrosspostGroup, Unique B]
    expect(result).toHaveLength(3);
    expect((result[0] as UnifiedPost).text).toBe('Unique post A');
    expect('type' in result[1] && result[1].type).toBe('crosspost');
    expect((result[2] as UnifiedPost).text).toBe('Unique post B');
  });

  it('full pipeline: filter → sort → detectCrossposts maintains order', () => {
    const posts: UnifiedPost[] = [
      { uri: '3', text: 'Third', createdAt: '2024-01-01T00:00:00Z', author: { handle: 'a' }, platform: 'bluesky', isRepost: false, likeCount: 5 },
      { uri: '1', text: 'First', createdAt: '2024-03-01T00:00:00Z', author: { handle: 'a' }, platform: 'bluesky', isRepost: false, likeCount: 10 },
      { uri: '2', text: 'Second', createdAt: '2024-02-01T00:00:00Z', author: { handle: 'a' }, platform: 'mastodon', isRepost: false, likeCount: 7 },
    ];

    const filtered = filterPosts(posts, {
      searchTerm: '', hasMedia: false, hideReplies: false, hideReposts: false, minLikes: 0,
    });
    const sorted = sortPosts(filtered, 'newest');
    const final = detectCrossposts(sorted);

    // Should be newest first: First (March), Second (Feb), Third (Jan)
    expect((final[0] as UnifiedPost).text).toBe('First');
    expect((final[1] as UnifiedPost).text).toBe('Second');
    expect((final[2] as UnifiedPost).text).toBe('Third');
  });

  it('Mastodon createdAt field is a valid ISO date string', async () => {
    const client = new MastodonClient('https://mastodon.social');
    const acct = await client.getAccountByHandle('Gargron');
    const statuses = await client.getAccountStatuses(acct.id);
    const post = normalizePost(statuses[0], 'mastodon');

    expect(post.createdAt).toBeTruthy();
    const date = new Date(post.createdAt);
    expect(date.getTime()).not.toBeNaN();
    // Should be a reasonable recent date (not epoch)
    expect(date.getFullYear()).toBeGreaterThan(2020);
  }, 10000);

  it('Bluesky createdAt field is a valid ISO date string', async () => {
    const client = BlueskyClient.readOnly('bsky.app');
    const { feed } = await client.getAuthorFeed('bsky.app');
    const post = normalizePost(feed[0], 'bluesky');

    expect(post.createdAt).toBeTruthy();
    const date = new Date(post.createdAt);
    expect(date.getTime()).not.toBeNaN();
    expect(date.getFullYear()).toBeGreaterThan(2020);
  }, 10000);

  it('merged multi-platform posts sort correctly by date', async () => {
    const bskyClient = BlueskyClient.readOnly('bsky.app');
    const mastoClient = new MastodonClient('https://mastodon.social');

    const { feed: bskyFeed } = await bskyClient.getAuthorFeed('bsky.app');
    const mastoAcct = await mastoClient.getAccountByHandle('Gargron');
    const mastoStatuses = await mastoClient.getAccountStatuses(mastoAcct.id);

    const allPosts = [
      ...bskyFeed.slice(0, 5).map(p => normalizePost(p, 'bluesky')),
      ...mastoStatuses.slice(0, 5).map(s => normalizePost(s, 'mastodon')),
    ];

    const sorted = sortPosts(allPosts, 'newest');

    // Verify sorted descending
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = new Date(sorted[i].createdAt).getTime();
      const next = new Date(sorted[i + 1].createdAt).getTime();
      expect(current).toBeGreaterThanOrEqual(next);
    }

    // Verify it's actually mixed (both platforms present)
    const platforms = new Set(sorted.map(p => p.platform));
    expect(platforms.size).toBe(2);
  }, 20000);
});
