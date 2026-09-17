import { describe, it, expect } from 'vitest';
import { detectCrossposts } from './unified';
import { fingerprint, ShingleIndex } from './near-duplicate';
import type { UnifiedPost } from '$lib/types';

// Word pools large enough that posts differ in substance, not just an index.
// An earlier version varied only a number inside a fixed sentence, which made
// every fortieth post a genuine near-duplicate of another — the detector was
// right to group them, and the corpus was wrong.
const A = ['compiler', 'migration', 'renderer', 'scheduler', 'parser', 'cache',
  'linter', 'protocol', 'planner', 'allocator', 'tokenizer', 'debugger'];
const B = ['handles', 'broke', 'measures', 'distrusts', 'rewrites', 'documents',
  'rejects', 'batches', 'defers', 'validates', 'caches'];
const C = ['nested generics', 'the retry path', 'unicode widths', 'stale sessions',
  'the import graph', 'partial writes', 'the happy path', 'trailing commas',
  'weak references', 'signed overflow', 'locale collation', 'zero-width joiners',
  'daylight saving'];
const D = ['after a week of reading', 'which nobody asked for', 'and the tests agree',
  'though the docs disagree', 'on every platform but one', 'without a flag',
  'as of this morning', 'for the third time', 'in about forty lines',
  'behind a feature gate', 'with no measurable cost', 'at some cost to clarity',
  'once the cache warmed', 'against my better judgement', 'in the worst way',
  'only under load', 'and nowhere else'];
const E = ['Numbers in the thread.', 'Write-up pending.', 'Reproduced twice.',
  'Filed upstream.', 'Not a regression.', 'Happy to be wrong.',
  'Benchmark attached.', 'Took four attempts.', 'Comments open.',
  'Still unsure.', 'Rolling it back.', 'Shipping tomorrow.',
  'Ticket linked below.', 'Bisected to one commit.', 'Worth a second look.',
  'No idea yet.', 'Fixed in main.', 'Reverted for now.', 'Patch welcome.'];

/** A mixed-platform timeline of genuinely distinct posts. */
function feed(n: number, salt = ''): UnifiedPost[] {
  return Array.from({ length: n }, (_, i) => ({
    uri: `at://did:plc:p${salt}${i}/app.bsky.feed.post/${i}`,
    text: `The ${A[i % A.length]} ${B[(i * 5) % B.length]} ${C[(i * 7) % C.length]} ` +
          `${D[(i * 11) % D.length]}. ${E[(i * 13) % E.length]} ` +
          `Case ${salt}${i} if anyone wants the detail.`,
    author: { handle: `u${i}.example`, displayName: `U ${i}`, avatar: '', did: `did:plc:p${i}` },
    createdAt: new Date(Date.now() - i * 60_000).toISOString(),
    platform: i % 3 === 2 ? 'mastodon' : 'bluesky',
    isRepost: false,
  }) as UnifiedPost);
}

describe('detectCrossposts at feed scale', () => {
  it('stays well inside a frame budget for a large timeline', () => {
    // Comparing every Bluesky post against every Mastodon one with
    // Jaro-Winkler took about seven seconds here, and was 85% of the app's
    // CPU. The shingle index means unrelated posts never become candidates.
    const posts = feed(400);
    const t = performance.now();
    const items = detectCrossposts(posts);
    const ms = performance.now() - t;
    expect(items).toHaveLength(400);
    expect(ms, `took ${ms.toFixed(0)}ms`).toBeLessThan(250);
  });

  it('keeps the work per post bounded as the feed grows', () => {
    // The complexity guarantee, asserted directly rather than through
    // wall-clock. A ratio of two timings measures JIT warmth as much as it
    // measures growth — an earlier version of this test compared a warmed
    // 200-post run against a cold 800-post one and "found" quadratic growth
    // that was not there.
    //
    // What matters is that each post is scored against a bounded number of
    // candidates however long the feed is. Without the absolute ceiling on
    // bucket size this number grows with the corpus, and the quadratic term
    // comes back.
    const avgCandidates = (n: number) => {
      const fps = feed(n, `c${n}`).map((p) => fingerprint(p.text));
      const idx = new ShingleIndex(fps);
      let total = 0;
      for (const fp of fps) total += idx.candidates(fp).size;
      return total / n;
    };
    const at200 = avgCandidates(200);
    const at800 = avgCandidates(800);
    expect(at800, `200:${at200.toFixed(1)} 800:${at800.toFixed(1)}`).toBeLessThan(80);
    // Four times the posts must not mean four times the comparisons.
    expect(at800 / Math.max(at200, 1)).toBeLessThan(2.5);
  });

  it('stays inside budget at twice the size', () => {
    const posts = feed(800, 'big');
    const t = performance.now();
    detectCrossposts(posts);
    const ms = performance.now() - t;
    expect(ms, `took ${ms.toFixed(0)}ms`).toBeLessThan(400);
  });

  it('still finds a crosspost buried in a large timeline', () => {
    // Speed is worthless if it stops finding things.
    const posts = feed(400);
    const shared = 'Shipped the feed picker today, it reads your pinned feeds from preferences and lets you search for more.';
    posts[10] = { ...posts[10], text: shared, platform: 'bluesky' };
    posts[11] = { ...posts[11], text: shared + ' https://example.com/notes', platform: 'mastodon' };
    const items = detectCrossposts(posts);
    const groups = items.filter((i) => 'type' in i && i.type === 'crosspost');
    expect(groups).toHaveLength(1);
    expect(items).toHaveLength(399);
  });
});
