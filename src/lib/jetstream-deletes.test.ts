/**
 * Unlikes and un-reposts must decrement.
 *
 * A Jetstream delete commit carries no record, so it identifies only the like
 * record being removed — verified against the live firehose: 80 of 80 deletes
 * observed in 20 seconds had no `record` field. Attribution therefore goes
 * through SubjectIndex, which remembers the subject of each create.
 */
import { describe, it, expect } from 'vitest';
import { matchRawEvent, decodeEvent, SubjectIndex } from './jetstream-filter';

const POST = 'at://did:plc:author/app.bsky.feed.post/3kzzz';
const OTHER = 'at://did:plc:author/app.bsky.feed.post/3kaaa';
const LIKER = 'did:plc:liker';
const watched = new Set([POST]);
const isWatched = (u: string) => watched.has(u);

/** Real Jetstream shapes, taken from the live stream. */
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

describe('unlike decrements the count', () => {
  it('a like then an unlike nets to zero', () => {
    const idx = new SubjectIndex();
    expect(matchRawEvent(createLike(LIKER, 'r1', POST), isWatched, idx))
      .toEqual({ uri: POST, type: 'like', delta: 1 });
    expect(matchRawEvent(deleteLike(LIKER, 'r1'), isWatched, idx))
      .toEqual({ uri: POST, type: 'like', delta: -1 });
  });

  it('works the same for reposts', () => {
    const idx = new SubjectIndex();
    expect(matchRawEvent(createRepost(LIKER, 'r2', POST), isWatched, idx))
      .toEqual({ uri: POST, type: 'repost', delta: 1 });
    expect(matchRawEvent(deleteRepost(LIKER, 'r2'), isWatched, idx))
      .toEqual({ uri: POST, type: 'repost', delta: -1 });
  });

  it('a delete we never saw the create for is ignored', () => {
    const idx = new SubjectIndex();
    expect(matchRawEvent(deleteLike(LIKER, 'unknown'), isWatched, idx)).toBeNull();
  });

  it('a delete of a like on an unwatched post is ignored', () => {
    const idx = new SubjectIndex();
    expect(matchRawEvent(createLike(LIKER, 'r3', OTHER), isWatched, idx)).toBeNull();
    expect(matchRawEvent(deleteLike(LIKER, 'r3'), isWatched, idx)).toBeNull();
  });

  it('a like and a repost with the same rkey do not collide', () => {
    const idx = new SubjectIndex();
    matchRawEvent(createLike(LIKER, 'same', POST), isWatched, idx);
    matchRawEvent(createRepost(LIKER, 'same', POST), isWatched, idx);
    expect(matchRawEvent(deleteLike(LIKER, 'same'), isWatched, idx))
      .toEqual({ uri: POST, type: 'like', delta: -1 });
    expect(matchRawEvent(deleteRepost(LIKER, 'same'), isWatched, idx))
      .toEqual({ uri: POST, type: 'repost', delta: -1 });
  });

  it('two users liking the same post are tracked separately', () => {
    const idx = new SubjectIndex();
    matchRawEvent(createLike('did:plc:u1', 'r', POST), isWatched, idx);
    matchRawEvent(createLike('did:plc:u2', 'r', POST), isWatched, idx);
    expect(matchRawEvent(deleteLike('did:plc:u1', 'r'), isWatched, idx))
      .toEqual({ uri: POST, type: 'like', delta: -1 });
    expect(matchRawEvent(deleteLike('did:plc:u2', 'r'), isWatched, idx))
      .toEqual({ uri: POST, type: 'like', delta: -1 });
  });

  it('a record can only be deleted once', () => {
    const idx = new SubjectIndex();
    matchRawEvent(createLike(LIKER, 'r4', POST), isWatched, idx);
    expect(matchRawEvent(deleteLike(LIKER, 'r4'), isWatched, idx)).not.toBeNull();
    expect(matchRawEvent(deleteLike(LIKER, 'r4'), isWatched, idx)).toBeNull();
  });

  it('nets to the right count over an interleaved stream', () => {
    const idx = new SubjectIndex();
    let count = 0;
    const stream = [
      createLike('did:plc:a', 'x', POST),      // +1
      createLike('did:plc:b', 'y', OTHER),     //  0 (unwatched)
      createLike('did:plc:c', 'z', POST),      // +1
      deleteLike('did:plc:a', 'x'),            // -1
      deleteLike('did:plc:b', 'y'),            //  0 (unwatched)
      createRepost('did:plc:d', 'w', POST),    // +1 (repost, separate counter)
      deleteLike('did:plc:unknown', 'q'),      //  0
    ];
    let reposts = 0;
    for (const raw of stream) {
      const u = matchRawEvent(raw, isWatched, idx);
      if (!u) continue;
      if (u.type === 'like') count += u.delta;
      else reposts += u.delta;
    }
    expect(count).toBe(1);
    expect(reposts).toBe(1);
  });

  it('without an index, deletes are ignored (previous behaviour)', () => {
    expect(matchRawEvent(deleteLike(LIKER, 'r5'), isWatched)).toBeNull();
    expect(decodeEvent(JSON.parse(deleteLike(LIKER, 'r5')), isWatched)).toBeNull();
  });
});

describe('SubjectIndex bounds', () => {
  it('only remembers likes on posts that are on screen', () => {
    const idx = new SubjectIndex();
    for (let i = 0; i < 1000; i++) {
      matchRawEvent(createLike(`did:plc:u${i}`, 'r', OTHER), isWatched, idx);
    }
    expect(idx.size).toBe(0);
  });

  it('evicts the least recently seen entry past the cap', () => {
    const idx = new SubjectIndex(3);
    for (const r of ['a', 'b', 'c', 'd']) {
      matchRawEvent(createLike(LIKER, r, POST), isWatched, idx);
    }
    expect(idx.size).toBe(3);
    expect(matchRawEvent(deleteLike(LIKER, 'a'), isWatched, idx)).toBeNull();   // evicted
    expect(matchRawEvent(deleteLike(LIKER, 'd'), isWatched, idx)).not.toBeNull();
  });

  it('re-seeing a record refreshes its position', () => {
    const idx = new SubjectIndex(2);
    matchRawEvent(createLike(LIKER, 'a', POST), isWatched, idx);
    matchRawEvent(createLike(LIKER, 'b', POST), isWatched, idx);
    matchRawEvent(createLike(LIKER, 'a', POST), isWatched, idx); // refresh a
    matchRawEvent(createLike(LIKER, 'c', POST), isWatched, idx); // should evict b
    expect(matchRawEvent(deleteLike(LIKER, 'b'), isWatched, idx)).toBeNull();
    expect(matchRawEvent(deleteLike(LIKER, 'a'), isWatched, idx)).not.toBeNull();
  });

  it('clear() empties it', () => {
    const idx = new SubjectIndex();
    matchRawEvent(createLike(LIKER, 'r', POST), isWatched, idx);
    expect(idx.size).toBe(1);
    idx.clear();
    expect(idx.size).toBe(0);
  });
});
