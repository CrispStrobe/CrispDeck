import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listDrafts, deleteDraft, saveDraft } from '$lib/db';
import { persistDraft, draftSnapshot, publishDraft } from './drafts';
import { snapshot } from './snapshots';
import { all, remove } from './storage';
import { initAllClients } from '$lib/api/client-factory';
import type { Account } from '$lib/types';

const post = vi.hoisted(() => vi.fn());
vi.mock('$lib/compose/adapter', () => ({ postToBluesky: post, postToMastodon: vi.fn(), postToThreads: vi.fn() }));
vi.mock('$lib/compose/mentions', () => ({ resolveMentionsForPlatform: async (text: string) => text }));

vi.mock('$lib/api/client-factory', () => ({ initAllClients: vi.fn() }));

beforeEach(async () => {
  vi.clearAllMocks();
  for (const draft of await listDrafts()) await deleteDraft(draft.id);
  for (const store of ['jobs', 'snapshots', 'leases']) {
    for (const item of await all<{ id: string }>(store)) await remove(store, item.id);
  }
  const account = { id: 1, platform: 'bluesky', did: 'did:plc:writer', handle: 'writer.example.com' } as Account;
  vi.mocked(initAllClients).mockResolvedValue({ accounts: [account], clients: new Map([[1, {
    accountId: 1, platform: 'bluesky', handle: account.handle,
    client: {} as never, oauthAgent: { did: account.did } as never,
  }]]) });
  post.mockResolvedValue({ platform: 'bluesky', success: true, uri: 'at://did:plc:writer/app.bsky.feed.post/one', cid: 'cid' });
});

describe('complete draft persistence', () => {
  it('rescheduling updates the same draft and preserves destination settings', async () => {
    const saved = snapshot('test', 'Draft', [1, 2], { '2': 'Custom' }, {
      visibility: 'private', altTexts: ['Description'], threadGate: 'mentioned', disableQuotes: true,
    });
    const id = await persistDraft(saved);
    const first = (await listDrafts())[0];
    const at = '2026-12-01T12:00:00.000Z';
    expect(await persistDraft(saved, at, id)).toBe(id);
    const drafts = await listDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].created_at).toBe(first.created_at);
    expect(drafts[0].scheduled_at).toBe(at);
    const restored = await draftSnapshot(drafts[0]);
    expect(restored.overrides).toEqual({ '2': 'Custom' });
    expect(restored.options.visibility).toBe('private');
    expect(restored.options.altTexts).toEqual(['Description']);
    expect(restored.options.disableQuotes).toBe(true);
  });

  it('publishes the current saved revision when another window changed the draft', async () => {
    const first = snapshot('test', 'Old draft', [1], {}, {});
    const id = await persistDraft(first);
    const stale = (await listDrafts())[0];
    await persistDraft({ ...first, text: 'The reviewed revision' }, null, id);
    const result = await publishDraft(stale);
    expect(result.status).toBe('posted');
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1].text).toBe('The reviewed revision');
  });

  it('never recreates delivery from a deleted legacy draft snapshot', async () => {
    await saveDraft({ text: 'Do not publish', target_accounts: [1] });
    const stale = (await listDrafts())[0];
    await deleteDraft(stale.id);
    await expect(publishDraft(stale)).rejects.toThrow(/no longer/);
    expect(post).not.toHaveBeenCalled();
    expect(initAllClients).not.toHaveBeenCalled();
    expect(await all('jobs')).toEqual([]);
  });
});
