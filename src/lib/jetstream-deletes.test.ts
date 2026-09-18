/**
 * Unlikes and un-reposts must decrement the live counters.
 *
 * A Jetstream delete commit carries no `record`, so it names only the like
 * record being removed — verified against the live firehose: 80 of 80 deletes
 * observed in 20 seconds had no record field. handleEvent required
 * record.subject.uri before it computed a delta, which made the `-1` branch
 * unreachable: a counter went up when someone liked a post and never came back
 * down when they unliked it.
 *
 * Events are driven through a stubbed WebSocket so the real connect/receive
 * path is exercised rather than a private method.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const POST = 'at://did:plc:author/app.bsky.feed.post/3kzzz';
const OTHER = 'at://did:plc:author/app.bsky.feed.post/3kaaa';
const LIKER = 'did:plc:liker';

/** Captures instances so a test can push messages in. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 1;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  constructor(public url: string) { FakeSocket.instances.push(this); }
  close() { this.readyState = 3; }
  send() {}
}

/** Real Jetstream payload shapes. */
const createLike = (did: string, rkey: string, subject: string) => JSON.stringify({
  did, time_us: 1789000000000000, kind: 'commit',
  commit: {
    rev: '3mvsgna334227', operation: 'create', collection: 'app.bsky.feed.like', rkey,
    record: { $type: 'app.bsky.feed.like', createdAt: '2026-01-10T12:00:00.000Z',
              subject: { cid: 'bafyrei', uri: subject } },
    cid: 'bafyrei2',
  },
});

const deleteLike = (did: string, rkey: string) => JSON.stringify({
  did, time_us: 1789000000000001, kind: 'commit',
  commit: { rev: '3mvsgna334228', operation: 'delete', collection: 'app.bsky.feed.like', rkey },
});

const createRepost = (did: string, rkey: string, subject: string) => JSON.stringify({
  did, kind: 'commit',
  commit: { operation: 'create', collection: 'app.bsky.feed.repost', rkey,
            record: { $type: 'app.bsky.feed.repost', subject: { cid: 'c', uri: subject } } },
});
const deleteRepost = (did: string, rkey: string) => JSON.stringify({
  did, kind: 'commit',
  commit: { operation: 'delete', collection: 'app.bsky.feed.repost', rkey },
});

async function connected() {
  vi.resetModules();
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket as any);
  const { jetstream } = await import('./jetstream');
  jetstream.setEnabled(true);
  const socket = FakeSocket.instances[0];
  if (!socket) throw new Error('no socket opened');
  return { jetstream, feed: (raw: string) => socket.onmessage?.({ data: raw }) };
}

afterEach(() => vi.unstubAllGlobals());

