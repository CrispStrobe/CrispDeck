import { describe, it, expect } from 'vitest';
import { AppBskyFeedDefs } from '@atproto/api';
import { normalizePost } from './unified';

/**
 * unified.ts stopped importing @atproto/api as a value so the SDK would leave
 * the static closure of every route that renders a post. The one thing it took
 * from the SDK was isReasonRepost, now a local $type comparison.
 *
 * These tests cross-check the local behaviour against the SDK's, which is safe
 * to import here because tests are not shipped. If the lexicon's discriminant
 * ever changes, this fails rather than silently mislabelling every repost in
 * the feed as an original post.
 */

function feedItem(reason: unknown) {
  return {
    post: {
      uri: 'at://did:plc:x/app.bsky.feed.post/1',
      cid: 'bafy',
      author: { did: 'did:plc:x', handle: 'a.example' },
      record: { text: 'hello', createdAt: '2026-01-01T00:00:00.000Z' },
      indexedAt: '2026-01-01T00:00:00.000Z'
    },
    reason
  };
}

const REPOST = {
  $type: 'app.bsky.feed.defs#reasonRepost',
  by: { did: 'did:plc:y', handle: 'b.example', displayName: 'B' },
  indexedAt: '2026-02-02T00:00:00.000Z'
};

const NOT_REPOSTS = [
  undefined,
  null,
  {},
  { $type: 'app.bsky.feed.defs#reasonPin' },
  { $type: 'app.bsky.feed.defs#reasonRepostX' },
  { by: { handle: 'b.example' }, indexedAt: '2026-02-02T00:00:00.000Z' }, // no $type
  'app.bsky.feed.defs#reasonRepost' // the string itself, not an object
];

describe('repost detection without the SDK', () => {
  it('agrees with the SDK on a repost', () => {
    expect(AppBskyFeedDefs.isReasonRepost(REPOST)).toBe(true);
    expect(normalizePost(feedItem(REPOST) as never, 'bluesky').isRepost).toBe(true);
  });

  it('agrees with the SDK on everything that is not one', () => {
    for (const r of NOT_REPOSTS) {
      const sdk = AppBskyFeedDefs.isReasonRepost(r);
      const ours = normalizePost(feedItem(r) as never, 'bluesky').isRepost;
      expect(ours, `disagreed on ${JSON.stringify(r)}`).toBe(sdk);
    }
  });

  it('takes the repost time, not the original post time', () => {
    // The reason this guard exists at all: a repost sorts by when it appeared
    // in the feed. Getting it wrong buries reposts at their original date.
    const out = normalizePost(feedItem(REPOST) as never, 'bluesky');
    expect(out.createdAt).toBe('2026-02-02T00:00:00.000Z');
    expect(out.repostAuthor?.handle).toBe('b.example');
  });

  it('falls back to the post time when the reason is not a repost', () => {
    const out = normalizePost(feedItem({ $type: 'app.bsky.feed.defs#reasonPin' }) as never, 'bluesky');
    expect(out.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(out.repostAuthor).toBeUndefined();
  });
});
