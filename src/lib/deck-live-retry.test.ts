import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from './types';
import type { ClientEntry } from './api/client-factory';
import type { DeckColumnConfig } from './deck-layouts';
import type { StreamEvent } from './streaming';
const mocks = vi.hoisted(() => ({ enableColumn: vi.fn(), swallow: vi.fn() }));
vi.mock('./streaming', () => ({ streamManager: { enableColumn: mocks.enableColumn } }));
vi.mock('./debug-log', () => ({ swallow: mocks.swallow }));
import { subscribeDeckColumn } from './deck-live';

let nextId = 1000;
const cleanups: (() => void)[] = [];
function fixture() {
  const id = ++nextId;
  const account = { id, platform: 'bluesky', did: `did:plc:account${id}`, handle: `account${id}.bsky.social` } as Account;
  const getFollows = vi.fn().mockResolvedValue({ follows: [{ did: 'did:plc:friend' }] });
  const getProfile = vi.fn().mockResolvedValue({ did: 'did:plc:author' });
  const entry = { accountId: id, platform: 'bluesky', handle: account.handle, client: { getFollows, getProfile } } as unknown as ClientEntry;
  return { account, entry, getFollows, getProfile };
}
function subscribe(fixtures: ReturnType<typeof fixture>[], type: DeckColumnConfig['type'] = 'timeline') {
  const onEvent = vi.fn(); const onReady = vi.fn();
  const column = { id: 'retry-column', type, title: 'Live column', width: 350, streaming: true, query: type === 'user' ? '@author.bsky.social' : undefined } as DeckColumnConfig;
  const stop = subscribeDeckColumn(column, fixtures.map(value => value.account), new Map(fixtures.map(value => [value.account.id, value.entry])), onEvent, onReady);
  cleanups.push(stop);
  return { stop, onEvent, onReady };
}

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  mocks.enableColumn.mockImplementation(() => vi.fn());
});
afterEach(() => {
  cleanups.splice(0).forEach(stop => stop());
  vi.clearAllTimers(); vi.useRealTimers();
});

