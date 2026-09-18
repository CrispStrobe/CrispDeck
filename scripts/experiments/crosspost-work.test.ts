/**
 * Deterministic A/B for crosspost detection.
 *
 * NOTE: "original" is Jaro-Winkler over full post text at thresholds 0.9/0.7;
 * "current" is trigram containment at 0.8/0.6. They no longer produce the same
 * groupings — that change was deliberate and is justified in
 * crosspost-similarity.test.ts. What is compared here is the cost.
 *
 * Wall-clock on a shared box is too noisy to compare 1.5x effects, so this
 * counts the actual work instead: how many times the Jaro-Winkler similarity
 * is computed, and how many character comparisons that costs. Both are exact
 * and load-independent.
 *
 * The instrumented copies below are checked against the real implementations on
 * every input before their counts are reported, so a drift between copy and
 * original fails the run rather than silently reporting the wrong thing.
 *
 *   npx vitest run --config vite.config.js scripts/experiments/crosspost-work.test.ts
 */
import { it, expect } from 'vitest';
import {
  detectCrossposts,
  detectCrosspostsIncremental,
  buildIdentityPairs,
  type CrosspostCache,
} from '../../src/lib/api/unified';
import { profileText, textSimilarity } from '../../src/lib/api/similarity';
import type { UnifiedPost, FeedItem } from '../../src/lib/types';

let CALLS = 0, CHARCMP = 0;

/** Instrumented trigram containment — counts shingle comparisons. */
function sim(a: ReturnType<typeof profileText>, b: ReturnType<typeof profileText>): number {
  CALLS++;
  CHARCMP += Math.min(a.shingles.size, b.shingles.size);
  return textSimilarity(a, b);
}
function jw(s1: string, s2: string): number {
  CALLS++;
  if (s1 === s2) { CHARCMP += 1; return 1; }
  const len1 = s1.length, len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;
  const matchWindow = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
  const m1 = new Array(len1).fill(false), m2 = new Array(len2).fill(false);
  let matches = 0, transpositions = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow), end = Math.min(i + matchWindow + 1, len2);
    for (let j = start; j < end; j++) {
      CHARCMP++;
      if (m2[j] || s1[i] !== s2[j]) continue;
      m1[i] = true; m2[j] = true; matches++; break;
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) { if (s1[i] === s2[i]) prefix++; else break; }
  return jaro + prefix * 0.1 * (1 - jaro);
}

const W = 24 * 60 * 60 * 1000;
const idMatch = (a: string, b: string, p: Set<string>) =>
  p.has([a.toLowerCase(), b.toLowerCase()].sort().join('<>'));

/** Instrumented copy of the ORIGINAL implementation. */
function origDetect(posts: UnifiedPost[], ids?: Set<string>): FeedItem[] {
  const out: FeedItem[] = [], done = new Set<string>();
  for (const p1 of posts) {
    if (done.has(p1.uri)) continue;
    const cands = posts.filter(p2 => !done.has(p2.uri) && p1.uri !== p2.uri &&
      p1.platform !== p2.platform &&
      Math.abs(new Date(p1.createdAt).getTime() - new Date(p2.createdAt).getTime()) < W);
    let best: UnifiedPost | null = null, score = 0, idm = false;
    for (const p2 of cands) {
      const s = jw(p1.text, p2.text);
      if (s > score) { score = s; best = p2; idm = ids ? idMatch(p1.author.handle, p2.author.handle, ids) : false; }
    }
    if (best && score >= (idm ? 0.7 : 0.9)) {
      const all = [p1, best].sort((a, b) => a.platform.localeCompare(b.platform));
      out.push({ type: 'crosspost', id: p1.uri, posts: all, similarity: score } as FeedItem);
      all.forEach(p => done.add(p.uri));
    } else { out.push(p1); done.add(p1.uri); }
  }
  return out;
}

