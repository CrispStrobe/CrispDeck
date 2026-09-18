/**
 * EXPERIMENT (not part of the test suite — vite.config.js only collects
 * src/**\/*.test.ts). Run with:
 *   npx vitest run --config vite.config.js scripts/experiments/crosspost-prefix-cap.test.ts
 *
 * Question: should detectCrossposts compare only the first N characters of a
 * post instead of the whole body? It would be roughly 3x faster.
 *
 * Answer: no. On feeds of independent posts a 64-char cap is free — identical
 * precision and recall. But on a feed where posts share a boilerplate opening
 * ("Good morning everyone! Here is the daily update for ...", "New blog post
 * is up — ...", thread starters), a 128-char cap drops precision from 66% to
 * 15%, and 64 chars to 9%: every post with the same opening is grouped as a
 * crosspost of every other. That pattern is common enough in real timelines
 * that the speedup isn't worth it, so detection stays on the full text.
 *
 * Kept here so the decision can be re-checked if the threshold or the
 * similarity metric ever change.
 */
import { it } from 'vitest';
import { detectCrossposts, buildIdentityPairs, isCrosspostGroup } from '../../src/lib/api/unified';
import type { UnifiedPost } from '../../src/lib/types';

function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const WORDS = ('the quick brown fox jumps over lazy dog shipping a new release today changelog in thread incident review coffee deploy rollback latency dashboard metrics alert federation protocol client timeline moderation labeler handle identity open source just landed finally works again after weeks of debugging').split(' ');

/**
 * Feed with realistic crosspost variants: exact copies, platform-truncated
 * copies, copies with a trailing link, and copies with hashtags appended.
 */
function buildFeed(n: number, seed: number) {
  const rng = mulberry32(seed);
  const base = Date.UTC(2026, 0, 10, 12);
  const posts: UnifiedPost[] = [];
  const truth = new Set<string>(); // "uriA|uriB" pairs that are real crossposts
  for (let i = 0; i < n; i++) {
    const len = 10 + Math.floor(rng() * 25);
    const text = Array.from({ length: len }, () => WORDS[Math.floor(rng() * WORDS.length)]).join(' ');
    const platform = rng() < 0.5 ? 'bluesky' : 'mastodon';
    const who = Math.floor(rng() * AUTHORS);
    posts.push({ uri: `at://p/${seed}/${i}`, text,
      createdAt: new Date(base - Math.floor(rng() * 36) * 3600_000 - i * 1000).toISOString(),
      platform,
      author: { handle: handleFor(who, platform), displayName: `u${who}` } } as UnifiedPost);
    if (rng() < 0.15 && posts.length > 1) {
      const prev = posts[posts.length - 2];
      const variant = rng();
      let t = prev.text;
      if (variant < 0.45) { /* exact copy */ }
      else if (variant < 0.7) t = prev.text.slice(0, 280) + '…';
      else if (variant < 0.88) t = prev.text + ' https://example.com/a/b/c';
      else t = prev.text + ' #opensource #fediverse';
      const p = posts[posts.length - 1];
      p.text = t;
      p.platform = prev.platform === 'bluesky' ? 'mastodon' : 'bluesky';
      // A crosspost is the same person on the other platform.
      const who = authorIndexOf(prev.author.handle);
      p.author = { handle: handleFor(who, p.platform), displayName: `u${who}` } as any;
      p.createdAt = new Date(new Date(prev.createdAt).getTime() - 120_000).toISOString();
      truth.add([prev.uri, p.uri].sort().join('|'));
    }
  }
  posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { posts, truth };
}

/**
 * 40 authors. Each exists on both platforms; the first 6 are confirmed in the
 * identity map (so their posts get the 0.7 threshold), the rest are not.
 */
const AUTHORS = 40;
const LINKED = 6;
const handleFor = (i: number, platform: string) =>
  platform === 'bluesky' ? `@u${i}.bsky.social` : `@u${i}@mastodon.social`;
const authorIndexOf = (handle: string) => parseInt(handle.replace(/^@u/, ''), 10);

const IDS = buildIdentityPairs(
  Array.from({ length: LINKED }, (_, i) => ({
    confirmed: true,
    links: [{ handle: handleFor(i, 'bluesky') }, { handle: handleFor(i, 'mastodon') }],
  }))
);

function groupsOf(posts: UnifiedPost[], cap: number | null) {
  // Capping is done up front so the timer measures detection only.
  const input = cap === null ? posts : posts.map(p => ({ ...p, text: p.text.slice(0, cap) }));
  const t0 = performance.now();
  const items = detectCrossposts(input as UnifiedPost[], IDS);
  const ms = performance.now() - t0;
  const pairs = new Set<string>();
  for (const it of items) {
    if (isCrosspostGroup(it)) pairs.add(it.posts.map(p => p.uri).sort().join('|'));
  }
  return { pairs, ms };
}

