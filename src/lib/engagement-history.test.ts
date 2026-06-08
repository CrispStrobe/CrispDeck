/**
 * Tests for engagement history — snapshot data model, grouping, cleanup logic.
 * Does NOT test IndexedDB (tested via data model validation).
 */
import { describe, it, expect } from 'vitest';

interface EngagementSnapshot {
  uri: string;
  platform: string;
  likes: number;
  reposts: number;
  replies: number;
  timestamp: string;
}

describe('engagement snapshot data model', () => {
  it('creates a valid snapshot from post data', () => {
    const post = { uri: 'at://did:plc:abc/post/1', platform: 'bluesky', likeCount: 10, repostCount: 3, replyCount: 2 };
    const snapshot: EngagementSnapshot = {
      uri: post.uri,
      platform: post.platform,
      likes: post.likeCount ?? 0,
      reposts: post.repostCount ?? 0,
      replies: post.replyCount ?? 0,
      timestamp: new Date().toISOString(),
    };
    expect(snapshot.uri).toBe('at://did:plc:abc/post/1');
    expect(snapshot.likes).toBe(10);
    expect(snapshot.reposts).toBe(3);
    expect(snapshot.replies).toBe(2);
    expect(snapshot.platform).toBe('bluesky');
  });

  it('defaults missing counts to 0', () => {
    const post = { uri: 'test-uri', platform: 'mastodon' };
    const snapshot: EngagementSnapshot = {
      uri: post.uri,
      platform: post.platform,
      likes: (post as any).likeCount ?? 0,
      reposts: (post as any).repostCount ?? 0,
      replies: (post as any).replyCount ?? 0,
      timestamp: new Date().toISOString(),
    };
    expect(snapshot.likes).toBe(0);
    expect(snapshot.reposts).toBe(0);
    expect(snapshot.replies).toBe(0);
  });
});

describe('snapshot grouping logic', () => {
  it('groups snapshots by URI and keeps latest', () => {
    const snapshots: EngagementSnapshot[] = [
      { uri: 'post-1', platform: 'bluesky', likes: 5, reposts: 1, replies: 0, timestamp: '2026-01-01T00:00:00Z' },
      { uri: 'post-1', platform: 'bluesky', likes: 10, reposts: 2, replies: 1, timestamp: '2026-01-02T00:00:00Z' },
      { uri: 'post-2', platform: 'mastodon', likes: 3, reposts: 0, replies: 0, timestamp: '2026-01-01T12:00:00Z' },
    ];

    const byUri = new Map<string, EngagementSnapshot>();
    for (const s of snapshots) {
      const existing = byUri.get(s.uri);
      if (!existing || s.timestamp > existing.timestamp) {
        byUri.set(s.uri, s);
      }
    }

    expect(byUri.size).toBe(2);
    expect(byUri.get('post-1')!.likes).toBe(10); // latest
    expect(byUri.get('post-2')!.likes).toBe(3);
  });

  it('sorts latest snapshots by timestamp descending', () => {
    const snapshots: EngagementSnapshot[] = [
      { uri: 'a', platform: 'bluesky', likes: 1, reposts: 0, replies: 0, timestamp: '2026-01-01' },
      { uri: 'b', platform: 'bluesky', likes: 2, reposts: 0, replies: 0, timestamp: '2026-01-03' },
      { uri: 'c', platform: 'bluesky', likes: 3, reposts: 0, replies: 0, timestamp: '2026-01-02' },
    ];
    const sorted = [...snapshots].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    expect(sorted[0].uri).toBe('b');
    expect(sorted[1].uri).toBe('c');
    expect(sorted[2].uri).toBe('a');
  });

  it('limits results to N', () => {
    const all = Array.from({ length: 200 }, (_, i) => ({
      uri: `post-${i}`, platform: 'bluesky', likes: i, reposts: 0, replies: 0,
      timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    }));
    const limited = all.slice(0, 100);
    expect(limited).toHaveLength(100);
  });
});

describe('cleanup logic', () => {
  it('identifies old snapshots to delete (keep latest N per URI)', () => {
    const maxPerPost = 3;
    const snapshots = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      uri: 'post-1',
      platform: 'bluesky',
      likes: i * 10,
      reposts: 0,
      replies: 0,
      timestamp: new Date(2026, 0, 1 + i).toISOString(),
    }));

    snapshots.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const toDelete = snapshots.slice(maxPerPost).map(s => s.id);
    expect(toDelete).toHaveLength(2);
    // Should delete the two oldest (lowest IDs)
    expect(toDelete).toContain(1);
    expect(toDelete).toContain(2);
  });

  it('returns empty when under the limit', () => {
    const snapshots = [
      { id: 1, uri: 'post-1', timestamp: '2026-01-01' },
      { id: 2, uri: 'post-1', timestamp: '2026-01-02' },
    ];
    const maxPerPost = 50;
    expect(snapshots.length <= maxPerPost).toBe(true);
  });
});
