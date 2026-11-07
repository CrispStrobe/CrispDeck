import { describe, expect, it } from 'vitest';
import { detectCrossposts, normalizePost } from './unified';
import type { UnifiedPost } from '$lib/types';

function post(uri: string, platform: 'bluesky' | 'mastodon', text: string): UnifiedPost {
  return { uri, platform, text, author: { handle: `${platform}.example` }, createdAt: '2026-11-07T12:00:00Z', isRepost: false };
}

describe('feed cache freshness', () => {
  it('uses current source accounts and viewer state after fetching the same URIs again', () => {
    const old = { ...post('at://cache/post', 'bluesky', 'An unchanged post'), sourceAccountId: 1, likeCount: 0, raw: { viewer: {} } };
    detectCrossposts([old]);
    const fresh = { ...old, sourceAccountId: 2, likeCount: 10, raw: { viewer: { like: 'at://viewer/like' } } };
    expect(detectCrossposts([fresh])).toEqual([fresh]);
    expect(detectCrossposts([fresh])[0]).toBe(fresh);
  });

  it('recomputes a group after an in-place edit without changing the URI', () => {
    const first = post('at://edit/first', 'bluesky', 'The compiler now preserves nested generic type names');
    const second = post('https://edit/second', 'mastodon', first.text);
    const posts = [first, second];
    expect(detectCrossposts(posts)).toHaveLength(1);
    second.text = 'A completely unrelated photograph of mountains at sunset';
    expect(detectCrossposts(posts)).toEqual(posts);
  });

  it('responds when confirmed identity pairs are added and removed in place', () => {
    const posts = [post('at://identity/first', 'bluesky', 'Good morning'), post('https://identity/second', 'mastodon', 'Good morning')];
    const pairs = new Set<string>();
    expect(detectCrossposts(posts, pairs)).toHaveLength(2);
    pairs.add('bluesky.example<>mastodon.example');
    expect(detectCrossposts(posts, pairs)).toHaveLength(1);
    pairs.clear();
    expect(detectCrossposts(posts, pairs)).toHaveLength(2);
  });

  it('does not reuse stripped HTML after a same-length Mastodon edit', () => {
    const original = { uri: 'https://edited.example/post', id: '1', content: '<p>First</p>', createdAt: '2026-11-07T12:00:00Z', account: { acct: 'alice', url: 'https://edited.example/@alice' } };
    expect(normalizePost(original as any, 'mastodon').text).toBe('First');
    expect(normalizePost({ ...original, content: '<p>Other</p>' } as any, 'mastodon').text).toBe('Other');
  });
});