it('prefix cap trade-off', { timeout: 300_000 }, () => {
  const caps: (number | null)[] = [null, 192, 128, 96, 64, 48];
  const rows: any[] = [];
  const SEEDS = [1, 2, 3, 4, 5];
  const N = 250;

  const baselineByCap = new Map<string, { agree: number; extra: number; missing: number; ms: number; tp: number; fp: number; fn: number }>();
  for (const cap of caps) baselineByCap.set(String(cap), { agree: 0, extra: 0, missing: 0, ms: 0, tp: 0, fp: 0, fn: 0 });

  for (const seed of SEEDS) {
    const { posts, truth } = buildFeed(N, seed);
    const full = groupsOf(posts, null);
    for (const cap of caps) {
      const r = cap === null ? full : groupsOf(posts, cap);
      const acc = baselineByCap.get(String(cap))!;
      acc.ms += r.ms;
      for (const p of r.pairs) {
        if (full.pairs.has(p)) acc.agree++; else acc.extra++;
        if (truth.has(p)) acc.tp++; else acc.fp++;
      }
      for (const p of full.pairs) if (!r.pairs.has(p)) acc.missing++;
      for (const p of truth) if (!r.pairs.has(p)) acc.fn++;
    }
  }

  console.log(`\n${N} posts x ${SEEDS.length} seeds, ${AUTHORS} authors (${LINKED} identity-linked), ~15% genuine crossposts\n`);
  console.log('cap      ms    vs-full-text        vs-ground-truth');
  console.log('                agree  extra  miss   precision  recall');
  for (const cap of caps) {
    const a = baselineByCap.get(String(cap))!;
    const prec = a.tp + a.fp === 0 ? 1 : a.tp / (a.tp + a.fp);
    const rec = a.tp + a.fn === 0 ? 1 : a.tp / (a.tp + a.fn);
    console.log(
      `${(cap === null ? 'full' : String(cap)).padEnd(6)} ${a.ms.toFixed(0).padStart(5)}` +
      `   ${String(a.agree).padStart(5)}  ${String(a.extra).padStart(5)}  ${String(a.missing).padStart(4)}` +
      `      ${(prec * 100).toFixed(1).padStart(5)}%  ${(rec * 100).toFixed(1).padStart(5)}%`
    );
  }
  console.log('');
});

/**
 * The failure mode a prefix cap would actually introduce: distinct posts that
 * open with the same boilerplate. Capping makes them look identical.
 */
it('prefix cap vs shared boilerplate openings', { timeout: 300_000 }, () => {
  const BOILER = [
    'Good morning everyone! Here is the daily update for ',
    'New blog post is up — read the whole thing here: ',
    'Reminder: our weekly community call starts in one hour. ',
    'Thread 1/ I want to talk about something that has been ',
  ];
  const rng = mulberry32(42);
  const base = Date.UTC(2026, 0, 10, 12);
  const posts: UnifiedPost[] = [];
  const truth = new Set<string>();
  const N = 200;
  for (let i = 0; i < N; i++) {
    const boiler = BOILER[Math.floor(rng() * BOILER.length)];
    const tail = Array.from({ length: 10 + Math.floor(rng() * 20) },
      () => WORDS[Math.floor(rng() * WORDS.length)]).join(' ');
    const platform = rng() < 0.5 ? 'bluesky' : 'mastodon';
    const who = Math.floor(rng() * AUTHORS);
    posts.push({ uri: `at://b/${i}`, text: boiler + tail,
      createdAt: new Date(base - Math.floor(rng() * 20) * 3600_000 - i * 1000).toISOString(),
      platform, author: { handle: handleFor(who, platform), displayName: `u${who}` } } as UnifiedPost);
    if (rng() < 0.15 && posts.length > 1) {
      const prev = posts[posts.length - 2];
      const p = posts[posts.length - 1];
      p.text = prev.text;
      p.platform = prev.platform === 'bluesky' ? 'mastodon' : 'bluesky';
      const w = authorIndexOf(prev.author.handle);
      p.author = { handle: handleFor(w, p.platform), displayName: `u${w}` } as any;
      p.createdAt = new Date(new Date(prev.createdAt).getTime() - 120_000).toISOString();
      truth.add([prev.uri, p.uri].sort().join('|'));
    }
  }
  posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  console.log(`\nshared-boilerplate feed: ${N} posts, ${BOILER.length} openings of 48-56 chars, ${truth.size} true crossposts\n`);
  console.log('cap      ms   groups   true-pos  false-pos   precision  recall');
  for (const cap of [null, 192, 128, 96, 64, 48] as (number | null)[]) {
    const r = groupsOf(posts, cap);
    let tp = 0, fp = 0;
    for (const p of r.pairs) (truth.has(p) ? tp++ : fp++);
    const fn = truth.size - tp;
    const prec = tp + fp === 0 ? 1 : tp / (tp + fp);
    const rec = truth.size === 0 ? 1 : tp / truth.size;
    console.log(
      `${(cap === null ? 'full' : String(cap)).padEnd(6)} ${r.ms.toFixed(0).padStart(5)}` +
      `   ${String(r.pairs.size).padStart(5)}    ${String(tp).padStart(6)}   ${String(fp).padStart(8)}` +
      `      ${(prec * 100).toFixed(1).padStart(5)}%  ${(rec * 100).toFixed(1).padStart(5)}%`
    );
  }
  console.log('');
});
