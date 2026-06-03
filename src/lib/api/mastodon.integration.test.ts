/**
 * Integration tests that hit the real Mastodon public API.
 * Uses mastodon.social's public endpoints (no auth needed for public data).
 */
import { describe, it, expect } from 'vitest';
import { MastodonClient, mastodonClientFromHandle } from './mastodon';
import { normalizePost } from './unified';

describe('MastodonClient (live API)', () => {
  const client = new MastodonClient('https://mastodon.social');

  it('looks up account by handle', async () => {
    const account = await client.getAccountByHandle('Gargron');
    expect(account.id).toBeTruthy();
    expect(account.acct).toBe('Gargron');
    expect(account.displayName).toBeTruthy();
    expect(account.url).toContain('mastodon.social');
  }, 10000);

  it('fetches account statuses', async () => {
    const account = await client.getAccountByHandle('Gargron');
    const statuses = await client.getAccountStatuses(account.id);
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.length).toBeLessThanOrEqual(40);

    const status = statuses[0];
    expect(status.id).toBeTruthy();
    expect(status.content).toBeDefined();
    expect(status.createdAt).toBeTruthy();
    expect(status.account.acct).toBe('Gargron');
  }, 10000);

  it('normalizes Mastodon posts correctly', async () => {
    const account = await client.getAccountByHandle('Gargron');
    const statuses = await client.getAccountStatuses(account.id);
    const post = normalizePost(statuses[0], 'mastodon');

    expect(post.platform).toBe('mastodon');
    expect(post.uri).toMatch(/^https?:\/\//);
    // If it's a reblog, author might be from another instance
    expect(post.author.handle).toMatch(/@.+@.+/);
    expect(post.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(typeof post.text).toBe('string');
    // HTML should be stripped
    expect(post.text).not.toContain('<p>');
    expect(post.text).not.toContain('</p>');
    expect(typeof post.likeCount).toBe('number');
    expect(typeof post.repostCount).toBe('number');
    expect(typeof post.isRepost).toBe('boolean');
  }, 10000);

  it('supports pagination via cursor', async () => {
    const account = await client.getAccountByHandle('Gargron');
    const page1 = await client.getAccountStatuses(account.id);
    if (page1.length === 0) return;

    const lastId = page1[page1.length - 1].id;
    const page2 = await client.getAccountStatuses(account.id, lastId);
    expect(page2.length).toBeGreaterThan(0);
    expect(page2[0].id).not.toBe(page1[0].id);
  }, 15000);

  it('can exclude replies', async () => {
    const account = await client.getAccountByHandle('Gargron');
    const statuses = await client.getAccountStatuses(account.id, undefined, true, false);
    // All returned statuses should not be replies (though API may not be perfect)
    for (const s of statuses.slice(0, 5)) {
      // inReplyToId should be null or undefined (not a string pointing to a parent)
      expect(s.inReplyToId).toBeFalsy();
    }
  }, 10000);

  it('handles non-existent account', async () => {
    await expect(
      client.getAccountByHandle('thisuserdoesnotexist99999999')
    ).rejects.toThrow();
  }, 10000);
});

describe('mastodonClientFromHandle', () => {
  it('creates client from full handle', () => {
    const client = mastodonClientFromHandle('user@mastodon.social');
    expect(client.getInstanceUrl()).toBe('https://mastodon.social');
  });

  it('creates client from @-prefixed handle', () => {
    const client = mastodonClientFromHandle('@user@fosstodon.org');
    expect(client.getInstanceUrl()).toBe('https://fosstodon.org');
  });

  it('throws on invalid handle', () => {
    expect(() => mastodonClientFromHandle('nope')).toThrow('Invalid Mastodon handle');
  });

  it('throws on empty handle', () => {
    expect(() => mastodonClientFromHandle('')).toThrow();
  });
});
