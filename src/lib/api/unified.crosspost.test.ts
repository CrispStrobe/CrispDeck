/**
 * Behaviour of detectCrossposts.
 *
 * This file used to run the original Jaro-Winkler implementation as an oracle,
 * pinning the optimized version to it bit-for-bit. That contract ended when the
 * similarity metric was deliberately replaced (see ./similarity and
 * scripts/experiments/crosspost-similarity.test.ts): character-level matching
 * grouped unrelated posts, badly so for identity-linked authors. What is
 * asserted now is the behaviour the feature is supposed to have, plus the
 * structural invariants the fast paths must not break.
 */
import { describe, it, expect } from 'vitest';
import { detectCrossposts, buildIdentityPairs, isCrosspostGroup } from './unified';
import type { UnifiedPost, FeedItem } from '$lib/types';

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 0, 10, h, m)).toISOString();

const ALICE_BSKY = '@alice.bsky.social';
const ALICE_MASTO = '@alice@mastodon.social';
const IDENTITY_PAIRS = buildIdentityPairs([
  { confirmed: true, links: [{ handle: ALICE_BSKY }, { handle: ALICE_MASTO }] },
]);

function post(o: Partial<UnifiedPost> & { uri: string }): UnifiedPost {
  return {
    text: 'default text',
    createdAt: at(12),
    platform: 'bluesky',
    author: { handle: ALICE_BSKY, displayName: 'Alice' },
    ...o,
  } as UnifiedPost;
}

/** A pair of the same content on both platforms. */
function crosspostPair(text: string, otherText = text, hoursApart = 0): UnifiedPost[] {
  return [
    post({ uri: 'a', text, platform: 'bluesky', createdAt: at(12),
           author: { handle: ALICE_BSKY, displayName: 'Alice' } }),
    post({ uri: 'b', text: otherText, platform: 'mastodon', createdAt: at(12 - hoursApart),
           author: { handle: ALICE_MASTO, displayName: 'Alice' } }),
  ];
}

const LONG = 'Shipping the new release today with a full changelog in the thread below for anyone who wants the details';

describe('detectCrossposts groups genuine crossposts', () => {
  it('groups identical text posted to both platforms', () => {
    const out = detectCrossposts(crosspostPair(LONG));
    expect(out).toHaveLength(1);
    expect(isCrosspostGroup(out[0])).toBe(true);
  });

  it('groups a copy truncated for the other platform', () => {
    const out = detectCrossposts(crosspostPair(LONG, LONG.slice(0, 60) + '…'));
    expect(out).toHaveLength(1);
  });

  it('groups a copy with a trailing link', () => {
    const out = detectCrossposts(crosspostPair(LONG, LONG + ' https://example.com/post/123'));
    expect(out).toHaveLength(1);
  });

  it('groups a copy with hashtags appended', () => {
    const out = detectCrossposts(crosspostPair(LONG, LONG + ' #opensource #fediverse'));
    expect(out).toHaveLength(1);
  });

  it('groups regardless of case and punctuation differences', () => {
    const out = detectCrossposts(crosspostPair(LONG, LONG.toUpperCase() + '!!!'));
    expect(out).toHaveLength(1);
  });
});

describe('detectCrossposts does not group unrelated posts', () => {
  it('leaves two different posts alone', () => {
    const out = detectCrossposts(crosspostPair(
      LONG,
      'Completely different subject about gardening and the weather this weekend in general'
    ));
    expect(out).toHaveLength(2);
  });

  /**
   * The case the old metric got badly wrong: posts sharing an opening but
   * saying different things. Character-level similarity rated these highly.
   */
  it('does not group posts that merely share a boilerplate opening', () => {
    const opening = 'Good morning everyone! Here is the daily update for the project ';
    const out = detectCrossposts(crosspostPair(
      opening + 'we finally landed the streaming rewrite after three weeks of debugging',
      opening + 'the design review is postponed until next Tuesday because of travel'
    ), IDENTITY_PAIRS);
    expect(out).toHaveLength(2);
  });

  it('does not group short posts that differ', () => {
    const out = detectCrossposts(crosspostPair('thanks!', 'thanks so much'), IDENTITY_PAIRS);
    expect(out).toHaveLength(2);
  });

  it('still groups short posts that are genuinely identical', () => {
    const out = detectCrossposts(crosspostPair('back online', 'back online'), IDENTITY_PAIRS);
    expect(out).toHaveLength(1);
  });
});

