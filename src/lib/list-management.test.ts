/**
 * Tests for list management — Mastodon + Bluesky list operations.
 * Mocks fetch for Mastodon API calls and AT Protocol agent for Bluesky.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getMastodonLists,
  createMastodonList,
  deleteMastodonList,
  renameMastodonList,
  addToMastodonList,
  removeFromMastodonList,
  createBlueskyList,
  deleteBlueskyList,
  addToBlueskyList,
} from './list-management';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

describe('Mastodon list operations', () => {
  const url = 'https://mastodon.social';
  const token = 'test-token';

  it('getMastodonLists fetches and returns lists', async () => {
    const lists = [{ id: '1', title: 'Tech' }, { id: '2', title: 'Friends' }];
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(lists) });

    const result = await getMastodonLists(url, token);
    expect(result).toEqual(lists);
    expect(mockFetch).toHaveBeenCalledWith(`${url}/api/v1/lists`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  });

  it('getMastodonLists throws on error', async () => {
    mockFetch.mockResolvedValue({ ok: false, statusText: 'Unauthorized' });
    await expect(getMastodonLists(url, token)).rejects.toThrow('Failed to fetch lists');
  });

  it('createMastodonList sends POST with title', async () => {
    const created = { id: '3', title: 'New List' };
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(created) });

    const result = await createMastodonList(url, token, 'New List');
    expect(result).toEqual(created);
    expect(mockFetch).toHaveBeenCalledWith(`${url}/api/v1/lists`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ title: 'New List' }),
    }));
  });

  it('deleteMastodonList sends DELETE', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    await deleteMastodonList(url, token, '42');
    expect(mockFetch).toHaveBeenCalledWith(`${url}/api/v1/lists/42`, expect.objectContaining({
      method: 'DELETE',
    }));
  });

  it('renameMastodonList sends PUT with new title', async () => {
    const renamed = { id: '1', title: 'Renamed' };
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(renamed) });

    const result = await renameMastodonList(url, token, '1', 'Renamed');
    expect(result.title).toBe('Renamed');
  });

  it('addToMastodonList sends account IDs', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    await addToMastodonList(url, token, '1', ['acc1', 'acc2']);
    expect(mockFetch).toHaveBeenCalledWith(`${url}/api/v1/lists/1/accounts`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ account_ids: ['acc1', 'acc2'] }),
    }));
  });

  it('removeFromMastodonList sends DELETE with account IDs', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    await removeFromMastodonList(url, token, '1', ['acc1']);
    expect(mockFetch).toHaveBeenCalledWith(`${url}/api/v1/lists/1/accounts`, expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ account_ids: ['acc1'] }),
    }));
  });

  it('error responses throw descriptive messages', async () => {
    mockFetch.mockResolvedValue({ ok: false, statusText: 'Not Found' });
    await expect(deleteMastodonList(url, token, '999')).rejects.toThrow('Failed to delete list: Not Found');
  });
});

describe('Bluesky list operations', () => {
  function mockAgent(responses: Record<string, any> = {}) {
    return {
      did: 'did:plc:test',
      assertDid: 'did:plc:test',
      api: {
        com: {
          atproto: {
            repo: {
              createRecord: vi.fn().mockResolvedValue({ data: { uri: 'at://did:plc:test/app.bsky.graph.list/abc', ...responses } }),
              deleteRecord: vi.fn().mockResolvedValue(undefined),
            },
          },
        },
      },
    } as any;
  }

  it('createBlueskyList creates a curate list record', async () => {
    const agent = mockAgent();
    const uri = await createBlueskyList(agent, 'My List', 'A description');
    expect(uri).toContain('at://');
    expect(agent.api.com.atproto.repo.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: 'did:plc:test',
        collection: 'app.bsky.graph.list',
        record: expect.objectContaining({
          name: 'My List',
          description: 'A description',
          purpose: 'app.bsky.graph.defs#curatelist',
        }),
      }),
    );
  });

  it('deleteBlueskyList extracts rkey from URI', async () => {
    const agent = mockAgent();
    await deleteBlueskyList(agent, 'at://did:plc:test/app.bsky.graph.list/rkey123');
    expect(agent.api.com.atproto.repo.deleteRecord).toHaveBeenCalledWith({
      repo: 'did:plc:test',
      collection: 'app.bsky.graph.list',
      rkey: 'rkey123',
    });
  });

  it('addToBlueskyList creates a listitem record', async () => {
    const agent = mockAgent();
    await addToBlueskyList(agent, 'at://did:plc:test/list/1', 'did:plc:member');
    expect(agent.api.com.atproto.repo.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'app.bsky.graph.listitem',
        record: expect.objectContaining({
          subject: 'did:plc:member',
          list: 'at://did:plc:test/list/1',
        }),
      }),
    );
  });
});
