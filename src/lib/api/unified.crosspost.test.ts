/**
 * Differential + property tests for detectCrossposts.
 *
 * The optimized implementation prunes candidate pairs and narrows the time
 * window. Those are meant to be pure speedups, so the contract under test is:
 * for ANY input, it returns exactly what the original exhaustive O(n^2)
 * implementation returned. The reference below is that original, copied
 * verbatim from before the optimization, and the fuzz test asserts equality.
 */
import { describe, it, expect } from 'vitest';
import { detectCrossposts, buildIdentityPairs, jaroWinklerUpperBound } from './unified';
import type { UnifiedPost, FeedItem } from '$lib/types';

// ---------------------------------------------------------------------------
// Reference implementation (pre-optimization, unmodified)
// ---------------------------------------------------------------------------

function refJaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const len1 = s1.length, len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0, transpositions = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;

  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

function refAreIdentityMatched(h1: string, h2: string, pairs: Set<string>): boolean {
  return pairs.has([h1.toLowerCase(), h2.toLowerCase()].sort().join('<>'));
}

function refDetectCrossposts(posts: UnifiedPost[], identityPairs?: Set<string>): FeedItem[] {
  const DEFAULT_THRESHOLD = 0.9;
  const IDENTITY_THRESHOLD = 0.7;
  const TIME_WINDOW_MS = 24 * 60 * 60 * 1000;
  const feedItems: FeedItem[] = [];
  const processedUris = new Set<string>();

  for (const post1 of posts) {
    if (processedUris.has(post1.uri)) continue;

    const potentialMatches = posts.filter(
      (post2) =>
        !processedUris.has(post2.uri) &&
        post1.uri !== post2.uri &&
        post1.platform !== post2.platform &&
        Math.abs(
          new Date(post1.createdAt).getTime() - new Date(post2.createdAt).getTime()
        ) < TIME_WINDOW_MS
    );

    let bestMatch: UnifiedPost | null = null;
    let bestScore = 0;
    let bestIsIdentityMatch = false;

    for (const post2 of potentialMatches) {
      const score = refJaroWinkler(post1.text, post2.text);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = post2;
        bestIsIdentityMatch = identityPairs
          ? refAreIdentityMatched(post1.author.handle, post2.author.handle, identityPairs)
          : false;
      }
    }

    const threshold = bestIsIdentityMatch ? IDENTITY_THRESHOLD : DEFAULT_THRESHOLD;

    if (bestMatch && bestScore >= threshold) {
      const allMatches = [post1, bestMatch].sort((a, b) =>
        a.platform.localeCompare(b.platform)
      );
      feedItems.push({
        type: 'crosspost',
        id: post1.uri,
        posts: allMatches,
        similarity: bestScore,
      } as FeedItem);
      allMatches.forEach((p) => processedUris.add(p.uri));
    } else {
      feedItems.push(post1);
      processedUris.add(post1.uri);
    }
  }

  return feedItems;
}

// ---------------------------------------------------------------------------
// Deterministic PRNG so failures reproduce from the seed alone
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SENTENCES = [
  'Shipping a new release today, changelog in the thread',
  'Shipping a new release today, changelog in thread',
  'Coffee first, then the incident review',
  '',
  'a',
  'The quick brown fox jumps over the lazy dog and keeps going for quite a while',
  'The quick brown fox jumps over the lazy dog and keeps going for quite a whilst',
  'Completely unrelated post about gardening',
  '🌱🌱🌱 emoji only post',
];

