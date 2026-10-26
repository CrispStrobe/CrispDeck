import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '$lib/types';
import type { ClientEntry } from '$lib/api/client-factory';
import { snapshot } from './snapshots';
import { all, remove, write } from './storage';

const writers = vi.hoisted(() => ({ bluesky: vi.fn(), mastodon: vi.fn(), threads: vi.fn() }));
vi.mock('$lib/compose/adapter', () => ({
  postToBluesky: writers.bluesky, postToMastodon: writers.mastodon, postToThreads: writers.threads,
}));
vi.mock('$lib/api/client-factory', () => ({ initAllClients: vi.fn() }));
vi.mock('$lib/compose/mentions', () => ({ resolveMentionsForPlatform: async (text: string) => text }));
import { createJob, deliverJob, getJob, isComplete, needsReview } from './outbox';

const account = (id: number, platform: Account['platform'] = 'mastodon') => ({ id, handle: `person${id}.example`, platform } as Account);
const clients = (...accounts: Account[]) => new Map(accounts.map(a => [a.id, { accountId: a.id, platform: a.platform, handle: a.handle, client: { id: a.id } } as unknown as ClientEntry]));

beforeEach(async () => {
  vi.clearAllMocks();
  for (const job of await all<{ id: string }>('jobs')) await remove('jobs', job.id);
});