describe('detectCrossposts structure', () => {
  it('returns an empty array for an empty feed', () => {
    expect(detectCrossposts([])).toEqual([]);
  });

  it('never groups posts on the same platform', () => {
    const out = detectCrossposts([
      post({ uri: 'a', text: LONG, platform: 'bluesky' }),
      post({ uri: 'b', text: LONG, platform: 'bluesky' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('single-platform feed short-circuits but still de-duplicates by uri', () => {
    const out = detectCrossposts([
      post({ uri: 'a', text: 'hello' }),
      post({ uri: 'b', text: 'hello' }),
      post({ uri: 'a', text: 'hello' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('posts more than 24h apart are never grouped', () => {
    const out = detectCrossposts([
      post({ uri: 'a', text: LONG, platform: 'bluesky', createdAt: at(12) }),
      post({ uri: 'b', text: LONG, platform: 'mastodon',
             createdAt: new Date(Date.UTC(2026, 0, 12, 12)).toISOString() }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('exactly 24h apart is excluded (boundary is strict)', () => {
    const out = detectCrossposts([
      post({ uri: 'a', text: LONG, platform: 'bluesky', createdAt: at(12) }),
      post({ uri: 'b', text: LONG, platform: 'mastodon',
             createdAt: new Date(Date.UTC(2026, 0, 11, 12)).toISOString() }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('a group carries both posts, ordered by platform', () => {
    const out = detectCrossposts(crosspostPair(LONG));
    const group = out[0];
    if (!isCrosspostGroup(group)) throw new Error('expected a group');
    expect(group.posts.map((p) => p.platform)).toEqual(['bluesky', 'mastodon']);
    expect(group.similarity).toBeGreaterThanOrEqual(0.8);
  });

  it('never drops or duplicates a post', () => {
    const posts = [
      ...crosspostPair(LONG),
      post({ uri: 'c', text: 'something else entirely about a different topic', platform: 'bluesky' }),
      post({ uri: 'd', text: 'yet another unrelated thought for the afternoon', platform: 'mastodon' }),
    ];
    const seen = new Set<string>();
    for (const item of detectCrossposts(posts)) {
      for (const p of isCrosspostGroup(item) ? item.posts : [item as UnifiedPost]) {
        expect(seen.has(p.uri)).toBe(false);
        seen.add(p.uri);
      }
    }
    expect(seen.size).toBe(4);
  });

  it('handles unparseable timestamps without dropping posts', () => {
    const posts = [
      post({ uri: 'a', text: LONG, platform: 'bluesky', createdAt: 'not-a-date' }),
      post({ uri: 'b', text: LONG, platform: 'mastodon', createdAt: at(12) }),
    ];
    const out = detectCrossposts(posts);
    const uris = out.flatMap((i) => (isCrosspostGroup(i) ? i.posts : [i as UnifiedPost])).map((p) => p.uri);
    expect(new Set(uris)).toEqual(new Set(['a', 'b']));
  });
});

describe('identity pairs lower the threshold', () => {
  /**
   * Same person, same story, reworded enough that the strict threshold misses
   * it. Confirming the identity link is what makes it a match.
   */
  // Scores 0.64: above the identity threshold (0.6), below the default (0.8).
  const bsky = 'The streaming rewrite finally landed after three weeks of debugging the reconnect logic';
  const masto = 'The streaming rewrite finally landed after three weeks of work on the reconnect handler';

  it('does not group at the default threshold', () => {
    const posts = [
      post({ uri: 'a', text: bsky, platform: 'bluesky',
             author: { handle: ALICE_BSKY, displayName: 'A' } }),
      post({ uri: 'b', text: masto, platform: 'mastodon',
             author: { handle: '@bob@mastodon.social', displayName: 'B' } }),
    ];
    expect(detectCrossposts(posts)).toHaveLength(2);
  });

  it('groups when the authors are a confirmed identity pair', () => {
    const posts = [
      post({ uri: 'a', text: bsky, platform: 'bluesky',
             author: { handle: ALICE_BSKY, displayName: 'A' } }),
      post({ uri: 'b', text: masto, platform: 'mastodon',
             author: { handle: ALICE_MASTO, displayName: 'A' } }),
    ];
    expect(detectCrossposts(posts, IDENTITY_PAIRS)).toHaveLength(1);
  });
});
