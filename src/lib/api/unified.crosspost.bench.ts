/**
 * A/B benchmark: optimized detectCrossposts vs the original O(n^2) version.
 *
 *   npx vitest bench src/lib/api/unified.crosspost.bench.ts
 *
 * Feed sizes mirror real usage: ~50 posts on first load, growing to several
 * hundred as infinite scroll appends pages. The derived in feed/+page.svelte
 * re-runs detection over the whole accumulated array on every append, so the
 * large sizes are the ones that matter.
 */
import { bench, describe } from 'vitest';
import { detectCrossposts, buildIdentityPairs } from './unified';
import type { UnifiedPost, FeedItem } from '$lib/types';

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
      s1Matches[i] = true; s2Matches[j] = true; matches++; break;
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
    if (s1[i] === s2[i]) prefix++; else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

function refDetectCrossposts(posts: UnifiedPost[], identityPairs?: Set<string>): FeedItem[] {
  const TIME_WINDOW_MS = 24 * 60 * 60 * 1000;
  const feedItems: FeedItem[] = [];
  const processedUris = new Set<string>();
  for (const post1 of posts) {
    if (processedUris.has(post1.uri)) continue;
    const potentialMatches = posts.filter(
      (post2) => !processedUris.has(post2.uri) && post1.uri !== post2.uri &&
        post1.platform !== post2.platform &&
        Math.abs(new Date(post1.createdAt).getTime() - new Date(post2.createdAt).getTime()) < TIME_WINDOW_MS
    );
    let bestMatch: UnifiedPost | null = null, bestScore = 0, bestIsIdentityMatch = false;
    for (const post2 of potentialMatches) {
      const score = refJaroWinkler(post1.text, post2.text);
      if (score > bestScore) {
        bestScore = score; bestMatch = post2;
        bestIsIdentityMatch = identityPairs
          ? identityPairs.has([post1.author.handle.toLowerCase(), post2.author.handle.toLowerCase()].sort().join('<>'))
          : false;
      }
    }
    const threshold = bestIsIdentityMatch ? 0.7 : 0.9;
    if (bestMatch && bestScore >= threshold) {
      const allMatches = [post1, bestMatch].sort((a, b) => a.platform.localeCompare(b.platform));
      feedItems.push({ type: 'crosspost', id: post1.uri, posts: allMatches, similarity: bestScore } as FeedItem);
      allMatches.forEach((p) => processedUris.add(p.uri));
    } else {
      feedItems.push(post1);
      processedUris.add(post1.uri);
    }
  }
  return feedItems;
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ('the quick brown fox jumps over lazy dog shipping release changelog thread ' +
  'incident review coffee morning deploy rollback latency p99 dashboard metrics alert ' +
  'open source federation protocol client timeline moderation labeler handle identity').split(' ');

/** Realistic feed: mixed platforms, ~180 char posts, spanning 3 days, some genuine crossposts. */
function buildFeed(n: number, seed = 1): UnifiedPost[] {
  const rng = mulberry32(seed);
  const base = Date.UTC(2026, 0, 10, 12);
  const posts: UnifiedPost[] = [];
  for (let i = 0; i < n; i++) {
    const len = 12 + Math.floor(rng() * 18);
    const text = Array.from({ length: len }, () => WORDS[Math.floor(rng() * WORDS.length)]).join(' ');
    const createdAt = new Date(base - Math.floor(rng() * 72) * 3600_000 - i * 1000).toISOString();
    posts.push({
      uri: `at://post/${i}`, text, createdAt,
      platform: rng() < 0.5 ? 'bluesky' : 'mastodon',
      author: { handle: rng() < 0.5 ? '@alice.bsky.social' : '@alice@mastodon.social', displayName: 'A' },
    } as UnifiedPost);
    // ~8% of posts are a genuine crosspost of the previous one
    if (rng() < 0.08 && posts.length > 1) {
      const prev = posts[posts.length - 2];
      posts[posts.length - 1] = {
        ...posts[posts.length - 1],
        text: prev.text,
        platform: prev.platform === 'bluesky' ? 'mastodon' : 'bluesky',
        createdAt: new Date(new Date(prev.createdAt).getTime() - 60_000).toISOString(),
      } as UnifiedPost;
    }
  }
  return posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

const IDS = buildIdentityPairs([
  { confirmed: true, links: [{ handle: '@alice.bsky.social' }, { handle: '@alice@mastodon.social' }] },
]);

for (const n of [50, 100, 200, 400, 800]) {
  const feed = buildFeed(n);
  describe(`feed of ${n} posts`, () => {
    bench('optimized', () => { detectCrossposts(feed, IDS); });
    bench('original', () => { refDetectCrossposts(feed, IDS); });
  });
}

// Single-platform feed — the fast path. Common when the platform filter is on.
for (const n of [400]) {
  const feed = buildFeed(n).map((p) => ({ ...p, platform: 'bluesky' })) as UnifiedPost[];
  describe(`feed of ${n} posts, single platform`, () => {
    bench('optimized', () => { detectCrossposts(feed, IDS); });
    bench('original', () => { refDetectCrossposts(feed, IDS); });
  });
}

// ---------------------------------------------------------------------------
// The metric that matches real use: a whole infinite-scroll session.
// Each bench runs 10 appends of 50 posts, deriving after every append, ending
// at a 500-post feed — i.e. what the page actually does when you scroll.
// ---------------------------------------------------------------------------
import { detectCrosspostsIncremental, type CrosspostCache } from './unified';

const PAGES = 10, PER_PAGE = 50;
const scrollFeed = buildFeed(PAGES * PER_PAGE, 99);

describe(`scroll session: ${PAGES} appends of ${PER_PAGE} posts`, () => {
  bench('incremental (current)', () => {
    let acc: UnifiedPost[] = [];
    let cache: CrosspostCache | null = null;
    for (let p = 0; p < PAGES; p++) {
      acc = acc.concat(scrollFeed.slice(p * PER_PAGE, (p + 1) * PER_PAGE));
      const r = detectCrosspostsIncremental(acc, IDS, cache);
      cache = r.cache;
    }
  });

  bench('full detect each append (optimized)', () => {
    let acc: UnifiedPost[] = [];
    for (let p = 0; p < PAGES; p++) {
      acc = acc.concat(scrollFeed.slice(p * PER_PAGE, (p + 1) * PER_PAGE));
      detectCrossposts(acc, IDS);
    }
  });

  bench('full detect each append (original)', () => {
    let acc: UnifiedPost[] = [];
    for (let p = 0; p < PAGES; p++) {
      acc = acc.concat(scrollFeed.slice(p * PER_PAGE, (p + 1) * PER_PAGE));
      refDetectCrossposts(acc, IDS);
    }
  });
});
