/**
 * searchArchive now drives IndexedDB indexes instead of reading the whole store
 * and filtering in JS. These tests run against a real IndexedDB implementation
 * and assert two things:
 *
 *   1. the results are identical to the previous full-scan implementation, for
 *      randomized archives including duplicate and non-ISO timestamps;
 *   2. it actually reads fewer records — counted, not assumed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { archivePosts, searchArchive, clearArchive, type ArchivedPost, type ArchiveType } from './archive';
import type { UnifiedPost, Platform } from './types';

function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The previous implementation, verbatim, as the oracle. */
function refSearch(all: ArchivedPost[], params: any): ArchivedPost[] {
  let results = all;
  if (params.platform) results = results.filter(p => p.platform === params.platform);
  if (params.type) results = results.filter(p => p.type === params.type);
  if (params.author) {
    const a = params.author.toLowerCase();
    results = results.filter(p => p.authorHandle.toLowerCase().includes(a) || p.authorName.toLowerCase().includes(a));
  }
  if (params.dateFrom) results = results.filter(p => p.createdAt >= params.dateFrom);
  if (params.dateTo) results = results.filter(p => p.createdAt <= params.dateTo);
  if (params.hasMedia) results = results.filter(p => p.hasMedia);
  if (params.query) {
    const q = params.query.toLowerCase();
    results = results.filter(p => p.text.toLowerCase().includes(q) || p.authorHandle.toLowerCase().includes(q));
  }
  results = [...results].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return params.limit ? results.slice(0, params.limit) : results;
}

const TYPES: ArchiveType[] = ['post', 'like', 'repost', 'reply'];
const PLATFORMS: Platform[] = ['bluesky', 'mastodon'];
const WORDS = 'alpha beta gamma delta epsilon zeta eta theta coffee deploy release'.split(' ');

function makePosts(n: number, seed: number, opts: { dupTimes?: boolean; oddDates?: boolean } = {}) {
  const rng = mulberry32(seed);
  const base = Date.UTC(2026, 0, 10, 12);
  const out: { post: UnifiedPost; type: ArchiveType }[] = [];
  for (let i = 0; i < n; i++) {
    const t = TYPES[Math.floor(rng() * TYPES.length)];
    // Duplicate timestamps exercise the tie-break; odd dates exercise the
    // assumption that index order agrees with the comparator.
    let createdAt: string;
    if (opts.dupTimes && rng() < 0.4) createdAt = new Date(base - 1000 * 60).toISOString();
    else if (opts.oddDates && rng() < 0.15) createdAt = ['', '2026', 'not-a-date', '2026-1-5'][Math.floor(rng() * 4)];
    else createdAt = new Date(base - Math.floor(rng() * 100000) * 1000).toISOString();
    out.push({
      type: t,
      post: {
        uri: `at://a/${seed}/${String(i).padStart(4, '0')}`,
        text: Array.from({ length: 3 + Math.floor(rng() * 6) }, () => WORDS[Math.floor(rng() * WORDS.length)]).join(' '),
        createdAt,
        platform: PLATFORMS[Math.floor(rng() * PLATFORMS.length)],
        author: { handle: `@u${Math.floor(rng() * 8)}.bsky.social`, displayName: `User ${Math.floor(rng() * 8)}` },
        embeds: rng() < 0.3 ? [{}] : undefined,
        likeCount: 0, repostCount: 0, replyCount: 0,
      } as UnifiedPost,
    });
  }
  return out;
}

/**
 * Read the store directly, bypassing searchArchive, so the oracle runs over
 * exactly the rows that were stored (re-deriving them would give each record a
 * fresh indexedAt).
 */
function readAllRaw(): Promise<ArchivedPost[]> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('crispdeck-archive');
    req.onsuccess = () => {
      const db = req.result;
      const g = db.transaction('posts', 'readonly').objectStore('posts').getAll();
      g.onsuccess = () => { resolve(g.result); db.close(); };
      g.onerror = () => { reject(g.error); db.close(); };
    };
    req.onerror = () => reject(req.error);
  });
}

async function seedArchive(items: { post: UnifiedPost; type: ArchiveType }[]) {
  const byType = new Map<ArchiveType, UnifiedPost[]>();
  for (const { post, type } of items) {
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(post);
  }
  for (const [type, posts] of byType) await archivePosts(posts, type);
  return readAllRaw();
}

/**
 * Empty the store between cases. Deleting the database instead would block on
 * the cached connection, which is exactly the leak the connection cache fixed.
 */
async function resetDB() {
  await clearArchive();
}

