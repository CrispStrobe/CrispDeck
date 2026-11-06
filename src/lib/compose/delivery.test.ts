import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@atproto/api';
import type { BlueskyClient } from '$lib/api/bluesky';
import type { MastodonClient } from '$lib/api/mastodon';
import type { ThreadsClient } from '$lib/api/threads';
import { postToBluesky, postToMastodon, postToThreads } from './adapter';

vi.mock('$lib/api/atproto-sdk', () => ({
  loadAtprotoSdk: async () => ({ RichText: class {
    text: string;
    facets = [];
    constructor({ text }: { text: string }) { this.text = text; }
    async detectFacets() {}
  } }),
}));

beforeEach(() => { vi.restoreAllMocks(); });

describe('protocol delivery contracts', () => {
  it('uses the OAuth agent and the same Bluesky record key on retry', async () => {
    const putRecord = vi.fn().mockResolvedValue({ data: { uri: 'at://did:plc:writer/app.bsky.feed.post/3jzfcijpj2z2a', cid: 'cid' } });
    const createRecord = vi.fn();
    const agent = { did: 'did:plc:writer', api: { com: { atproto: { repo: { putRecord, createRecord } } } } } as unknown as Agent;
    const client = { getAgent: vi.fn(() => { throw new Error('read-only'); }) } as unknown as BlueskyClient;
    const options = { text: 'Hello', recordKey: '3jzfcijpj2z2a', createdAt: '2026-10-26T12:00:00.000Z' };
    expect((await postToBluesky(client, options, agent)).success).toBe(true);
    expect((await postToBluesky(client, options, agent)).success).toBe(true);
    expect(createRecord).not.toHaveBeenCalled();
    expect(client.getAgent).not.toHaveBeenCalled();
    expect(putRecord.mock.calls.map(([args]) => args.rkey)).toEqual([options.recordKey, options.recordKey]);
    expect(putRecord.mock.calls[0][0].record.createdAt).toBe(options.createdAt);
  });

  it('sends a stable Mastodon idempotency key and retains the parent status id', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: '11', url: 'https://social.example/@writer/11' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: '12', url: 'https://social.example/@writer/12' }) });
    vi.stubGlobal('fetch', fetch);
    try {
      const client = { getInstanceUrl: () => 'https://social.example', getAccessToken: () => 'test' } as unknown as MastodonClient;
      const options = { text: 'Part two', deliveryKey: 'job-1-part-2', replyTo: { uri: 'https://social.example/@writer/11', id: '11' } };
      const result = await postToMastodon(client, options);
      expect(result.id).toBe('12');
      expect(fetch.mock.calls[1][1].headers['Idempotency-Key']).toBe(options.deliveryKey);
      expect(JSON.parse(fetch.mock.calls[1][1].body).in_reply_to_id).toBe('11');
    } finally { vi.unstubAllGlobals(); }
  });

  it('resolves a reply against the destination instance before writing', async () => {
    const uri = 'https://remote.test/users/author/statuses/77';
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'old-local-id', uri: 'https://other.test/unrelated' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ statuses: [{ id: 'new-local-id', uri }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'posted', url: 'https://destination.test/@writer/posted' }) });
    vi.stubGlobal('fetch', fetch);
    try {
      const client = { getInstanceUrl: () => 'https://destination.test', getAccessToken: () => 'destination-token' } as unknown as MastodonClient;
      const result = await postToMastodon(client, { text: 'Reply', replyTo: { uri, id: 'old-local-id' } });
      expect(result.success).toBe(true);
      expect(new URL(fetch.mock.calls[1][0]).searchParams.get('q')).toBe(uri);
      expect(fetch.mock.calls.every(([url, options]) => new URL(url).origin === 'https://destination.test' && options.headers.Authorization === 'Bearer destination-token')).toBe(true);
      expect(JSON.parse(fetch.mock.calls[2][1].body).in_reply_to_id).toBe('new-local-id');
    } finally { vi.unstubAllGlobals(); }
  });

  it('does not upload or publish if the reply URL cannot be resolved', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ statuses: [] }) });
    vi.stubGlobal('fetch', fetch);
    try {
      const client = { getInstanceUrl: () => 'https://destination.test', getAccessToken: () => 'destination-token' } as unknown as MastodonClient;
      const result = await postToMastodon(client, { text: 'Reply', replyTo: { uri: 'https://remote.test/@author/77' }, mediaFiles: [new File(['image'], 'photo.png', { type: 'image/png' })] });
      expect(result).toMatchObject({ success: false, uncertain: false });
      expect(result.error).toContain('unavailable');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][1].method).toBeUndefined();
    } finally { vi.unstubAllGlobals(); }
  });

  it('distinguishes an uncertain Threads publish from a failed container creation', async () => {
    const client = {
      createTextContainer: vi.fn().mockResolvedValue('container'), waitForContainer: vi.fn().mockResolvedValue({}),
      publishContainer: vi.fn().mockRejectedValue(new Error('Connection lost')),
    } as unknown as ThreadsClient;
    expect((await postToThreads(client, { text: 'Hello' })).uncertain).toBe(true);
    vi.mocked(client.createTextContainer).mockRejectedValue(new Error('Invalid token'));
    expect((await postToThreads(client, { text: 'Hello' })).uncertain).toBe(false);
    expect(client.publishContainer).toHaveBeenCalledTimes(1);
  });
});
