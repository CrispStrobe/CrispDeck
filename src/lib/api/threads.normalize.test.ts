/**
 * Tests for Threads post normalization in the unified feed pipeline.
 */
import { describe, it, expect } from 'vitest';
import { normalizePost } from './unified';
import type { ThreadsPost } from './threads';

function makeThreadsPost(overrides: Partial<ThreadsPost> = {}): ThreadsPost {
  return {
    id: '123456789',
    media_product_type: 'THREADS',
    media_type: 'TEXT_POST',
    permalink: 'https://www.threads.net/@testuser/post/ABC123',
    username: 'testuser',
    text: 'Hello from Threads!',
    timestamp: '2026-06-10T12:00:00Z',
    is_quote_post: false,
    ...overrides,
  };
}

describe('normalizePost (threads)', () => {
  it('normalizes a basic text post', () => {
    const post = makeThreadsPost();
    const result = normalizePost(post, 'threads');

    expect(result.platform).toBe('threads');
    expect(result.text).toBe('Hello from Threads!');
    expect(result.author.handle).toBe('@testuser');
    expect(result.uri).toBe('https://www.threads.net/@testuser/post/ABC123');
    expect(result.createdAt).toBe('2026-06-10T12:00:00Z');
  });

  it('handles missing text gracefully', () => {
    const post = makeThreadsPost({ text: undefined });
    const result = normalizePost(post, 'threads');
    expect(result.text).toBe('');
  });

  it('handles missing username', () => {
    const post = makeThreadsPost({ username: undefined });
    const result = normalizePost(post, 'threads');
    expect(result.author.handle).toBe('?');
  });

  it('handles missing permalink', () => {
    const post = makeThreadsPost({ permalink: undefined });
    const result = normalizePost(post, 'threads');
    expect(result.uri).toBe('threads://123456789');
  });

  it('handles missing timestamp', () => {
    const post = makeThreadsPost({ timestamp: undefined });
    const result = normalizePost(post, 'threads');
    expect(result.createdAt).toBeTruthy();
  });

  it('normalizes image post with media_url', () => {
    const post = makeThreadsPost({
      media_type: 'IMAGE',
      media_url: 'https://scontent.cdninstagram.com/image.jpg',
    });
    const result = normalizePost(post, 'threads');
    expect(result.embeds).toBeTruthy();
    expect((result.embeds as any).url).toBe('https://scontent.cdninstagram.com/image.jpg');
    expect((result.embeds as any).type).toBe('IMAGE');
  });

  it('normalizes video post', () => {
    const post = makeThreadsPost({
      media_type: 'VIDEO',
      media_url: 'https://scontent.cdninstagram.com/video.mp4',
    });
    const result = normalizePost(post, 'threads');
    expect((result.embeds as any).type).toBe('VIDEO');
  });

  it('handles carousel post', () => {
    const post = makeThreadsPost({
      media_type: 'CAROUSEL_ALBUM',
      children: { data: [{ id: 'child1' }, { id: 'child2' }] },
    });
    const result = normalizePost(post, 'threads');
    expect(result.platform).toBe('threads');
  });

  it('has zero engagement counts (Threads API returns them separately)', () => {
    const result = normalizePost(makeThreadsPost(), 'threads');
    expect(result.replyCount).toBe(0);
    expect(result.repostCount).toBe(0);
    expect(result.likeCount).toBe(0);
  });

  it('sets raw to original post', () => {
    const post = makeThreadsPost();
    const result = normalizePost(post, 'threads');
    expect(result.raw).toBe(post);
  });

  it('handles quote post', () => {
    const post = makeThreadsPost({ is_quote_post: true });
    const result = normalizePost(post, 'threads');
    expect(result.platform).toBe('threads');
  });

  it('text post has no embeds', () => {
    const post = makeThreadsPost({ media_type: 'TEXT_POST', media_url: undefined });
    const result = normalizePost(post, 'threads');
    expect(result.embeds).toBeUndefined();
  });
});
