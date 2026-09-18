/**
 * Dispatch behaviour of the Jetstream client.
 *
 * The point of watch() is that an event wakes only the post it concerns. A feed
 * mounts hundreds of Post components, and the previous untargeted subscribe()
 * ran every one of their listeners on every matching event.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { jetstream } from './jetstream';

const uriA = 'at://did:plc:a/app.bsky.feed.post/1';
const uriB = 'at://did:plc:b/app.bsky.feed.post/2';

function like(subject: string, op = 'create') {
  return JSON.stringify({
    commit: { operation: op, collection: 'app.bsky.feed.like',
      record: { subject: { uri: subject } } },
  });
}

beforeEach(() => {
  jetstream.clearWatched();
});

describe('jetstream.watch', () => {
  it('delivers an update only to the listener for that post', () => {
    const a = vi.fn(), b = vi.fn();
    const offA = jetstream.watch(uriA, a);
    const offB = jetstream.watch(uriB, b);

    jetstream.handleRawMessage(like(uriA));

    expect(a).toHaveBeenCalledWith({ uri: uriA, type: 'like', delta: 1 });
    expect(b).not.toHaveBeenCalled();
    offA(); offB();
  });

  it('does not run any listener for an unwatched post', () => {
    const a = vi.fn();
    const off = jetstream.watch(uriA, a);
    jetstream.handleRawMessage(like('at://did:plc:z/app.bsky.feed.post/999'));
    expect(a).not.toHaveBeenCalled();
    off();
  });

  it('scales fan-out with posts on screen, not with listeners registered', () => {
    // 300 posts mounted, one event: exactly one listener should run.
    const calls: number[] = [];
    const offs = Array.from({ length: 300 }, (_, i) =>
      jetstream.watch(`at://did:plc:x/app.bsky.feed.post/${i}`, () => calls.push(i))
    );

    jetstream.handleRawMessage(like('at://did:plc:x/app.bsky.feed.post/42'));

    expect(calls).toEqual([42]);
    offs.forEach((off) => off());
  });

  it('teardown removes the listener and stops watching the post', () => {
    const a = vi.fn();
    const off = jetstream.watch(uriA, a);
    off();
    jetstream.handleRawMessage(like(uriA));
    expect(a).not.toHaveBeenCalled();
    expect(jetstream.listenerCountFor(uriA)).toBe(0);
  });

  it('keeps watching while another listener on the same post remains', () => {
    const a = vi.fn(), b = vi.fn();
    const offA = jetstream.watch(uriA, a);
    const offB = jetstream.watch(uriA, b);
    offA();

    jetstream.handleRawMessage(like(uriA));
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    offB();
  });

  it('is idempotent when a teardown runs twice', () => {
    const a = vi.fn();
    const off = jetstream.watch(uriA, a);
    off();
    expect(() => off()).not.toThrow();
  });

  it('applies like and repost deltas separately', () => {
    const seen: any[] = [];
    const off = jetstream.watch(uriA, (u) => seen.push(u));
    jetstream.handleRawMessage(like(uriA));
    jetstream.handleRawMessage(JSON.stringify({
      commit: { operation: 'create', collection: 'app.bsky.feed.repost',
        record: { subject: { uri: uriA } } },
    }));
    expect(seen).toEqual([
      { uri: uriA, type: 'like', delta: 1 },
      { uri: uriA, type: 'repost', delta: 1 },
    ]);
    off();
  });
});

describe('jetstream.subscribe (untargeted, retained for compatibility)', () => {
  it('still receives every matching update', () => {
    const all = vi.fn();
    const unsub = jetstream.subscribe(all);
    jetstream.watchPost(uriA);
    jetstream.handleRawMessage(like(uriA));
    expect(all).toHaveBeenCalledWith({ uri: uriA, type: 'like', delta: 1 });
    unsub();
    jetstream.handleRawMessage(like(uriA));
    expect(all).toHaveBeenCalledTimes(1);
  });
});

describe('jetstream watch bookkeeping', () => {
  it('clearWatched stops delivery', () => {
    const a = vi.fn();
    jetstream.watch(uriA, a);
    jetstream.clearWatched();
    jetstream.handleRawMessage(like(uriA));
    expect(a).not.toHaveBeenCalled();
  });

  it('reports not connected before any connection is made', () => {
    expect(jetstream.isConnected()).toBe(false);
  });
});
