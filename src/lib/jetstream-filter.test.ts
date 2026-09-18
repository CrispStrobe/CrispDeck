import { describe, it, expect } from 'vitest';
import { mightMatch, decodeEvent, matchRawEvent } from './jetstream-filter';

const WATCHED = 'at://did:plc:abc123/app.bsky.feed.post/3kzzz';
const OTHER = 'at://did:plc:xyz789/app.bsky.feed.post/3kaaa';
const isWatched = (uri: string) => uri === WATCHED;

function likeEvent(subject: string, operation = 'create') {
  return JSON.stringify({
    did: 'did:plc:liker', time_us: 1700000000000000, kind: 'commit',
    commit: {
      rev: '3l', operation, collection: 'app.bsky.feed.like', rkey: 'abc',
      record: { $type: 'app.bsky.feed.like', createdAt: '2026-01-10T12:00:00.000Z',
                subject: { cid: 'bafy', uri: subject } },
      cid: 'bafy2',
    },
  });
}

function repostEvent(subject: string) {
  return JSON.stringify({
    did: 'did:plc:reposter', kind: 'commit',
    commit: { operation: 'create', collection: 'app.bsky.feed.repost', rkey: 'r',
      record: { $type: 'app.bsky.feed.repost', subject: { cid: 'c', uri: subject } } },
  });
}

describe('mightMatch — the pre-JSON.parse gate', () => {
  it('accepts a message carrying a watched uri', () => {
    expect(mightMatch(likeEvent(WATCHED), isWatched)).toBe(true);
  });

  it('rejects a message about an unwatched post', () => {
    expect(mightMatch(likeEvent(OTHER), isWatched)).toBe(false);
  });

  it('rejects messages with no at:// uri at all', () => {
    expect(mightMatch('{"kind":"identity","did":"did:plc:x"}', isWatched)).toBe(false);
  });

  it('rejects everything when nothing is watched', () => {
    expect(mightMatch(likeEvent(WATCHED), () => false)).toBe(false);
  });

  /**
   * The gate must never reject something the authoritative decoder would have
   * accepted, or counts would silently stop updating.
   */
  it('never rejects a message that decodeEvent would accept', () => {
    const subjects = [WATCHED, OTHER, 'at://did:plc:q/app.bsky.feed.post/xyz'];
    for (const subject of subjects) {
      for (const raw of [likeEvent(subject), repostEvent(subject)]) {
        const decoded = decodeEvent(JSON.parse(raw), isWatched);
        if (decoded) expect(mightMatch(raw, isWatched), raw).toBe(true);
      }
    }
  });

  it('is not confused by a watched uri appearing in another field', () => {
    // Passing the gate is fine; the decoder is what decides.
    const raw = JSON.stringify({
      commit: { operation: 'create', collection: 'app.bsky.feed.like',
        record: { subject: { uri: OTHER }, via: WATCHED } },
    });
    expect(mightMatch(raw, isWatched)).toBe(true);
    expect(matchRawEvent(raw, isWatched)).toBeNull();
  });

  it('has no leftover regex state between calls', () => {
    for (let i = 0; i < 5; i++) {
      expect(mightMatch(likeEvent(WATCHED), isWatched)).toBe(true);
      expect(mightMatch(likeEvent(OTHER), isWatched)).toBe(false);
    }
  });
});

describe('decodeEvent', () => {
  it('decodes a like on a watched post', () => {
    expect(decodeEvent(JSON.parse(likeEvent(WATCHED)), isWatched))
      .toEqual({ uri: WATCHED, type: 'like', delta: 1 });
  });

  it('decodes a repost on a watched post', () => {
    expect(decodeEvent(JSON.parse(repostEvent(WATCHED)), isWatched))
      .toEqual({ uri: WATCHED, type: 'repost', delta: 1 });
  });

  it('ignores posts that are not watched', () => {
    expect(decodeEvent(JSON.parse(likeEvent(OTHER)), isWatched)).toBeNull();
  });

  it('ignores non-commit messages', () => {
    expect(decodeEvent({ kind: 'identity' }, isWatched)).toBeNull();
    expect(decodeEvent(null, isWatched)).toBeNull();
    expect(decodeEvent({ commit: {} }, isWatched)).toBeNull();
  });

  it('ignores collections we do not track', () => {
    const raw = { commit: { operation: 'create', collection: 'app.bsky.feed.post',
      record: { subject: { uri: WATCHED } } } };
    expect(decodeEvent(raw, isWatched)).toBeNull();
  });

  it('ignores operations that are neither create nor delete', () => {
    expect(decodeEvent(JSON.parse(likeEvent(WATCHED, 'update')), isWatched)).toBeNull();
  });
});

describe('matchRawEvent', () => {
  it('returns an update for a watched like', () => {
    expect(matchRawEvent(likeEvent(WATCHED), isWatched))
      .toEqual({ uri: WATCHED, type: 'like', delta: 1 });
  });

  it('returns null for unwatched traffic', () => {
    expect(matchRawEvent(likeEvent(OTHER), isWatched)).toBeNull();
  });

  it('survives malformed JSON that passes the gate', () => {
    expect(matchRawEvent(`{"uri":"${WATCHED}" oops`, isWatched)).toBeNull();
  });

  it('matches the unfiltered path exactly across a mixed stream', () => {
    const stream = [
      likeEvent(WATCHED), likeEvent(OTHER), repostEvent(WATCHED),
      repostEvent(OTHER), '{"kind":"account"}', likeEvent(WATCHED, 'delete'),
      'not json at all',
    ];
    const viaFilter = stream.map((r) => matchRawEvent(r, isWatched));
    const viaFullParse = stream.map((r) => {
      try { return decodeEvent(JSON.parse(r), isWatched); } catch { return null; }
    });
    expect(viaFilter).toEqual(viaFullParse);
  });
});
