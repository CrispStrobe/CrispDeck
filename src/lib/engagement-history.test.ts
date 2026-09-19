/**
 * Engagement snapshot history.
 *
 * This previously declared its own EngagementSnapshot interface, shadowing the
 * exported one, and reimplemented the grouping and retention rules over local
 * arrays — so it could not fail when the module changed. It now runs against a
 * real IndexedDB.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  recordSnapshot, recordSnapshots, getPostHistory, getLatestSnapshots, cleanupSnapshots,
  type EngagementSnapshot,
} from './engagement-history';

/**
 * Empty the store between tests.
 *
 * Deleting the database instead would block: the module caches its connection
 * and never closes it, so deleteDatabase fires onblocked and the database
 * survives. Creating it here by hand is no good either — it would be made
 * without the module's indexes, and the module's own upgrade would then never
 * run. So let the module create it, and only clear the rows.
 */
async function resetDB() {
  await getLatestSnapshots(1); // forces the module to open/create with its schema
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('crispdeck-engagement');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const txn = db.transaction('snapshots', 'readwrite');
    txn.objectStore('snapshots').clear();
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error);
  });
  db.close();
}

beforeEach(resetDB);
afterEach(() => vi.useRealTimers());

const post = (uri: string, o: Partial<{ likeCount: number; repostCount: number; replyCount: number }> = {}) =>
  ({ uri, platform: 'bluesky', ...o });

describe('recordSnapshot', () => {
  it('stores the counts it was given', async () => {
    await recordSnapshot(post('at://a/1', { likeCount: 10, repostCount: 3, replyCount: 2 }));
    const [snap] = await getPostHistory('at://a/1');
    expect(snap).toMatchObject({
      uri: 'at://a/1', platform: 'bluesky', likes: 10, reposts: 3, replies: 2,
    });
    expect(snap.timestamp).toBeTruthy();
  });

  it('defaults missing counts to 0', async () => {
    await recordSnapshot(post('at://a/2'));
    const [snap] = await getPostHistory('at://a/2');
    expect(snap).toMatchObject({ likes: 0, reposts: 0, replies: 0 });
  });

  it('keeps every snapshot, so a post accrues history', async () => {
    await recordSnapshot(post('at://a/3', { likeCount: 1 }));
    await recordSnapshot(post('at://a/3', { likeCount: 5 }));
    expect(await getPostHistory('at://a/3')).toHaveLength(2);
  });
});

describe('recordSnapshots', () => {
  it('records a batch in one go', async () => {
    await recordSnapshots([
      post('at://b/1', { likeCount: 1 }),
      post('at://b/2', { likeCount: 2 }),
    ]);
    expect(await getPostHistory('at://b/1')).toHaveLength(1);
    expect(await getPostHistory('at://b/2')).toHaveLength(1);
  });

  it('accepts an empty batch', async () => {
    await expect(recordSnapshots([])).resolves.not.toThrow();
  });
});

describe('getPostHistory', () => {
  it('returns only that post’s snapshots', async () => {
    await recordSnapshots([post('at://c/1'), post('at://c/2')]);
    const history = await getPostHistory('at://c/1');
    expect(history).toHaveLength(1);
    expect(history[0].uri).toBe('at://c/1');
  });

  it('is empty for a post with no history', async () => {
    expect(await getPostHistory('at://nothing/here')).toEqual([]);
  });
});

describe('getLatestSnapshots', () => {
  it('keeps the most recent snapshot per post', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); // only Date: IndexedDB needs real scheduling
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    await recordSnapshot(post('at://d/1', { likeCount: 1 }));
    vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));
    await recordSnapshot(post('at://d/1', { likeCount: 9 }));
    vi.useRealTimers();

    const latest = await getLatestSnapshots();
    const forPost = latest.filter(s => s.uri === 'at://d/1');
    expect(forPost).toHaveLength(1);
    expect(forPost[0].likes).toBe(9);
  });

  it('sorts newest first', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); // only Date: IndexedDB needs real scheduling
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    await recordSnapshot(post('at://e/1'));
    vi.setSystemTime(new Date('2026-01-03T00:00:00.000Z'));
    await recordSnapshot(post('at://e/2'));
    vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));
    await recordSnapshot(post('at://e/3'));
    vi.useRealTimers();

    expect((await getLatestSnapshots()).map(s => s.uri)).toEqual(['at://e/2', 'at://e/3', 'at://e/1']);
  });

  it('honours the limit', async () => {
    await recordSnapshots(Array.from({ length: 10 }, (_, i) => post(`at://f/${i}`)));
    expect(await getLatestSnapshots(4)).toHaveLength(4);
  });
});

describe('cleanupSnapshots', () => {
  it('keeps the newest N per post and deletes the rest', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); // only Date: IndexedDB needs real scheduling
    for (let i = 0; i < 8; i++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 0, 1 + i)));
      await recordSnapshot(post('at://g/1', { likeCount: i }));
    }
    vi.useRealTimers();

    const deleted = await cleanupSnapshots(3);
    expect(deleted).toBe(5);

    const remaining = await getPostHistory('at://g/1');
    expect(remaining).toHaveLength(3);
    // The survivors are the most recent, i.e. the highest like counts.
    expect(remaining.map(s => s.likes).sort((a, b) => a - b)).toEqual([5, 6, 7]);
  });

  it('deletes nothing when every post is under the limit', async () => {
    await recordSnapshots([post('at://h/1'), post('at://h/2')]);
    expect(await cleanupSnapshots(50)).toBe(0);
    expect(await getPostHistory('at://h/1')).toHaveLength(1);
  });

  it('counts each post separately', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); // only Date: IndexedDB needs real scheduling
    for (let i = 0; i < 4; i++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 0, 1 + i)));
      await recordSnapshot(post('at://i/1'));
      await recordSnapshot(post('at://i/2'));
    }
    vi.useRealTimers();

    expect(await cleanupSnapshots(2)).toBe(4); // two over the limit, on each post
    expect(await getPostHistory('at://i/1')).toHaveLength(2);
    expect(await getPostHistory('at://i/2')).toHaveLength(2);
  });
});
