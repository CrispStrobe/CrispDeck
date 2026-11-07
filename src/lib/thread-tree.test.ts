import { describe, expect, it } from 'vitest';
import { threadRows } from './thread-tree';
import type { UnifiedPost } from './types';

function post(id: string, parent?: string, author = id): UnifiedPost {
  return { uri: `at://did:plc:${author}/app.bsky.feed.post/${id}`, platform: 'bluesky', author: { handle: author }, text: id, createdAt: '2026-01-01T00:00:00Z', isRepost: false, replyParentUri: parent };
}

describe('threadRows', () => {
  it('places each reply under its parent, including the selected post and author follow-ups', () => {
    const root = post('root', undefined, 'op');
    const parent = post('parent', root.uri, 'other');
    const selected = post('selected', parent.uri, 'third');
    const sibling = post('sibling', selected.uri, 'fourth');
    const followup = post('followup', selected.uri, 'third');
    const nested = post('nested', sibling.uri, 'op');
    expect(threadRows([root, parent], selected, [sibling, nested, followup]).map(r => [r.post.text, r.depth, r.selected])).toEqual([
      ['root', 0, false], ['parent', 1, false], ['selected', 2, true],
      ['followup', 3, false], ['sibling', 3, false], ['nested', 4, false],
    ]);
  });

  it('matches Mastodon local IDs and keeps posts with missing or cyclic parents visible', () => {
    const main = { ...post('root'), platform: 'mastodon' as const, uri: 'https://example/root', raw: { id: '1' } };
    const child = { ...post('child', '1'), platform: 'mastodon' as const, raw: { id: '2' } };
    const grandchild = { ...post('grandchild', '2'), platform: 'mastodon' as const, raw: { id: '3' } };
    const orphan = post('orphan', 'missing');
    const a = post('a'); const b = post('b', a.uri); a.replyParentUri = b.uri;
    const rows = threadRows([], main, [grandchild, child, orphan, a, b, child]);
    expect(rows.find(r => r.post === child)?.depth).toBe(1);
    expect(rows.find(r => r.post === grandchild)?.depth).toBe(2);
    expect(rows.find(r => r.post === orphan)?.depth).toBe(1);
    expect(rows).toHaveLength(6);
  });
});