const QUERIES: any[] = [
  { type: 'like', limit: 50 },
  { type: 'repost', limit: 50 },
  { type: 'reply', limit: 500 },
  { type: 'post' },
  { platform: 'bluesky', limit: 20 },
  { platform: 'mastodon' },
  { type: 'like', platform: 'bluesky', limit: 10 },
  { type: 'like', query: 'coffee', limit: 25 },
  { author: 'u3', limit: 15 },
  { hasMedia: true, limit: 30 },
  { type: 'post', hasMedia: true, query: 'alpha', limit: 5 },
  { dateFrom: '2026-01-09T00:00:00.000Z', limit: 40 },
  { dateTo: '2026-01-10T00:00:00.000Z', type: 'like', limit: 40 },
  { limit: 100 },
  {},
  { type: 'like', limit: 1 },
  { type: 'like', limit: 0 },
  { query: 'nothingmatchesthis', limit: 10 },
];

describe('searchArchive matches the previous full-scan implementation', () => {
  for (const opts of [{}, { dupTimes: true }, { oddDates: true }, { dupTimes: true, oddDates: true }]) {
    const label = Object.keys(opts).length ? Object.keys(opts).join('+') : 'plain';
    it(`archive shape: ${label}`, { timeout: 120_000 }, async () => {
      await resetDB();
      const all = await seedArchive(makePosts(400, 3, opts));
      for (const q of QUERIES) {
        const actual = await searchArchive(q);
        expect(actual, `${label} / ${JSON.stringify(q)}`).toEqual(refSearch(all, q));
      }
    });
  }

  it('is correct across many random archives', { timeout: 180_000 }, async () => {
    for (let seed = 10; seed < 20; seed++) {
      await resetDB();
      const all = await seedArchive(makePosts(120, seed, { dupTimes: true }));
      for (const q of QUERIES) {
        expect(await searchArchive(q), `seed ${seed} / ${JSON.stringify(q)}`).toEqual(refSearch(all, q));
      }
    }
  });

  it('handles an empty archive', async () => {
    await resetDB();
    await seedArchive([]);
    expect(await searchArchive({ type: 'like', limit: 500 })).toEqual([]);
    expect(await searchArchive({})).toEqual([]);
  });
});

describe('searchArchive read volume', () => {
  it('reads far fewer records than the store holds', { timeout: 180_000 }, async () => {
    await resetDB();
    // 1500 records; the feed asks for 500 likes.
    await seedArchive(makePosts(1500, 77));

    // Count records materialised by the IDB layer.
    let read = 0;
    const origGetAll = IDBIndex.prototype.getAll;
    const origOpenCursor = IDBIndex.prototype.openCursor;
    const origStoreGetAll = IDBObjectStore.prototype.getAll;
    const count = (n: number) => { read += n; };

    IDBObjectStore.prototype.getAll = function (...a: any[]) {
      const req = origStoreGetAll.apply(this, a as any);
      req.addEventListener('success', () => count((req.result as any[]).length));
      return req;
    };
    IDBIndex.prototype.getAll = function (...a: any[]) {
      const req = origGetAll.apply(this, a as any);
      req.addEventListener('success', () => count((req.result as any[]).length));
      return req;
    };
    IDBIndex.prototype.openCursor = function (...a: any[]) {
      const req = origOpenCursor.apply(this, a as any);
      req.addEventListener('success', () => { if (req.result) count(1); });
      return req;
    };

    try {
      read = 0;
      await searchArchive({});           // the old behaviour: whole store
      const wholeStore = read;

      // Cost should track the limit, not the size of the archive.
      const byLimit: Record<number, number> = {};
      for (const limit of [10, 50, 200]) {
        read = 0;
        const rows = await searchArchive({ type: 'like', limit });
        byLimit[limit] = read;
        expect(rows).toHaveLength(limit);
      }

      console.log(`  store=${wholeStore} records`);
      for (const limit of [10, 50, 200]) {
        console.log(`  {type:'like',limit:${String(limit).padStart(3)}} read ${String(byLimit[limit]).padStart(4)} ` +
                    `(old implementation would read ${wholeStore})`);
      }

      expect(wholeStore).toBeGreaterThan(1400);
      // A small limit must not pay for the whole archive.
      expect(byLimit[10]).toBeLessThan(60);
      expect(byLimit[50]).toBeLessThan(250);
      // And cost must grow with the limit, not stay pinned at the store size.
      expect(byLimit[200]).toBeLessThan(wholeStore / 2);
      expect(byLimit[10]).toBeLessThan(byLimit[200]);
    } finally {
      IDBObjectStore.prototype.getAll = origStoreGetAll;
      IDBIndex.prototype.getAll = origGetAll;
      IDBIndex.prototype.openCursor = origOpenCursor;
    }
  });
});