function makePost(rng: () => number, i: number, opts: { badDate?: boolean } = {}): UnifiedPost {
  const platform = rng() < 0.5 ? 'bluesky' : 'mastodon';
  const base = Date.UTC(2026, 0, 10, 12, 0, 0);
  const created = opts.badDate && rng() < 0.15
    ? 'not-a-date'
    : new Date(base - Math.floor(rng() * 72) * 3600_000).toISOString();
  let text = SENTENCES[Math.floor(rng() * SENTENCES.length)];
  if (rng() < 0.3) text = text + ' ' + Math.floor(rng() * 5);
  return {
    uri: `uri-${i}`,
    text,
    createdAt: created,
    platform,
    author: {
      handle: rng() < 0.5 ? '@alice.bsky.social' : '@alice@mastodon.social',
      displayName: 'Alice',
    },
  } as UnifiedPost;
}

function randomFeed(rng: () => number, n: number, opts: { sorted?: boolean; badDate?: boolean } = {}) {
  const posts = Array.from({ length: n }, (_, i) => makePost(rng, i, opts));
  if (opts.sorted !== false) {
    posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  return posts;
}

const IDENTITY_PAIRS = buildIdentityPairs([
  { confirmed: true, links: [{ handle: '@alice.bsky.social' }, { handle: '@alice@mastodon.social' }] },
]);

describe('detectCrossposts — differential against the original implementation', () => {
  it('matches the reference on 400 random time-ordered feeds', () => {
    for (let seed = 0; seed < 400; seed++) {
      const rng = mulberry32(seed);
      const posts = randomFeed(rng, 1 + Math.floor(rng() * 40));
      expect(detectCrossposts(posts), `seed ${seed}`).toEqual(refDetectCrossposts(posts));
    }
  });

  it('matches the reference with identity pairs applied', () => {
    for (let seed = 1000; seed < 1400; seed++) {
      const rng = mulberry32(seed);
      const posts = randomFeed(rng, 1 + Math.floor(rng() * 40));
      expect(detectCrossposts(posts, IDENTITY_PAIRS), `seed ${seed}`).toEqual(
        refDetectCrossposts(posts, IDENTITY_PAIRS)
      );
    }
  });

  it('matches the reference on unsorted feeds (window optimization must disengage)', () => {
    for (let seed = 2000; seed < 2300; seed++) {
      const rng = mulberry32(seed);
      const posts = randomFeed(rng, 1 + Math.floor(rng() * 30), { sorted: false });
      expect(detectCrossposts(posts, IDENTITY_PAIRS), `seed ${seed}`).toEqual(
        refDetectCrossposts(posts, IDENTITY_PAIRS)
      );
    }
  });

  it('matches the reference when createdAt is unparseable', () => {
    for (let seed = 3000; seed < 3300; seed++) {
      const rng = mulberry32(seed);
      const posts = randomFeed(rng, 1 + Math.floor(rng() * 25), { badDate: true, sorted: false });
      expect(detectCrossposts(posts, IDENTITY_PAIRS), `seed ${seed}`).toEqual(
        refDetectCrossposts(posts, IDENTITY_PAIRS)
      );
    }
  });

  it('matches the reference on large feeds', () => {
    for (const seed of [4001, 4002, 4003]) {
      const rng = mulberry32(seed);
      const posts = randomFeed(rng, 400);
      expect(detectCrossposts(posts, IDENTITY_PAIRS), `seed ${seed}`).toEqual(
        refDetectCrossposts(posts, IDENTITY_PAIRS)
      );
    }
  });
});

describe('detectCrossposts — edge cases the fast paths must not break', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 0, 10, h)).toISOString();
  const p = (o: Partial<UnifiedPost>): UnifiedPost =>
    ({ uri: 'u', text: 't', createdAt: at(12), platform: 'bluesky',
       author: { handle: '@a', displayName: 'A' }, ...o } as UnifiedPost);

  it('returns an empty array for an empty feed', () => {
    expect(detectCrossposts([])).toEqual([]);
  });

  it('single-platform feed short-circuits but still de-duplicates by uri', () => {
    const posts = [
      p({ uri: 'a', text: 'hello' }),
      p({ uri: 'b', text: 'hello' }),
      p({ uri: 'a', text: 'hello' }),
    ];
    const out = detectCrossposts(posts);
    expect(out).toHaveLength(2);
    expect(out).toEqual(refDetectCrossposts(posts));
  });

  it('two identical empty-text posts on different platforms still group', () => {
    const posts = [
      p({ uri: 'a', text: '', platform: 'bluesky' }),
      p({ uri: 'b', text: '', platform: 'mastodon' }),
    ];
    expect(detectCrossposts(posts)).toEqual(refDetectCrossposts(posts));
    expect(detectCrossposts(posts)[0]).toMatchObject({ type: 'crosspost', similarity: 1 });
  });

  it('an empty post does not match a non-empty one', () => {
    const posts = [
      p({ uri: 'a', text: '', platform: 'bluesky' }),
      p({ uri: 'b', text: 'something', platform: 'mastodon' }),
    ];
    expect(detectCrossposts(posts)).toHaveLength(2);
  });

  it('posts more than 24h apart are never grouped', () => {
    const posts = [
      p({ uri: 'a', text: 'identical text here', platform: 'bluesky', createdAt: at(12) }),
      p({ uri: 'b', text: 'identical text here', platform: 'mastodon',
          createdAt: new Date(Date.UTC(2026, 0, 12, 12)).toISOString() }),
    ];
    expect(detectCrossposts(posts)).toHaveLength(2);
  });

  it('exactly 24h apart is excluded (boundary is strict)', () => {
    const posts = [
      p({ uri: 'a', text: 'identical text here', platform: 'bluesky', createdAt: at(12) }),
      p({ uri: 'b', text: 'identical text here', platform: 'mastodon',
          createdAt: new Date(Date.UTC(2026, 0, 11, 12)).toISOString() }),
    ];
    expect(detectCrossposts(posts)).toHaveLength(2);
    expect(detectCrossposts(posts)).toEqual(refDetectCrossposts(posts));
  });

  it('identity match lowers the threshold to 0.7', () => {
    const posts = [
      p({ uri: 'a', text: 'Shipping a new release today, changelog in the thread',
          platform: 'bluesky', author: { handle: '@alice.bsky.social', displayName: 'A' } }),
      p({ uri: 'b', text: 'Shipping a new release today! Full changelog below.',
          platform: 'mastodon', author: { handle: '@alice@mastodon.social', displayName: 'A' } }),
    ];
    expect(detectCrossposts(posts)).toHaveLength(2);                 // 0.9 threshold: no group
    expect(detectCrossposts(posts, IDENTITY_PAIRS)).toHaveLength(1); // 0.7 threshold: grouped
  });
});

