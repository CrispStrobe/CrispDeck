import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { initAllClients } from '$lib/api/client-factory';

const account = (id: number, platform: Account['platform'] = 'mastodon'): Account => ({
  id, platform, handle: platform === 'mastodon' ? `@person${id}@social.example` : platform === 'bluesky' ? `person${id}.bsky.social` : `@person${id}`,
  did: platform === 'bluesky' ? `did:plc:person${id}` : null,
  mastodon_id: platform === 'mastodon' ? `100${id}` : null,
  threads_user_id: platform === 'threads' ? `200${id}` : null,
  instance_url: platform === 'mastodon' ? 'https://social.example' : null,
  display_name: null, avatar_url: null, is_primary: false, created_at: '', updated_at: '',
});
const mastodonProfiles = new Map<string, { id: string; acct: string }>();
const clients = (...accounts: Account[]) => new Map(accounts.map(a => {
  const token = `test-token-${a.id}`;
  mastodonProfiles.set(token, { id: a.mastodon_id!, acct: a.handle.replace(/^@/, '').split('@')[0] });
  const agent = { did: a.did, getProfile: vi.fn(async () => ({ data: { did: a.did, handle: a.handle } })) };
  const client = a.platform === 'bluesky' ? { id: a.id, getAgent: () => agent }
    : a.platform === 'mastodon' ? { id: a.id, getInstanceUrl: () => a.instance_url, getAccessToken: () => token }
      : { id: a.id, getUserId: () => a.threads_user_id, getProfile: vi.fn(async () => ({ id: a.threads_user_id, username: a.handle.replace(/^@/, '') })) };
  return [a.id, { accountId: a.id, platform: a.platform, handle: a.handle, client } as unknown as ClientEntry];
}));

