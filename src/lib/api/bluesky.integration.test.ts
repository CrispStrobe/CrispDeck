/**
 * Integration tests that hit the real Bluesky public API.
 * These test actual network requests — they may be slow and can fail
 * if the API is down. Run with: npx vitest run --reporter=verbose
 */
import { describe, it, expect } from 'vitest';
import { BlueskyClient } from './bluesky';
import { normalizePost } from './unified';

describe('BlueskyClient (live API)', () => {
  const client = BlueskyClient.readOnly('bsky.app');

  it('fetches a public profile', async () => {
    const profile = await client.getProfile('bsky.app');
    expect(profile.handle).toBe('bsky.app');
    expect(profile.displayName).toBe('Bluesky');
    expect(profile.did).toMatch(/^did:plc:/);
    expect(profile.avatar).toBeTruthy();
  }, 10000);

  it('fetches author feed', async () => {
    const { feed, cursor } = await client.getAuthorFeed('bsky.app');
    expect(feed.length).toBeGreaterThan(0);
    expect(feed.length).toBeLessThanOrEqual(50);

    // Check feed item structure
    const item = feed[0];
    expect(item.post).toBeDefined();
    expect(item.post.uri).toMatch(/^at:\/\//);
    expect(item.post.author.handle).toBeTruthy();
    expect(item.post.record).toBeDefined();
  }, 10000);

  it('normalizes Bluesky feed posts correctly', async () => {
    const { feed } = await client.getAuthorFeed('bsky.app');
    const post = normalizePost(feed[0], 'bluesky');

    expect(post.uri).toMatch(/^at:\/\//);
    expect(post.platform).toBe('bluesky');
    expect(post.author.handle).toBeTruthy();
    expect(post.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(typeof post.text).toBe('string');
    expect(typeof post.likeCount).toBe('number');
    expect(typeof post.repostCount).toBe('number');
    expect(typeof post.isRepost).toBe('boolean');
  }, 10000);

  it('returns cursor for pagination', async () => {
    const { feed, cursor } = await client.getAuthorFeed('bsky.app');
    expect(feed.length).toBeGreaterThan(0);
    // Active accounts should have a pagination cursor
    expect(cursor).toBeTruthy();
  }, 10000);

  it('second page is different from first', async () => {
    const page1 = await client.getAuthorFeed('bsky.app');
    if (!page1.cursor) return; // Skip if only one page

    const page2 = await client.getAuthorFeed('bsky.app', page1.cursor);
    expect(page2.feed.length).toBeGreaterThan(0);
    expect(page2.feed[0].post.uri).not.toBe(page1.feed[0].post.uri);
  }, 15000);

  it('searches posts (requires auth — skipped in read-only mode)', async () => {
    // searchPosts requires authentication, so with a read-only client it will throw
    await expect(client.searchPosts('bluesky')).rejects.toThrow();
  }, 10000);

  it('searches actors', async () => {
    const actors = await client.searchActors('bluesky');
    expect(actors.length).toBeGreaterThan(0);
    expect(actors[0].handle).toBeTruthy();
  }, 10000);

  it('fetches another user profile', async () => {
    const profile = await client.getProfile('jay.bsky.team');
    expect(profile.handle).toBe('jay.bsky.team');
    expect(profile.did).toMatch(/^did:/);
  }, 10000);

  it('handles non-existent user gracefully', async () => {
    await expect(
      client.getProfile('thisuserdoesnotexist12345678.bsky.social')
    ).rejects.toThrow();
  }, 10000);
});
