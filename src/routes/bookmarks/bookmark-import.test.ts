import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { Account } from '$lib/types';
import type { ClientEntry } from '$lib/api/client-factory';

const boundaries = vi.hoisted(() => ({ initAllClients: vi.fn() }));
vi.mock('$lib/api/client-factory', () => ({ initAllClients: boundaries.initAllClients }));
import BookmarksPage from './+page.svelte';
import { listBookmarks, removeBookmark } from '$lib/bookmarks';

let instance: ReturnType<typeof mount> | undefined;
beforeEach(async () => {
  vi.clearAllMocks(); localStorage.clear();
  for (const post of await listBookmarks()) await removeBookmark(post.uri);
});
afterEach(async () => { if (instance) await unmount(instance); instance = undefined; document.body.innerHTML = ''; });

describe('bookmark imports preserve their account and normalized post', () => {
  it('imports from each exact account, retains Mastodon media, and refreshes after bookmark changes', async () => {
    const accounts = [
      { id: 1, platform: 'bluesky', handle: 'personal.bsky.social' },
      { id: 2, platform: 'bluesky', handle: 'work.bsky.social' },
      { id: 3, platform: 'mastodon', handle: 'work@social.example' },
    ] as Account[];
    const agents = accounts.slice(0, 2).map(account => ({ did: `did:plc:${account.id}`, call: vi.fn().mockResolvedValue({ data: { bookmarks: [{
      subject: { uri: `at://did:plc:alice/app.bsky.feed.post/${account.id}`, cid: `cid${account.id}` },
      item: { $type: 'app.bsky.feed.defs#postView', uri: `at://did:plc:alice/app.bsky.feed.post/${account.id}`, cid: `cid${account.id}`,
        author: { did: 'did:plc:alice', handle: 'alice.bsky.social' }, record: { text: `Post ${account.id}`, createdAt: '2026-01-01T00:00:00Z' } },
    }] } }) }));
    const mastodon = { getBookmarks: vi.fn().mockResolvedValue([{
      id: 'local-original', uri: 'https://remote.example/users/alice/statuses/remote-original', content: '<p>A saved photo</p>',
      createdAt: '2026-01-01T00:00:00Z', account: { acct: 'alice@remote.example', url: 'https://remote.example/@alice', displayName: 'Alice' },
      spoilerText: 'Photo spoiler', mediaAttachments: [{ type: 'image', url: 'https://remote.example/full.png', previewUrl: 'https://remote.example/thumb.png', description: 'Photo alt text' }],
    }]) };
    const clients = new Map<number, ClientEntry>([
      [1, { accountId: 1, platform: 'bluesky', handle: accounts[0].handle, oauthAgent: agents[0] } as unknown as ClientEntry],
      [2, { accountId: 2, platform: 'bluesky', handle: accounts[1].handle, oauthAgent: agents[1] } as unknown as ClientEntry],
      [3, { accountId: 3, platform: 'mastodon', handle: accounts[2].handle, client: mastodon } as unknown as ClientEntry],
    ]);
    boundaries.initAllClients.mockResolvedValue({ accounts, clients });
    const target = document.createElement('div'); document.body.append(target);
    instance = mount(BookmarksPage, { target }); flushSync();
    await vi.waitFor(() => { flushSync(); expect(target.querySelector('button[title="Import bookmarks from connected platforms"]')).not.toBeNull(); });
    target.querySelector<HTMLButtonElement>('button[title="Import bookmarks from connected platforms"]')!.click(); flushSync();
    await vi.waitFor(async () => expect(await listBookmarks()).toHaveLength(3));
    const saved = await listBookmarks();
    for (const id of [1, 2]) {
      expect(saved.find(post => post.uri === `at://did:plc:alice/app.bsky.feed.post/${id}`)).toMatchObject({ sourceAccountId: id, sourceAccount: accounts[id - 1].handle });
      expect(agents[id - 1].call).toHaveBeenCalledTimes(1);
      expect(agents[id - 1].call).toHaveBeenCalledWith('app.bsky.bookmark.getBookmarks', { limit: 100 });
    }
    const imported = saved.find(post => post.platform === 'mastodon')!;
    expect(mastodon.getBookmarks).toHaveBeenCalledTimes(1);
    expect(imported).toMatchObject({ sourceAccountId: 3, sourceAccount: 'work@social.example', contentWarning: 'Photo spoiler',
      embeds: [{ previewUrl: 'https://remote.example/thumb.png', description: 'Photo alt text' }], raw: { id: 'local-original' } });
    await vi.waitFor(() => { flushSync(); expect(target.querySelectorAll('article')).toHaveLength(3); });
    expect(target.querySelector('a[href*="id=local-original"]')?.getAttribute('href')).toContain('&account=3');
    await removeBookmark('at://did:plc:alice/app.bsky.feed.post/1');
    await vi.waitFor(() => { flushSync(); expect(target.querySelectorAll('article')).toHaveLength(2); });
  });
});