describe('unlike decrements the count', () => {
  it('a like then an unlike nets to zero', async () => {
    const { jetstream, feed } = await connected();
    const seen: any[] = [];
    jetstream.watchPost(POST, (u) => seen.push(u));

    feed(createLike(LIKER, 'r1', POST));
    feed(deleteLike(LIKER, 'r1'));

    expect(seen).toEqual([
      { uri: POST, type: 'like', delta: 1 },
      { uri: POST, type: 'like', delta: -1 },
    ]);
    jetstream.setEnabled(false);
  });

  it('works the same for reposts', async () => {
    const { jetstream, feed } = await connected();
    const seen: any[] = [];
    jetstream.watchPost(POST, (u) => seen.push(u));

    feed(createRepost(LIKER, 'r2', POST));
    feed(deleteRepost(LIKER, 'r2'));

    expect(seen.map((u) => u.delta)).toEqual([1, -1]);
    expect(seen.every((u) => u.type === 'repost')).toBe(true);
    jetstream.setEnabled(false);
  });

  it('ignores a delete whose create was never seen', async () => {
    const { jetstream, feed } = await connected();
    const seen: any[] = [];
    jetstream.watchPost(POST, (u) => seen.push(u));

    feed(deleteLike(LIKER, 'never-seen'));

    expect(seen).toEqual([]);
    jetstream.setEnabled(false);
  });

  it('ignores an unlike of a post that is not on screen', async () => {
    const { jetstream, feed } = await connected();
    const seen: any[] = [];
    jetstream.watchPost(POST, (u) => seen.push(u));

    feed(createLike(LIKER, 'r3', OTHER));
    feed(deleteLike(LIKER, 'r3'));

    expect(seen).toEqual([]);
    jetstream.setEnabled(false);
  });

  it('keeps likes and reposts with the same rkey apart', async () => {
    const { jetstream, feed } = await connected();
    const seen: any[] = [];
    jetstream.watchPost(POST, (u) => seen.push(u));

    feed(createLike(LIKER, 'same', POST));
    feed(createRepost(LIKER, 'same', POST));
    feed(deleteLike(LIKER, 'same'));
    feed(deleteRepost(LIKER, 'same'));

    expect(seen).toEqual([
      { uri: POST, type: 'like', delta: 1 },
      { uri: POST, type: 'repost', delta: 1 },
      { uri: POST, type: 'like', delta: -1 },
      { uri: POST, type: 'repost', delta: -1 },
    ]);
    jetstream.setEnabled(false);
  });

  it('tracks two people liking the same post separately', async () => {
    const { jetstream, feed } = await connected();
    let count = 0;
    jetstream.watchPost(POST, (u) => { count += u.delta; });

    feed(createLike('did:plc:u1', 'r', POST));
    feed(createLike('did:plc:u2', 'r', POST));
    feed(deleteLike('did:plc:u1', 'r'));

    expect(count).toBe(1);
    jetstream.setEnabled(false);
  });

  it('applies a delete only once', async () => {
    const { jetstream, feed } = await connected();
    let count = 0;
    jetstream.watchPost(POST, (u) => { count += u.delta; });

    feed(createLike(LIKER, 'r4', POST));
    feed(deleteLike(LIKER, 'r4'));
    feed(deleteLike(LIKER, 'r4'));

    expect(count).toBe(0);
    jetstream.setEnabled(false);
  });

  it('nets correctly across an interleaved stream', async () => {
    const { jetstream, feed } = await connected();
    let likes = 0, reposts = 0;
    jetstream.watchPost(POST, (u) => {
      if (u.type === 'like') likes += u.delta; else reposts += u.delta;
    });

    feed(createLike('did:plc:a', 'x', POST));     // +1 like
    feed(createLike('did:plc:b', 'y', OTHER));    //  ignored
    feed(createLike('did:plc:c', 'z', POST));     // +1 like
    feed(deleteLike('did:plc:a', 'x'));           // -1 like
    feed(deleteLike('did:plc:b', 'y'));           //  ignored
    feed(createRepost('did:plc:d', 'w', POST));   // +1 repost
    feed(deleteLike('did:plc:zz', 'q'));          //  ignored

    expect(likes).toBe(1);
    expect(reposts).toBe(1);
    jetstream.setEnabled(false);
  });

  it('stops attributing deletes after clearWatched', async () => {
    const { jetstream, feed } = await connected();
    const seen: any[] = [];
    jetstream.watchPost(POST, (u) => seen.push(u));

    feed(createLike(LIKER, 'r5', POST));
    jetstream.clearWatched();
    feed(deleteLike(LIKER, 'r5'));

    expect(seen).toEqual([{ uri: POST, type: 'like', delta: 1 }]);
    jetstream.setEnabled(false);
  });

  it('does not remember likes on posts nobody is watching', async () => {
    const { jetstream, feed } = await connected();
    jetstream.watchPost(POST, () => {});

    // 500 likes on other posts must not accumulate in the index.
    for (let i = 0; i < 500; i++) feed(createLike(`did:plc:u${i}`, 'r', OTHER));
    const seen: any[] = [];
    jetstream.watchPost(OTHER, (u) => seen.push(u));
    feed(deleteLike('did:plc:u0', 'r'));

    expect(seen).toEqual([]);
    jetstream.setEnabled(false);
  });

  it('a malformed message does not break the stream', async () => {
    const { jetstream, feed } = await connected();
    const seen: any[] = [];
    jetstream.watchPost(POST, (u) => seen.push(u));

    feed('not json at all');
    feed(JSON.stringify({ kind: 'identity' }));
    feed(createLike(LIKER, 'r6', POST));

    expect(seen).toEqual([{ uri: POST, type: 'like', delta: 1 }]);
    jetstream.setEnabled(false);
  });
});