describe('durable delivery', () => {
  it('retries only the failed account, even when both accounts use the same network', async () => {
    const accounts = [account(1), account(2)];
    const saved = snapshot('test', 'Hello', [1, 2], {}, {});
    const job = await createJob(saved, accounts);
    writers.mastodon.mockResolvedValueOnce({ success: true, platform: 'mastodon', uri: 'https://social.example/@one/11', id: '11' })
      .mockResolvedValueOnce({ success: false, platform: 'mastodon', error: 'Expired session' });
    const partial = await deliverJob(job.id, clients(...accounts));
    expect(partial.status).toBe('partial');
    expect((await getJob(job.id))?.destinations[0].parts[0].status).toBe('posted');
    writers.mastodon.mockResolvedValueOnce({ success: true, platform: 'mastodon', uri: 'https://social.example/@two/22', id: '22' });
    const complete = await deliverJob(job.id, clients(...accounts));
    expect(isComplete(complete)).toBe(true);
    expect(writers.mastodon).toHaveBeenCalledTimes(3);
    expect(writers.mastodon.mock.calls[2][0].id).toBe(2);
    expect(writers.mastodon.mock.calls[2][1].deliveryKey).toBe(writers.mastodon.mock.calls[1][1].deliveryKey);
  });

  it('resumes a thread at the failed part and uses the saved parent id', async () => {
    const a = account(1);
    const job = await createJob(snapshot('test', 'A sentence. '.repeat(90), [1], {}, {}), [a]);
    expect(job.destinations[0].parts.length).toBeGreaterThan(2);
    writers.mastodon.mockResolvedValueOnce({ success: true, platform: 'mastodon', id: 'first', uri: 'https://social.example/first' })
      .mockResolvedValueOnce({ success: false, platform: 'mastodon', error: 'Try later' });
    await deliverJob(job.id, clients(a));
    let next = 0;
    writers.mastodon.mockImplementation(async () => ({ success: true, platform: 'mastodon', id: `next${++next}`, uri: `https://social.example/next${next}` }));
    const complete = await deliverJob(job.id, clients(a));
    expect(isComplete(complete)).toBe(true);
    expect(writers.mastodon.mock.calls[2][1].replyTo.id).toBe('first');
    expect(writers.mastodon.mock.calls[2][1].mediaFiles).toBeUndefined();
    expect(writers.mastodon).toHaveBeenCalledTimes(job.destinations[0].parts.length + 1);
  });

  it('requires review before repeating an ambiguous Threads write', async () => {
    const a = account(1, 'threads');
    const job = await createJob(snapshot('test', 'Hello', [1], {}, {}), [a]);
    writers.threads.mockResolvedValueOnce({ platform: 'threads', success: false, error: 'Connection lost', uncertain: true });
    const failed = await deliverJob(job.id, clients(a));
    expect(needsReview(failed)).toBe(true);
    await deliverJob(job.id, clients(a));
    expect(writers.threads).toHaveBeenCalledTimes(1);
    writers.threads.mockResolvedValueOnce({ platform: 'threads', success: true, id: '123', uri: 'https://threads.net/post/123' });
    expect(isComplete(await deliverJob(job.id, clients(a), true))).toBe(true);
  });

  it('preserves missing destinations for reconnect instead of silently dropping them', async () => {
    const a = account(1);
    const job = await createJob(snapshot('test', 'Hello', [1], {}, {}), [a]);
    const failed = await deliverJob(job.id, new Map());
    expect(failed.destinations[0].parts[0].error).toMatch(/Reconnect/);
    expect(writers.mastodon).not.toHaveBeenCalled();
  });

  it('never replays a complete job', async () => {
    const a = account(1);
    const job = await createJob(snapshot('test', 'Hello', [1], {}, {}), [a]);
    writers.mastodon.mockResolvedValue({ platform: 'mastodon', success: true, id: '11', uri: 'https://social.example/11' });
    await deliverJob(job.id, clients(a));
    await deliverJob(job.id, clients(a));
    expect(writers.mastodon).toHaveBeenCalledTimes(1);
  });

  it('coordinates simultaneous retries across windows', async () => {
    const a = account(1);
    const job = await createJob(snapshot('test', 'Hello', [1], {}, {}), [a]);
    let release!: () => void;
    const response = new Promise<void>(resolve => { release = resolve; });
    writers.mastodon.mockImplementation(async () => {
      await response;
      return { platform: 'mastodon', success: true, id: '11', uri: 'https://social.example/11' };
    });
    const first = deliverJob(job.id, clients(a));
    await vi.waitFor(() => expect(writers.mastodon).toHaveBeenCalledTimes(1));
    const second = await deliverJob(job.id, clients(a));
    expect(second.destinations[0].parts[0].status).toBe('sending');
    release();
    expect(isComplete(await first)).toBe(true);
    expect(writers.mastodon).toHaveBeenCalledTimes(1);
  });

  it('requires verification after Mastodon duplicate protection has expired', async () => {
    const a = account(1);
    const job = await createJob(snapshot('test', 'Hello', [1], {}, {}), [a]);
    job.destinations[0].parts[0].status = 'failed';
    job.destinations[0].parts[0].attemptedAt = new Date(Date.now() - 7_200_000).toISOString();
    await write('jobs', job);
    expect(needsReview(job)).toBe(true);
    const resumed = await deliverJob(job.id, clients(a));
    expect(resumed.destinations[0].parts[0].status).toBe('uncertain');
    expect(writers.mastodon).not.toHaveBeenCalled();
  });

  it('can retry after reconnecting the same handle under a new local account id', async () => {
    const original = account(1);
    const job = await createJob(snapshot('test', 'Hello', [1], {}, {}), [original]);
    const reconnected = { ...original, id: 7 };
    writers.mastodon.mockResolvedValue({ platform: 'mastodon', success: true, id: '11', uri: 'https://social.example/11' });
    expect(isComplete(await deliverJob(job.id, clients(reconnected)))).toBe(true);
    expect(writers.mastodon.mock.calls[0][0].id).toBe(7);
    expect(writers.mastodon.mock.calls[0][1].deliveryKey).toContain(`${job.id}-1-0`);
  });

  it('retains destination overrides in the durable plan', async () => {
    const accounts = [account(1), account(2)];
    const job = await createJob(snapshot('test', 'Shared', [1, 2], { '2': 'Custom' }, {}), accounts);
    expect(job.destinations.map(d => d.parts[0].text)).toEqual(['Shared', 'Custom']);
  });
});
