import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedPost } from './types';
import { addBookmark, importPlatformBookmarks, isBookmarked, listBookmarks, removeBookmark } from './bookmarks';

const post: UnifiedPost = { uri: 'https://remote.example/users/alice/statuses/1', text: 'A saved photo', platform: 'mastodon',
  author: { handle: 'alice@remote.example', displayName: 'Alice' }, createdAt: '2026-01-01T00:00:00Z',
  sourceAccountId: 2, sourceAccount: 'work@work.example', isRepost: true, repostAuthor: { handle: 'friend@work.example' },
  replyParentUri: 'parent-id', replyCount: 4, contentWarning: 'Spoilers', emojis: [{ shortcode: 'wave', url: 'https://remote.example/wave.png' }],
  embeds: [{ type: 'image', url: 'https://remote.example/photo.png', previewUrl: 'https://remote.example/thumb.png', description: 'A landscape' }],
  raw: { id: 'local-id', mediaAttachments: [{ type: 'image', url: 'https://remote.example/photo.png' }] },
};
beforeEach(async () => { for (const value of await listBookmarks()) await removeBookmark(value.uri); });

describe('bookmark persistence and import', () => {
  it.each(['add', 'import'] as const)('%s preserves source identity, media, reply context, and display metadata', async mode => {
    if (mode === 'add') await addBookmark(post);
    else await importPlatformBookmarks([post]);
    expect((await listBookmarks())[0]).toMatchObject(post);
  });

  it('announces a committed import and updates the URI cache without counting duplicate incoming posts', async () => {
    expect(await isBookmarked(post.uri)).toBe(false);
    const changed = vi.fn();
    window.addEventListener('crispdeck-bookmarks-changed', changed);
    try {
      expect(await importPlatformBookmarks([post, post])).toBe(1);
      expect(changed).toHaveBeenCalledTimes(1);
      expect(await isBookmarked(post.uri)).toBe(true);
      expect(await listBookmarks()).toHaveLength(1);
      expect(await importPlatformBookmarks([{ ...post, sourceAccountId: 9, text: 'Different account copy' }])).toBe(0);
      expect(changed).toHaveBeenCalledTimes(1);
      expect((await listBookmarks())[0].sourceAccountId).toBe(2);
    } finally { window.removeEventListener('crispdeck-bookmarks-changed', changed); }
  });

  it('stores reactive row metadata without passing uncloneable proxies to IndexedDB', async () => {
    const reactive = new Proxy({ ...post,
      raw: new Proxy(post.raw as object, {}),
      embeds: new Proxy(post.embeds as object, {}),
    }, {});
    await addBookmark(reactive);
    expect((await listBookmarks())[0]).toMatchObject(post);
  });
});