beforeEach(async () => {
  vi.clearAllMocks();
  mastodonProfiles.clear();
  vi.mocked(initAllClients).mockResolvedValue({ accounts: [], clients: new Map() });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const token = new Headers(init.headers).get('Authorization')?.replace(/^Bearer /, '') ?? '';
    const profile = mastodonProfiles.get(token);
    return new Response(JSON.stringify(profile ?? {}), { status: profile ? 200 : 401 });
  }));
  for (const job of await all<{ id: string }>('jobs')) await remove('jobs', job.id);
});
afterEach(() => vi.unstubAllGlobals());

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

  it('can retry after reconnecting the same remote identity under a new local account id', async () => {
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

describe('media preflight before freezing delivery', () => {
  it('rejects unsupported crosspost attachments before creating any destination job', async () => {
    const files = Array.from({ length: 5 }, (_, index) => new File(['photo'], `photo-${index}.png`, { type: 'image/png' }));
    const saved = snapshot('test', 'Five photos', [1, 2], {}, { mediaFiles: files });
    await expect(createJob(saved, [account(1, 'bluesky'), account(2, 'mastodon')])).rejects.toThrow('4 attachments');
    expect(await all('jobs')).toEqual([]);
    expect(writers.bluesky).not.toHaveBeenCalled(); expect(writers.mastodon).not.toHaveBeenCalled();
  });
  it('accepts a Threads media-only post with public URLs and preserves every URL', async () => {
    const urls = ['https://media.example/one.png', 'https://media.example/two.png'];
    const job = await createJob(snapshot('test', '', [1], {}, { mediaUrls: urls }), [account(1, 'threads')]);
    expect(job.snapshot.options.mediaUrls).toEqual(urls);
    expect(job.destinations).toHaveLength(1);
    expect(job.destinations[0].parts).toHaveLength(1);
  });
  it('rejects a missing Threads URL for any selected attachment before creating a job', async () => {
    const files = [new File(['one'], 'one.png', { type: 'image/png' }), new File(['two'], 'two.png', { type: 'image/png' })];
    await expect(createJob(snapshot('test', 'Two photos', [1], {}, { mediaFiles: files, mediaUrls: ['https://media.example/one.png'] }), [account(1, 'threads')])).rejects.toThrow('every Threads attachment');
    expect(await all('jobs')).toEqual([]);
  });
});

describe('publishing destination identity', () => {
  it('freezes immutable remote IDs, including the Mastodon instance, in each destination', async () => {
    const accounts = [account(1, 'bluesky'), account(2), account(3, 'threads')];
    const job = await createJob(snapshot('test', 'Hello', [1, 2, 3], {}, {}), accounts);
    expect(job.destinations.map(destination => destination.identity)).toEqual([
      { platform: 'bluesky', did: 'did:plc:person1' },
      { platform: 'mastodon', origin: 'https://social.example', userId: '1002' },
      { platform: 'threads', userId: '2003' },
    ]);
    expect(JSON.stringify(job)).not.toContain('test-token');
  });

  it('rejects a reused local ID even when the replacement account has the same display handle', async () => {
    const original = account(1);
    const job = await createJob(snapshot('test', 'Private draft', [1], {}, { visibility: 'private' }), [original]);
    const replacement = { ...original, mastodon_id: '9999' };
    const failed = await deliverJob(job.id, clients(replacement));
    expect(failed.destinations[0].parts[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('identity') });
    expect(failed.snapshot.text).toBe('Private draft');
    expect(writers.mastodon).not.toHaveBeenCalled();
  });

  it('never remaps the same Mastodon username and remote ID onto another instance', async () => {
    const original = account(1);
    const job = await createJob(snapshot('test', 'Hello', [1], {}, {}), [original]);
    const otherServer = { ...original, id: 7, instance_url: 'https://other.example' };
    await deliverJob(job.id, clients(otherServer));
    expect(writers.mastodon).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not trust a client under a mismatched map key or platform', async () => {
    const original = account(1);
    const job = await createJob(snapshot('test', 'Hello', [1], {}, {}), [original]);
    await deliverJob(job.id, clients(account(1, 'threads')));
    const wrongKey = clients(original);
    wrongKey.get(1)!.accountId = 9;
    await deliverJob(job.id, wrongKey);
    expect(writers.mastodon).not.toHaveBeenCalled();
    expect(writers.threads).not.toHaveBeenCalled();
  });

  it('rejects a different Bluesky DID even when an OAuth client keeps the old label', async () => {
    const original = account(1, 'bluesky');
    const job = await createJob(snapshot('test', 'Hello', [1], {}, {}), [original]);
    const entries = clients(original);
    entries.get(1)!.oauthAgent = { did: 'did:plc:another-person' } as ClientEntry['oauthAgent'];
    await deliverJob(job.id, entries);
    expect(writers.bluesky).not.toHaveBeenCalled();
  });

  it('allows a renamed Bluesky account after reconnecting only because its DID is unchanged', async () => {
    const original = account(1, 'bluesky');
    const job = await createJob(snapshot('test', 'Hello', [1], {}, {}), [original]);
    const reconnected = { ...original, id: 7, handle: 'renamed.bsky.social' };
    writers.bluesky.mockResolvedValue({ platform: 'bluesky', success: true, uri: 'at://did:plc:person1/app.bsky.feed.post/one', cid: 'one' });
    expect(isComplete(await deliverJob(job.id, clients(reconnected)))).toBe(true);
    expect(writers.bluesky.mock.calls[0][0].id).toBe(7);
  });

  it('never substitutes a recycled Threads username with another user ID', async () => {
    const original = account(1, 'threads');
    const job = await createJob(snapshot('test', 'Hello', [1], {}, {}), [original]);
    await deliverJob(job.id, clients({ ...original, id: 7, threads_user_id: '9999' }));
    expect(writers.threads).not.toHaveBeenCalled();
  });

  it('verifies the Threads profile instead of trusting only its configured user ID', async () => {
    const original = account(1, 'threads');
    const job = await createJob(snapshot('test', 'Hello', [1], {}, {}), [original]);
    const entries = clients(original);
    vi.mocked((entries.get(1)!.client as any).getProfile).mockResolvedValue({ id: '9999', username: 'person1' });
    await deliverJob(job.id, entries);
    expect(writers.threads).not.toHaveBeenCalled();
  });

  it('upgrades a legacy job from its original account only and persists the identity before publishing', async () => {
    const original = account(1);
    const job = await createJob(snapshot('test', 'Hello', [1], {}, {}), [original]);
    delete job.destinations[0].identity;
    await write('jobs', job);
    writers.mastodon.mockImplementation(async () => {
      expect((await getJob(job.id))?.destinations[0].identity).toEqual({ platform: 'mastodon', origin: 'https://social.example', userId: '1001' });
      return { platform: 'mastodon', success: true, id: '11', uri: 'https://social.example/11' };
    });
    expect(isComplete(await deliverJob(job.id, clients(original)))).toBe(true);
    expect(fetch).toHaveBeenCalledWith('https://social.example/api/v1/accounts/verify_credentials', expect.objectContaining({ redirect: 'error' }));
  });

  it('does not remap a legacy job to a new local ID using only its matching handle', async () => {
    const original = account(1);
    const job = await createJob(snapshot('test', 'Hello', [1], {}, {}), [original]);
    delete job.destinations[0].identity;
    await write('jobs', job);
    const failed = await deliverJob(job.id, clients({ ...original, id: 7 }));
    expect(failed.destinations[0].parts[0].status).toBe('failed');
    expect(writers.mastodon).not.toHaveBeenCalled();
    expect(failed.destinations[0].identity).toBeUndefined();
  });

  it('checks a legacy Mastodon full handle against the authenticated profile and instance', async () => {
    const original = account(1);
    const job = await createJob(snapshot('test', 'Hello', [1], {}, {}), [original]);
    delete job.destinations[0].identity;
    await write('jobs', job);
    await deliverJob(job.id, clients({ ...original, instance_url: 'https://other.example' }));
    expect(writers.mastodon).not.toHaveBeenCalled();
    const entries = clients(original);
    mastodonProfiles.set('test-token-1', { id: '9999', acct: 'someone-else' });
    await deliverJob(job.id, entries);
    expect(writers.mastodon).not.toHaveBeenCalled();
  });

  it('upgrades a legacy Bluesky job only when its authenticated profile still owns the saved handle', async () => {
    const original = account(1, 'bluesky');
    const job = await createJob(snapshot('test', 'Hello', [1], {}, {}), [original]);
    delete job.destinations[0].identity;
    await write('jobs', job);
    const entries = clients(original);
    const agent = (entries.get(1)!.client as any).getAgent();
    agent.getProfile.mockResolvedValueOnce({ data: { did: original.did, handle: 'someone-else.bsky.social' } });
    await deliverJob(job.id, entries);
    expect(writers.bluesky).not.toHaveBeenCalled();
    writers.bluesky.mockResolvedValue({ platform: 'bluesky', success: true, uri: 'at://did:plc:person1/app.bsky.feed.post/one', cid: 'one' });
    expect(isComplete(await deliverJob(job.id, entries))).toBe(true);
    expect((await getJob(job.id))?.destinations[0].identity).toEqual({ platform: 'bluesky', did: original.did });
  });

  it('resolves and freezes missing Threads account IDs from their verified client profiles', async () => {
    const connected = account(1, 'threads');
    const stored = { ...connected, threads_user_id: null };
    vi.mocked(initAllClients).mockResolvedValue({ accounts: [stored], clients: clients(connected) });
    const job = await createJob(snapshot('test', 'Hello', [1], {}, {}), [stored]);
    expect(job.destinations[0].identity).toEqual({ platform: 'threads', userId: connected.threads_user_id });
    expect(initAllClients).toHaveBeenCalledTimes(1);
  });

  it('does not freeze a missing identity when the current profile belongs to another handle', async () => {
    const connected = account(1, 'threads');
    const entries = clients(connected);
    vi.mocked((entries.get(1)!.client as any).getProfile).mockResolvedValue({ id: connected.threads_user_id, username: 'somebody-else' });
    vi.mocked(initAllClients).mockResolvedValue({ accounts: [connected], clients: entries });
    await expect(createJob(snapshot('test', 'Hello', [1], {}, {}), [{ ...connected, threads_user_id: null }])).rejects.toThrow('profile does not match');
    expect(await all('jobs')).toEqual([]);
    expect(writers.threads).not.toHaveBeenCalled();
  });

  it('fails safely on verification errors and retries the same destination after reconnect', async () => {
    const original = account(1);
    const job = await createJob(snapshot('test', 'Hello', [1], {}, {}), [original]);
    const entries = clients(original);
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Request URL with test-token-1 could not connect'));
    const failed = await deliverJob(job.id, entries);
    expect(failed.destinations[0].parts[0].error).not.toContain('test-token');
    expect(writers.mastodon).not.toHaveBeenCalled();
    writers.mastodon.mockResolvedValue({ platform: 'mastodon', success: true, id: '11', uri: 'https://social.example/11' });
    expect(isComplete(await deliverJob(job.id, entries))).toBe(true);
  });
});
