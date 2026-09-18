/**
 * unified.ts hand-rolls isReasonRepost so it can import @atproto/api as types
 * only. This pins the local copy to the real one — if upstream ever changes the
 * predicate, this fails rather than silently mislabelling reposts.
 */
import { describe, it, expect } from 'vitest';
import { AppBskyFeedDefs } from '@atproto/api';
import { isReasonRepost } from './unified';

const CASES: unknown[] = [
  { $type: 'app.bsky.feed.defs#reasonRepost', by: { did: 'did:plc:x' }, indexedAt: '2026-01-01' },
  { $type: 'app.bsky.feed.defs#reasonPin' },
  { $type: 'app.bsky.feed.defs#reasonRepost ' },
  { $type: 'app.bsky.feed.defs#reasonReposts' },
  { $type: 'app.bsky.feed.defs#ReasonRepost' },
  { $type: 'app.bsky.feed.defsXreasonRepost' },
  { $type: 'reasonRepost' },
  { $type: '' },
  { $type: 42 },
  { $type: null },
  { notAType: true },
  {},
  [],
  'app.bsky.feed.defs#reasonRepost',
  null,
  undefined,
  0,
  false,
];

describe('isReasonRepost matches @atproto/api', () => {
  for (const [i, value] of CASES.entries()) {
    it(`case ${i}: ${JSON.stringify(value) ?? String(value)}`, () => {
      expect(isReasonRepost(value)).toBe(AppBskyFeedDefs.isReasonRepost(value));
    });
  }

  it('identifies a genuine repost reason', () => {
    expect(isReasonRepost({
      $type: 'app.bsky.feed.defs#reasonRepost',
      by: { did: 'did:plc:a', handle: 'a.bsky.social' },
      indexedAt: '2026-01-01T00:00:00.000Z',
    })).toBe(true);
  });
});
