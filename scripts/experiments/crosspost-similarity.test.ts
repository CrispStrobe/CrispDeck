/**
 * EXPERIMENT: is Jaro-Winkler the right similarity for crosspost detection?
 *
 *   npx vitest run --config vitest.experiments.config.js scripts/experiments/crosspost-similarity.test.ts
 *
 * Jaro-Winkler is a character-level metric. Two unrelated English posts of
 * similar length score around 0.6-0.7, which is why the 0.7 threshold used for
 * identity-linked authors groups things it shouldn't. This compares it against
 * token-set metrics over word trigrams on three feed shapes, measuring
 * precision and recall against known ground truth.
 */
import { it } from 'vitest';

function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- candidate metrics ----------------------------------------------------

function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const len1 = s1.length, len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;
  const w = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
  const m1 = new Array(len1).fill(false), m2 = new Array(len2).fill(false);
  let matches = 0, trans = 0;
  for (let i = 0; i < len1; i++) {
    for (let j = Math.max(0, i - w); j < Math.min(i + w + 1, len2); j++) {
      if (m2[j] || s1[i] !== s2[j]) continue;
      m1[i] = true; m2[j] = true; matches++; break;
    }
  }
  if (!matches) return 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (s1[i] !== s2[k]) trans++;
    k++;
  }
  const jaro = (matches / len1 + matches / len2 + (matches - trans / 2) / matches) / 3;
  let p = 0;
  for (let i = 0; i < Math.min(4, len1, len2); i++) { if (s1[i] === s2[i]) p++; else break; }
  return jaro + p * 0.1 * (1 - jaro);
}

/** Normalize away the things crossposting changes: links, hashtags, case. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#@]\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shingles(text: string, n = 3): Set<string> {
  const words = normalize(text).split(' ').filter(Boolean);
  if (words.length < n) return new Set(words);
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let n = 0;
  for (const v of small) if (big.has(v)) n++;
  return n;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const i = intersectionSize(a, b);
  return i / (a.size + b.size - i);
}

/** Containment: tolerant of one side being truncated. */
function containment(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return a.size === b.size ? 1 : 0;
  return intersectionSize(a, b) / Math.min(a.size, b.size);
}

// ---- feed generators ------------------------------------------------------

const WORDS = ('the quick brown fox jumps over lazy dog shipping release changelog thread incident review coffee deploy rollback latency dashboard metrics alert federation protocol client timeline moderation labeler handle identity just landed finally works again after weeks debugging morning everyone update').split(' ');

interface Post { id: string; text: string }

function makeFeed(kind: 'independent' | 'boilerplate', n: number, seed: number) {
  const rng = mulberry32(seed);
  const BOILER = [
    'Good morning everyone here is the daily update for ',
    'New blog post is up read the whole thing here ',
    'Reminder our weekly community call starts in one hour ',
    'Thread 1/ I want to talk about something that has been ',
  ];
  const posts: Post[] = [];
  const truth = new Set<string>();
  for (let i = 0; i < n; i++) {
    const body = Array.from({ length: 10 + Math.floor(rng() * 22) },
      () => WORDS[Math.floor(rng() * WORDS.length)]).join(' ');
    const text = kind === 'boilerplate'
      ? BOILER[Math.floor(rng() * BOILER.length)] + body
      : body;
    posts.push({ id: `p${i}`, text });

    if (rng() < 0.15 && posts.length > 1) {
      const prev = posts[posts.length - 2];
      const v = rng();
      let t = prev.text;
      if (v < 0.45) { /* exact repost */ }
      else if (v < 0.7) t = prev.text.slice(0, Math.floor(prev.text.length * 0.6)) + '…';
      else if (v < 0.88) t = prev.text + ' https://example.com/a/b/c';
      else t = prev.text + ' #opensource #fediverse';
      posts[posts.length - 1] = { id: posts[posts.length - 1].id, text: t };
      truth.add([prev.id, posts[posts.length - 1].id].sort().join('|'));
    }
  }
  return { posts, truth };
}

// ---- evaluation -----------------------------------------------------------

type Scorer = (a: Post, b: Post) => number;

function evaluate(posts: Post[], truth: Set<string>, score: Scorer, threshold: number) {
  let tp = 0, fp = 0;
  const found = new Set<string>();
  // Same shape as detectCrossposts: best match per post, above threshold.
  const taken = new Set<string>();
  for (let i = 0; i < posts.length; i++) {
    if (taken.has(posts[i].id)) continue;
    let best = -1, bestScore = 0;
    for (let j = 0; j < posts.length; j++) {
      if (i === j || taken.has(posts[j].id)) continue;
      const s = score(posts[i], posts[j]);
      if (s > bestScore) { bestScore = s; best = j; }
    }
    if (best >= 0 && bestScore >= threshold) {
      const key = [posts[i].id, posts[best].id].sort().join('|');
      found.add(key);
      taken.add(posts[i].id); taken.add(posts[best].id);
      if (truth.has(key)) tp++; else fp++;
    } else taken.add(posts[i].id);
  }
  const fn = truth.size - tp;
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = truth.size === 0 ? 1 : tp / truth.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

const pct = (x: number) => (x * 100).toFixed(1).padStart(5) + '%';

it('similarity metric comparison', { timeout: 600_000 }, () => {
  const shingleCache = new Map<string, Set<string>>();
  const sh = (p: Post) => {
    let s = shingleCache.get(p.id);
    if (!s) { s = shingles(p.text); shingleCache.set(p.id, s); }
    return s;
  };

  const metrics: { name: string; score: Scorer; thresholds: number[] }[] = [
    { name: 'jaro-winkler (current)', score: (a, b) => jaroWinkler(a.text, b.text), thresholds: [0.7, 0.9] },
    { name: 'jaccard 3-gram',         score: (a, b) => jaccard(sh(a), sh(b)),       thresholds: [0.3, 0.5, 0.7] },
    { name: 'containment 3-gram',     score: (a, b) => containment(sh(a), sh(b)),   thresholds: [0.6, 0.8, 0.9] },
  ];

  for (const kind of ['independent', 'boilerplate'] as const) {
    console.log(`\n=== ${kind} feed (200 posts x 4 seeds, ~15% genuine crossposts) ===`);
    console.log('metric                  thr   precision  recall      F1');
    for (const m of metrics) {
      for (const thr of m.thresholds) {
        let P = 0, R = 0, F = 0, runs = 0;
        for (const seed of [1, 2, 3, 4]) {
          shingleCache.clear();
          const { posts, truth } = makeFeed(kind, 200, seed);
          const r = evaluate(posts, truth, m.score, thr);
          P += r.precision; R += r.recall; F += r.f1; runs++;
        }
        console.log(`${m.name.padEnd(23)} ${String(thr).padStart(4)}   ${pct(P/runs)}  ${pct(R/runs)}  ${pct(F/runs)}`);
      }
    }
  }
  console.log('');
});