describe('jaroWinklerUpperBound', () => {
  it('is an upper bound on the true score for random pairs', () => {
    const rng = mulberry32(7);
    const alphabet = 'abcdefg ';
    for (let n = 0; n < 5000; n++) {
      const mk = () => Array.from(
        { length: Math.floor(rng() * 12) },
        () => alphabet[Math.floor(rng() * alphabet.length)]
      ).join('');
      const a = mk(), b = mk();
      const bound = jaroWinklerUpperBound(a.length, b.length);
      const actual = refJaroWinkler(a, b);
      expect(bound, `"${a}" vs "${b}"`).toBeGreaterThanOrEqual(actual - 1e-12);
    }
  });

  it('is tight for identical lengths and exact for empty inputs', () => {
    expect(jaroWinklerUpperBound(10, 10)).toBe(1);
    expect(jaroWinklerUpperBound(0, 0)).toBe(1);
    expect(jaroWinklerUpperBound(0, 5)).toBe(0);
    expect(jaroWinklerUpperBound(5, 0)).toBe(0);
  });

  it('falls below the 0.9 threshold once lengths differ by more than 2x', () => {
    expect(jaroWinklerUpperBound(10, 21)).toBeLessThan(0.9);
    expect(jaroWinklerUpperBound(10, 20)).toBeGreaterThanOrEqual(0.9);
  });
});
