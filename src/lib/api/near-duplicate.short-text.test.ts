/**
 * Short posts must not merge unrelated people.
 *
 * Texts below the shingle size fall back to comparing their words, and
 * containment divides by the smaller set — so "thanks" scores a perfect 1
 * against "thanks everyone", and two strangers both posting "Good morning!"
 * score 1 as well. near-duplicate's own comment said the author check was what
 * stopped those grouping, but detectCrossposts had no author check: identity
 * only lowered the threshold, it was never required. Both cases grouped, hiding
 * one of the two posts behind the other.
 */
import { describe, it, expect } from 'vitest';
import { detectCrossposts, buildIdentityPairs, isCrosspostGroup } from './unified';
import { fingerprint, similarity, usedWordFallback, SHINGLE_SIZE } from './near-duplicate';
import type { UnifiedPost } from '$lib/types';

const at = (h: number) => new Date(Date.UTC(2026, 0, 10, h)).toISOString();

function post(o: Partial<UnifiedPost> & { uri: string; handle: string }): UnifiedPost {
  const { handle, ...rest } = o;
  return {
    text: 'text', createdAt: at(12), platform: 'bluesky',
    author: { handle, displayName: handle },
    ...rest,
  } as UnifiedPost;
}

const ALICE_BSKY = '@alice.bsky.social';
const ALICE_MASTO = '@alice@mastodon.social';
const IDS = buildIdentityPairs([
  { confirmed: true, links: [{ handle: ALICE_BSKY }, { handle: ALICE_MASTO }] },
]);

const LONG_A = 'Shipping the new release today with the full changelog in the thread below';

describe('usedWordFallback', () => {
  it('is true below the shingle size', () => {
    expect(usedWordFallback(fingerprint('gm'))).toBe(true);
    expect(usedWordFallback(fingerprint('good morning'))).toBe(true);
  });

  it('is false at or above it', () => {
    expect(usedWordFallback(fingerprint('good morning everyone'))).toBe(false);
    expect(usedWordFallback(fingerprint(LONG_A))).toBe(false);
  });

  it('counts words after normalisation, not raw length', () => {
    // A link is dropped entirely, so this stays below the shingle size despite
    // looking long.
    expect(fingerprint('thanks!! https://example.com/a/b/c').tokenCount).toBe(1);
    expect(usedWordFallback(fingerprint('thanks!! https://example.com/a/b/c'))).toBe(true);
  });

  it('hashtags and mentions keep their words, only the marker goes', () => {
    // Documented behaviour of normalizeForCompare: the markers differ between
    // networks, the words after them usually do not. So this is three tokens
    // and forms a real shingle.
    expect(fingerprint('thanks #tag @someone').tokenCount).toBe(SHINGLE_SIZE);
    expect(usedWordFallback(fingerprint('thanks #tag @someone'))).toBe(false);
  });
});

describe('short texts still score high — the scoring is not what changed', () => {
  it('"thanks" is fully contained in "thanks everyone"', () => {
    expect(similarity(fingerprint('thanks'), fingerprint('thanks everyone'))).toBe(1);
  });

  it('two identical short texts score 1', () => {
    expect(similarity(fingerprint('Good morning!'), fingerprint('Good morning!'))).toBe(1);
  });
});

describe('detectCrossposts does not merge different people on a short text', () => {
  it('two strangers posting the same greeting stay separate', () => {
    const out = detectCrossposts([
      post({ uri: 'a', text: 'Good morning!', platform: 'bluesky', handle: '@alice.bsky.social' }),
      post({ uri: 'b', text: 'Good morning!', platform: 'mastodon', createdAt: at(11),
             handle: '@bob@mastodon.social' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('a short post is not swallowed by a longer one containing its words', () => {
    const out = detectCrossposts([
      post({ uri: 'c', text: 'thanks', platform: 'bluesky', handle: '@carol.bsky.social' }),
      post({ uri: 'd', text: 'thanks everyone', platform: 'mastodon', createdAt: at(11),
             handle: '@dave@mastodon.social' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('still groups a short crosspost when the identity is confirmed', () => {
    const out = detectCrossposts([
      post({ uri: 'e', text: 'Good morning!', platform: 'bluesky', handle: ALICE_BSKY }),
      post({ uri: 'f', text: 'Good morning!', platform: 'mastodon', createdAt: at(11),
             handle: ALICE_MASTO }),
    ], IDS);
    expect(out).toHaveLength(1);
    expect(isCrosspostGroup(out[0])).toBe(true);
  });

  it('still groups a short crosspost when the handle is identical', () => {
    const out = detectCrossposts([
      post({ uri: 'g', text: 'Good morning!', platform: 'bluesky', handle: '@same.example' }),
      post({ uri: 'h', text: 'Good morning!', platform: 'mastodon', createdAt: at(11),
             handle: '@same.example' }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('leaves normal-length posts alone — different authors still group', () => {
    // The guard is scoped to the short-text path; content-based grouping for
    // real posts is unchanged, which is what makes it work without an identity map.
    const out = detectCrossposts([
      post({ uri: 'i', text: LONG_A, platform: 'bluesky', handle: '@erin.bsky.social' }),
      post({ uri: 'j', text: LONG_A, platform: 'mastodon', createdAt: at(11),
             handle: '@erin@mastodon.social' }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('never drops a post either way', () => {
    const posts = [
      post({ uri: 'k', text: 'gm', platform: 'bluesky', handle: '@a' }),
      post({ uri: 'l', text: 'gm all', platform: 'mastodon', createdAt: at(11), handle: '@b' }),
      post({ uri: 'm', text: LONG_A, platform: 'bluesky', handle: '@c' }),
      post({ uri: 'n', text: LONG_A, platform: 'mastodon', createdAt: at(11), handle: '@c' }),
    ];
    const seen = new Set<string>();
    for (const item of detectCrossposts(posts)) {
      for (const p of isCrosspostGroup(item) ? item.posts : [item as UnifiedPost]) seen.add(p.uri);
    }
    expect(seen.size).toBe(4);
  });
});
