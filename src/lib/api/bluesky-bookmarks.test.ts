import { describe, it, expect, vi } from 'vitest';
import {
  createBlueskyBookmark,
  deleteBlueskyBookmark,
  getBlueskyBookmarks,
  getAllBlueskyBookmarks,
} from './bluesky-bookmarks';

function mockAgent(callImpl: (...args: any[]) => any) {
  return { call: vi.fn(callImpl) } as any;
}

describe('bluesky-bookmarks', () => {
  it('createBlueskyBookmark posts uri + cid', async () => {
    const agent = mockAgent(async () => ({ data: {} }));
    await createBlueskyBookmark(agent, 'at://did:plc:x/app.bsky.feed.post/abc', 'bafycid');
    expect(agent.call).toHaveBeenCalledWith(
      'app.bsky.bookmark.createBookmark',
      undefined,
      { uri: 'at://did:plc:x/app.bsky.feed.post/abc', cid: 'bafycid' },
      { encoding: 'application/json' },
    );
  });

  it('deleteBlueskyBookmark posts uri', async () => {
    const agent = mockAgent(async () => ({ data: {} }));
    await deleteBlueskyBookmark(agent, 'at://did:plc:x/app.bsky.feed.post/abc');
    expect(agent.call).toHaveBeenCalledWith(
      'app.bsky.bookmark.deleteBookmark',
      undefined,
      { uri: 'at://did:plc:x/app.bsky.feed.post/abc' },
      { encoding: 'application/json' },
    );
  });

  it('getBlueskyBookmarks returns bookmarks and cursor', async () => {
    const agent = mockAgent(async () => ({
      data: { bookmarks: [{ subject: { uri: 'at://a', cid: 'c' } }], cursor: 'next' },
    }));
    const res = await getBlueskyBookmarks(agent, { limit: 10 });
    expect(res.bookmarks).toHaveLength(1);
    expect(res.cursor).toBe('next');
    expect(agent.call).toHaveBeenCalledWith('app.bsky.bookmark.getBookmarks', { limit: 10 });
  });

  it('getBlueskyBookmarks tolerates missing bookmarks field', async () => {
    const agent = mockAgent(async () => ({ data: {} }));
    const res = await getBlueskyBookmarks(agent);
    expect(res.bookmarks).toEqual([]);
    expect(res.cursor).toBeUndefined();
  });

  it('getAllBlueskyBookmarks paginates until cursor is exhausted', async () => {
    let call = 0;
    const agent = mockAgent(async () => {
      call++;
      return call === 1
        ? { data: { bookmarks: [{ subject: { uri: 'at://1', cid: 'c1' } }], cursor: 'p2' } }
        : { data: { bookmarks: [{ subject: { uri: 'at://2', cid: 'c2' } }] } };
    });
    const all = await getAllBlueskyBookmarks(agent);
    expect(all.map(b => b.subject.uri)).toEqual(['at://1', 'at://2']);
    expect(agent.call).toHaveBeenCalledTimes(2);
  });

  it('getAllBlueskyBookmarks respects the page cap', async () => {
    const agent = mockAgent(async () => ({
      data: { bookmarks: [{ subject: { uri: 'at://x', cid: 'c' } }], cursor: 'again' },
    }));
    const all = await getAllBlueskyBookmarks(agent, 3);
    expect(all).toHaveLength(3);
    expect(agent.call).toHaveBeenCalledTimes(3);
  });
});