describe('bounded live setup retries', () => {
  it('reloads the follow graph when a local account ID is reused by another actor', async () => {
    const original = fixture();
    const first = subscribe([original]);
    await vi.advanceTimersByTimeAsync(0);
    first.stop();
    const replacement = fixture();
    replacement.account.id = original.account.id;
    replacement.entry.accountId = original.account.id;
    replacement.getFollows.mockResolvedValue({ follows: [{ did: 'did:plc:newfriend' }] });
    const { onEvent } = subscribe([replacement]);
    await vi.advanceTimersByTimeAsync(0);
    expect(replacement.getFollows).toHaveBeenCalledOnce();
    const listener = mocks.enableColumn.mock.calls.at(-1)![1] as (event: StreamEvent) => void;
    listener({ type: 'new-post', platform: 'bluesky', payload: { did: 'did:plc:friend' } });
    expect(onEvent).not.toHaveBeenCalled();
    listener({ type: 'new-post', platform: 'bluesky', payload: { did: 'did:plc:newfriend' } });
    expect(onEvent).toHaveBeenCalledOnce();
  });

  it('does not evict a replacement identity when an old follows lookup rejects late', async () => {
    const original = fixture();
    let reject!: (error: Error) => void;
    original.getFollows.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const first = subscribe([original]);
    first.stop();
    const replacement = fixture();
    replacement.account.id = original.account.id;
    replacement.entry.accountId = original.account.id;
    subscribe([replacement]);
    await vi.advanceTimersByTimeAsync(0);
    reject(new Error('Retired account lookup failed'));
    await vi.advanceTimersByTimeAsync(0);
    subscribe([replacement]);
    await vi.advanceTimersByTimeAsync(0);
    expect(replacement.getFollows).toHaveBeenCalledOnce();
    expect(mocks.enableColumn).toHaveBeenCalledTimes(2);
  });

  it('recovers a failed follows lookup automatically and uses the recovered follow set', async () => {
    const account = fixture();
    account.getFollows.mockRejectedValueOnce(new Error('Temporary outage'));
    const { onEvent, onReady } = subscribe([account]);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.enableColumn).not.toHaveBeenCalled(); expect(onReady).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4999);
    expect(account.getFollows).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(account.getFollows).toHaveBeenCalledTimes(2);
    expect(mocks.enableColumn).toHaveBeenCalledTimes(1); expect(onReady).toHaveBeenCalledWith(true);
    const listener = mocks.enableColumn.mock.calls[0][1] as (event: StreamEvent) => void;
    listener({ type: 'new-post', platform: 'bluesky', payload: { did: 'did:plc:friend' } });
    listener({ type: 'new-post', platform: 'bluesky', payload: { did: 'did:plc:stranger' } });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][1]).toBe(account.account.id);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(account.getFollows).toHaveBeenCalledTimes(2); expect(mocks.enableColumn).toHaveBeenCalledTimes(1);
  });

  it('retries user-profile setup through the same selected OAuth account', async () => {
    const account = fixture();
    const getProfile = vi.fn().mockRejectedValueOnce(new Error('Temporary profile failure')).mockResolvedValue({ data: { did: 'did:plc:author' } });
    account.entry.oauthAgent = { api: { app: { bsky: { actor: { getProfile } } } } } as unknown as ClientEntry['oauthAgent'];
    subscribe([account], 'user');
    await vi.advanceTimersByTimeAsync(5000);
    expect(getProfile).toHaveBeenCalledTimes(2);
    expect(getProfile).toHaveBeenLastCalledWith({ actor: 'author.bsky.social' });
    expect(account.getProfile).not.toHaveBeenCalled();
    expect(mocks.enableColumn).toHaveBeenCalledWith(expect.objectContaining({ columnId: `retry-column:${account.account.id}` }), expect.any(Function));
  });

  it('caps retry delay and recovers even after an outage lasting several minutes', async () => {
    const account = fixture(); account.getFollows.mockRejectedValue(new Error('Offline'));
    const { onReady } = subscribe([account]);
    await vi.advanceTimersByTimeAsync(0);
    for (const [index, delay] of [5000, 10000, 20000, 40000, 60000, 60000].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(account.getFollows).toHaveBeenCalledTimes(index + 1);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(account.getFollows).toHaveBeenCalledTimes(index + 2);
    }
    expect(mocks.enableColumn).not.toHaveBeenCalled();
    account.getFollows.mockResolvedValue({ follows: [{ did: 'did:plc:friend' }] });
    await vi.advanceTimersByTimeAsync(60000);
    expect(account.getFollows).toHaveBeenCalledTimes(8);
    expect(mocks.enableColumn).toHaveBeenCalledTimes(1); expect(onReady).toHaveBeenCalledWith(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries only the failing account while another account remains subscribed', async () => {
    const first = fixture(); const second = fixture();
    second.getFollows.mockRejectedValueOnce(new Error('Second account temporarily unavailable'));
    subscribe([first, second]);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.enableColumn).toHaveBeenCalledTimes(1);
    const firstCleanup = mocks.enableColumn.mock.results[0].value;
    await vi.advanceTimersByTimeAsync(5000);
    expect(first.getFollows).toHaveBeenCalledTimes(1); expect(second.getFollows).toHaveBeenCalledTimes(2);
    expect(mocks.enableColumn).toHaveBeenCalledTimes(2); expect(firstCleanup).not.toHaveBeenCalled();
  });

  it('cancels a scheduled retry when the column is disposed', async () => {
    const account = fixture(); account.getFollows.mockRejectedValueOnce(new Error('Offline'));
    const { stop, onReady } = subscribe([account]);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    stop(); stop();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(account.getFollows).toHaveBeenCalledTimes(1); expect(mocks.enableColumn).not.toHaveBeenCalled();
    expect(onReady.mock.calls).toEqual([[false]]); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['resolve', 'reject'] as const)('does not subscribe or schedule again when an in-flight retry later %ss after disposal', async outcome => {
    const account = fixture();
    let resolve!: (value: unknown) => void; let reject!: (reason: unknown) => void;
    account.getFollows.mockRejectedValueOnce(new Error('Temporary outage')).mockReturnValueOnce(new Promise((ok, fail) => { resolve = ok; reject = fail; }));
    const { stop, onReady } = subscribe([account]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(account.getFollows).toHaveBeenCalledTimes(2);
    stop();
    if (outcome === 'resolve') resolve({ follows: [{ did: 'did:plc:friend' }] });
    else reject(new Error('Late failure'));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(mocks.enableColumn).not.toHaveBeenCalled(); expect(account.getFollows).toHaveBeenCalledTimes(2);
    expect(onReady.mock.calls).toEqual([[false]]); expect(vi.getTimerCount()).toBe(0);
  });
});
