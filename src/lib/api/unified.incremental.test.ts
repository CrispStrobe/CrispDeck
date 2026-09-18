/**
 * detectCrosspostsIncremental must be indistinguishable from recomputing the
 * whole feed. These tests simulate infinite scroll — append a page, derive,
 * append again — and assert the incremental result equals the full one at every
 * step, including the steps where it bails out to a full recomputation.
 */
import { describe, it, expect } from 'vitest';
import {
  detectCrossposts,
  detectCrosspostsIncremental,
  buildIdentityPairs,
  isCrosspostGroup,
  type CrosspostCache,
} from './unified';
import type { UnifiedPost } from '$lib/types';

function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ('the quick brown fox jumps over lazy dog shipping release changelog thread ' +
  'incident review coffee deploy rollback latency dashboard metrics alert federation').split(' ');

/**
 * Pages of posts in descending time order, the way the feed appends them.
 * spanHours controls how much of the feed falls inside the 24h match window.
 */
function makePages(seed: number, pages: number, perPage: number, spanHours = 96) {
  const rng = mulberry32(seed);
  const base = Date.UTC(2026, 0, 20, 12);
  const all: UnifiedPost[] = [];
  const step = (spanHours * 3600_000) / (pages * perPage);
  for (let i = 0; i < pages * perPage; i++) {
    const len = 8 + Math.floor(rng() * 14);
    let text = Array.from({ length: len }, () => WORDS[Math.floor(rng() * WORDS.length)]).join(' ');
    const post: UnifiedPost = {
      uri: `at://post/${seed}/${i}`,
      text,
      createdAt: new Date(base - i * step).toISOString(),
      platform: rng() < 0.5 ? 'bluesky' : 'mastodon',
      author: {
        handle: rng() < 0.5 ? '@alice.bsky.social' : '@alice@mastodon.social',
        displayName: 'A',
      },
    } as UnifiedPost;
    // ~12% of posts duplicate the previous one on the other platform
    if (rng() < 0.12 && all.length > 0) {
      const prev = all[all.length - 1];
      post.text = prev.text;
      post.platform = prev.platform === 'bluesky' ? 'mastodon' : 'bluesky';
    }
    all.push(post);
  }
  const out: UnifiedPost[][] = [];
  for (let p = 0; p < pages; p++) out.push(all.slice(p * perPage, (p + 1) * perPage));
  return out;
}

const IDS = buildIdentityPairs([
  { confirmed: true, links: [{ handle: '@alice.bsky.social' }, { handle: '@alice@mastodon.social' }] },
]);

describe('detectCrosspostsIncremental', () => {
  it('equals a full recomputation at every scroll step', { timeout: 60_000 }, () => {
    for (let seed = 0; seed < 40; seed++) {
      const pages = makePages(seed, 5, 20);
      let accumulated: UnifiedPost[] = [];
      let cache: CrosspostCache | null = null;
      for (let p = 0; p < pages.length; p++) {
        accumulated = accumulated.concat(pages[p]);
        const res = detectCrosspostsIncremental(accumulated, IDS, cache);
        cache = res.cache;
        expect(res.items, `seed ${seed} page ${p}`).toEqual(
          detectCrossposts(accumulated, IDS)
        );
      }
    }
  });

  it('equals a full recomputation for feeds shorter than the match window', { timeout: 60_000 }, () => {
    // Every post within 24h of every other: nothing can be reused, must fall back.
    for (let seed = 500; seed < 530; seed++) {
      const pages = makePages(seed, 4, 15, 6);
      let acc: UnifiedPost[] = [];
      let cache: CrosspostCache | null = null;
      for (const page of pages) {
        acc = acc.concat(page);
        const res = detectCrosspostsIncremental(acc, IDS, cache);
        cache = res.cache;
        expect(res.items, `seed ${seed}`).toEqual(detectCrossposts(acc, IDS));
      }
    }
  });

  it('actually reuses work once the feed spans more than the match window', () => {
    const pages = makePages(11, 8, 40, 240);
    let acc: UnifiedPost[] = [];
    let cache: CrosspostCache | null = null;
    let lastReused = 0;
    for (const page of pages) {
      acc = acc.concat(page);
      const res = detectCrosspostsIncremental(acc, IDS, cache);
      cache = res.cache;
      lastReused = res.reused;
    }
    expect(lastReused).toBeGreaterThan(100);
  });

  it('falls back to a full recomputation when the array is not an append', () => {
    const pages = makePages(7, 2, 20);
    const first = pages[0];
    const res1 = detectCrosspostsIncremental(first, IDS, null);
    // A refresh that prepends new posts is not an append of the previous array.
    const prepended = pages[1].concat(first);
    const res2 = detectCrosspostsIncremental(prepended, IDS, res1.cache);
    expect(res2.reused).toBe(0);
    expect(res2.items).toEqual(detectCrossposts(prepended, IDS));
  });

  it('falls back when the feed is not time-ordered', () => {
    const acc = makePages(9, 2, 20).flat();
    const res1 = detectCrosspostsIncremental(acc, IDS, null);
    const shuffled = acc.concat(acc.slice(0, 5).map((p, i) => ({
      ...p, uri: `extra-${i}`, createdAt: new Date(Date.UTC(2027, 0, 1)).toISOString(),
    } as UnifiedPost)));
    const res2 = detectCrosspostsIncremental(shuffled, IDS, res1.cache);
    expect(res2.reused).toBe(0);
    expect(res2.items).toEqual(detectCrossposts(shuffled, IDS));
  });

  it('falls back when a createdAt is unparseable', () => {
    const acc = makePages(13, 2, 15).flat();
    const res1 = detectCrosspostsIncremental(acc, IDS, null);
    const withBad = acc.concat([{ ...acc[0], uri: 'bad', createdAt: 'nope' } as UnifiedPost]);
    const res2 = detectCrosspostsIncremental(withBad, IDS, res1.cache);
    expect(res2.reused).toBe(0);
    expect(res2.items).toEqual(detectCrossposts(withBad, IDS));
  });

  it('preserves crosspost groups that straddle the reuse boundary', { timeout: 60_000 }, () => {
    const pages = makePages(21, 5, 30, 200);
    let acc: UnifiedPost[] = [];
    let cache: CrosspostCache | null = null;
    for (const page of pages) {
      acc = acc.concat(page);
      const res = detectCrosspostsIncremental(acc, IDS, cache);
      cache = res.cache;
      const groups = res.items.filter(isCrosspostGroup);
      const expected = detectCrossposts(acc, IDS).filter(isCrosspostGroup);
      expect(groups.map((g) => g.id)).toEqual(expected.map((g) => g.id));
    }
  });

  it('never drops or duplicates a post', { timeout: 60_000 }, () => {
    for (let seed = 900; seed < 930; seed++) {
      const pages = makePages(seed, 5, 20, 150);
      let acc: UnifiedPost[] = [];
      let cache: CrosspostCache | null = null;
      for (const page of pages) {
        acc = acc.concat(page);
        const res = detectCrosspostsIncremental(acc, IDS, cache);
        cache = res.cache;
        const seen = new Set<string>();
        for (const item of res.items) {
          for (const p of isCrosspostGroup(item) ? item.posts : [item as UnifiedPost]) {
            expect(seen.has(p.uri), `dup ${p.uri} seed ${seed}`).toBe(false);
            seen.add(p.uri);
          }
        }
        expect(seen.size).toBe(new Set(acc.map((p) => p.uri)).size);
      }
    }
  });
});