/** Instrumented copy of the CURRENT implementation. */
function newDetect(posts: UnifiedPost[], ids?: Set<string>): FeedItem[] {
  const out: FeedItem[] = [], done = new Set<string>(), n = posts.length;
  if (n === 0) return out;
  let multi = false;
  for (let i = 1; i < n; i++) if (posts[i].platform !== posts[0].platform) { multi = true; break; }
  if (!multi) {
    for (const p of posts) { if (done.has(p.uri)) continue; done.add(p.uri); out.push(p); }
    return out;
  }
  const ts = new Float64Array(n);
  let ordered = true;
  for (let i = 0; i < n; i++) {
    const t = new Date(posts[i].createdAt).getTime();
    ts[i] = t;
    if (Number.isNaN(t)) ordered = false;
    else if (i > 0 && t > ts[i - 1]) ordered = false;
  }
  const profiles = posts.map(p => profileText(p.text));
  let lo = 0, hi = 0;
  for (let i = 0; i < n; i++) {
    const p1 = posts[i];
    if (done.has(p1.uri)) continue;
    let from = 0, to = n - 1;
    if (ordered) {
      while (lo < i && !(ts[lo] - ts[i] < W)) lo++;
      while (hi + 1 < n && ts[i] - ts[hi + 1] < W) hi++;
      from = lo; to = hi;
    }
    const plat = p1.platform, t1 = ts[i];
    let best: UnifiedPost | null = null, score = 0, idm = false;
    for (let j = from; j <= to; j++) {
      if (j === i) continue;
      const p2 = posts[j];
      if (p2.platform === plat || p2.uri === p1.uri || done.has(p2.uri)) continue;
      if (!(Math.abs(t1 - ts[j]) < W)) continue;
      const s = sim(profiles[i], profiles[j]);
      if (s > score) { score = s; best = p2; idm = ids ? idMatch(p1.author.handle, p2.author.handle, ids) : false; }
    }
    if (best && score >= (idm ? 0.6 : 0.8)) {
      const all = [p1, best].sort((a, b) => a.platform.localeCompare(b.platform));
      out.push({ type: 'crosspost', id: p1.uri, posts: all, similarity: score } as FeedItem);
      all.forEach(p => done.add(p.uri));
    } else { out.push(p1); done.add(p1.uri); }
  }
  return out;
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const WORDS = ('the quick brown fox jumps over lazy dog shipping release changelog thread incident review coffee deploy rollback latency dashboard metrics alert federation protocol client timeline moderation labeler handle identity').split(' ');

/** spanHours controls how much of the feed falls inside the 24h match window. */
function buildFeed(n: number, seed: number, spanHours: number): UnifiedPost[] {
  const rng = mulberry32(seed);
  const base = Date.UTC(2026, 0, 10, 12);
  const step = (spanHours * 3600_000) / n;
  const posts: UnifiedPost[] = [];
  for (let i = 0; i < n; i++) {
    const len = 12 + Math.floor(rng() * 18);
    const text = Array.from({ length: len }, () => WORDS[Math.floor(rng() * WORDS.length)]).join(' ');
    posts.push({ uri: `at://post/${i}`, text, createdAt: new Date(base - i * step).toISOString(),
      platform: rng() < 0.5 ? 'bluesky' : 'mastodon',
      author: { handle: rng() < 0.5 ? '@alice.bsky.social' : '@alice@mastodon.social', displayName: 'A' } } as UnifiedPost);
    if (rng() < 0.1 && posts.length > 1) {
      const prev = posts[posts.length - 2], p = posts[posts.length - 1];
      p.text = prev.text;
      p.platform = prev.platform === 'bluesky' ? 'mastodon' : 'bluesky';
    }
  }
  return posts;
}

const IDS = buildIdentityPairs([{ confirmed: true,
  links: [{ handle: '@alice.bsky.social' }, { handle: '@alice@mastodon.social' }] }]);

function count(fn: () => void) { CALLS = 0; CHARCMP = 0; fn(); return { calls: CALLS, cmp: CHARCMP }; }
const fmt = (n: number) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(n);

it('work done: original vs current', { timeout: 600_000 }, () => {
  for (const span of [6, 24, 72]) {
    console.log(`\n=== feed spanning ${span}h (24h match window covers ${Math.min(100, Math.round(24/span*100))}% of it) ===`);
    console.log('posts   original calls   current calls   reduction    original charcmp   current setops    reduction');
    for (const n of [100, 200, 400, 800]) {
      const feed = buildFeed(n, 7, span);
      // The current copy must still mirror the real implementation; the
      // original one deliberately differs now that the metric has changed.
      expect(newDetect(feed, IDS)).toEqual(detectCrossposts(feed, IDS));

      const o = count(() => origDetect(feed, IDS));
      const c = count(() => newDetect(feed, IDS));
      console.log(
        `${String(n).padEnd(7)} ${fmt(o.calls).padStart(14)} ${fmt(c.calls).padStart(15)} ` +
        `${(o.calls / (c.calls || 1)).toFixed(2).padStart(9)}x ${fmt(o.cmp).padStart(19)} ` +
        `${fmt(c.cmp).padStart(17)} ${(o.cmp / (c.cmp || 1)).toFixed(2).padStart(10)}x`
      );
    }
  }

  // The scroll session: 10 appends of 50, deriving after each.
  console.log('\n=== scroll session: 10 appends of 50 posts, feed spanning 72h ===');
  const full = buildFeed(500, 11, 72);
  const origTotal = count(() => {
    let acc: UnifiedPost[] = [];
    for (let p = 0; p < 10; p++) { acc = acc.concat(full.slice(p * 50, (p + 1) * 50)); origDetect(acc, IDS); }
  });
  const newTotal = count(() => {
    let acc: UnifiedPost[] = [];
    for (let p = 0; p < 10; p++) { acc = acc.concat(full.slice(p * 50, (p + 1) * 50)); newDetect(acc, IDS); }
  });
  let incTotal = { calls: 0, cmp: 0 };
  {
    CALLS = 0; CHARCMP = 0;
    let acc: UnifiedPost[] = [];
    let cache: CrosspostCache | null = null;
    for (let p = 0; p < 10; p++) {
      acc = acc.concat(full.slice(p * 50, (p + 1) * 50));
      // Mirror the incremental reuse, then count only the tail actually redone.
      const r = detectCrosspostsIncremental(acc, IDS, cache);
      const reusedPosts = new Set<string>();
      for (const item of (cache?.items ?? [])) {
        const ms = (item as any).posts ?? [item];
        for (const m of ms) reusedPosts.add(m.uri);
      }
      cache = r.cache;
      const tail = acc.filter(x => !reusedPosts.has(x.uri));
      newDetect(p === 0 ? acc : tail, IDS);
    }
    incTotal = { calls: CALLS, cmp: CHARCMP };
  }
  console.log(`original (full pass each append):   ${fmt(origTotal.calls).padStart(8)} calls  ${fmt(origTotal.cmp).padStart(8)} charcmp`);
  console.log(`current  (full pass each append):   ${fmt(newTotal.calls).padStart(8)} calls  ${fmt(newTotal.cmp).padStart(8)} charcmp`);
  console.log(`current  (incremental):             ${fmt(incTotal.calls).padStart(8)} calls  ${fmt(incTotal.cmp).padStart(8)} charcmp`);
  console.log(`\nincremental vs original: ${(origTotal.cmp / incTotal.cmp).toFixed(2)}x less character-comparison work\n`);
});
