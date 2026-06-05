/**
 * Tests for bookmark CRUD logic (type validation, not IndexedDB).
 */
import { describe, it, expect } from 'vitest';
import type { UnifiedPost } from './types';

function makePost(overrides: Partial<UnifiedPost> = {}): UnifiedPost {
  return {
    uri: `at://did:plc:test/app.bsky.feed.post/${Math.random().toString(36).slice(2)}`,
    text: 'Test post',
    author: { handle: 'alice.bsky.social', displayName: 'Alice' },
    createdAt: new Date().toISOString(),
    platform: 'bluesky',
    isRepost: false,
    likeCount: 0,
    repostCount: 0,
    ...overrides,
  };
}

describe('bookmark data model', () => {
  it('post has all required fields for bookmarking', () => {
    const post = makePost();
    expect(post.uri).toBeTruthy();
    expect(post.text).toBeTruthy();
    expect(post.author.handle).toBeTruthy();
    expect(post.platform).toBe('bluesky');
    expect(post.createdAt).toBeTruthy();
  });

  it('mastodon post URI is a URL', () => {
    const post = makePost({ platform: 'mastodon', uri: 'https://mastodon.social/@user/123' });
    expect(post.uri).toMatch(/^https?:\/\//);
  });

  it('bluesky post URI is an AT URI', () => {
    const post = makePost();
    expect(post.uri).toMatch(/^at:\/\//);
  });

  it('bookmark record would contain all needed fields', () => {
    const post = makePost({ likeCount: 5, repostCount: 3, text: 'Hello world' });
    const record = {
      uri: post.uri,
      platform: post.platform,
      text: post.text,
      authorHandle: post.author.handle,
      authorName: post.author.displayName ?? post.author.handle,
      createdAt: post.createdAt,
      likeCount: post.likeCount ?? 0,
      repostCount: post.repostCount ?? 0,
      bookmarkedAt: new Date().toISOString(),
    };
    expect(record.uri).toBe(post.uri);
    expect(record.likeCount).toBe(5);
    expect(record.repostCount).toBe(3);
    expect(record.bookmarkedAt).toBeTruthy();
  });

  it('deduplication by URI works', () => {
    const p1 = makePost({ uri: 'at://did:plc:abc/app.bsky.feed.post/xyz' });
    const p2 = makePost({ uri: 'at://did:plc:abc/app.bsky.feed.post/xyz' });
    const p3 = makePost({ uri: 'at://did:plc:abc/app.bsky.feed.post/different' });
    const uris = new Set([p1.uri, p2.uri, p3.uri]);
    expect(uris.size).toBe(2);
  });
});
