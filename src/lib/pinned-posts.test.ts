import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listPinnedPosts, pinPost, unpinPost, isPinned } from './pinned-posts';

describe('pinned posts', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
    });
  });

  it('starts empty', () => {
    expect(listPinnedPosts()).toEqual([]);
  });

  it('pins a post', () => {
    pinPost({ uri: 'at://1', text: 'Hello', author: { handle: 'alice' }, platform: 'bluesky' });
    expect(listPinnedPosts()).toHaveLength(1);
    expect(isPinned('at://1')).toBe(true);
  });

  it('does not duplicate pins', () => {
    pinPost({ uri: 'at://1', text: 'Hello', author: { handle: 'alice' }, platform: 'bluesky' });
    pinPost({ uri: 'at://1', text: 'Hello', author: { handle: 'alice' }, platform: 'bluesky' });
    expect(listPinnedPosts()).toHaveLength(1);
  });

  it('unpins a post', () => {
    pinPost({ uri: 'at://1', text: 'Hello', author: { handle: 'alice' }, platform: 'bluesky' });
    unpinPost('at://1');
    expect(listPinnedPosts()).toHaveLength(0);
    expect(isPinned('at://1')).toBe(false);
  });

  it('pins newest first', () => {
    pinPost({ uri: 'at://1', text: 'First', author: { handle: 'a' }, platform: 'bluesky' });
    pinPost({ uri: 'at://2', text: 'Second', author: { handle: 'b' }, platform: 'mastodon' });
    const pins = listPinnedPosts();
    expect(pins[0].uri).toBe('at://2');
  });
});
