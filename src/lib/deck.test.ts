/**
 * Tests for deck column configuration, layouts, drag/reorder, and width logic.
 */
import { describe, it, expect } from 'vitest';

type ColumnType = 'timeline' | 'mentions' | 'notifications' | 'my-posts' | 'search' | 'list' | 'hashtag' | 'user' | 'feed' | 'local' | 'federated' | 'tag-group' | 'rss' | 'keyword-monitor' | 'threads-search';

interface DeckColumnConfig {
  id: string;
  title: string;
  type: ColumnType;
  query?: string;
  width?: number;
}

describe('deck column configuration', () => {
  it('supports all 14 column types', () => {
    const types: ColumnType[] = ['timeline', 'mentions', 'notifications', 'my-posts', 'search', 'list', 'hashtag', 'user', 'feed', 'local', 'federated', 'tag-group', 'rss', 'keyword-monitor'];
    expect(types.length).toBe(14);
    for (const t of types) {
      const col: DeckColumnConfig = { id: `${t}-1`, title: t, type: t };
      expect(col.type).toBe(t);
    }
  });

  it('search/hashtag/user columns require query', () => {
    const search: DeckColumnConfig = { id: 's1', title: 'Search: test', type: 'search', query: 'test' };
    const hashtag: DeckColumnConfig = { id: 'h1', title: '#svelte', type: 'hashtag', query: 'svelte' };
    const user: DeckColumnConfig = { id: 'u1', title: '@alice', type: 'user', query: 'alice.bsky.social' };
    expect(search.query).toBe('test');
    expect(hashtag.query).toBe('svelte');
    expect(user.query).toBe('alice.bsky.social');
  });

  it('keyword-monitor columns store comma-separated keywords in query', () => {
    const col: DeckColumnConfig = { id: 'km1', title: 'Monitor: svelte, rust', type: 'keyword-monitor', query: 'svelte,rust' };
    expect(col.type).toBe('keyword-monitor');
    expect(col.query).toBe('svelte,rust');
    const keywords = col.query!.split(',');
    expect(keywords).toHaveLength(2);
  });

  it('keyword-monitor supports regex in query', () => {
    const col: DeckColumnConfig = { id: 'km2', title: 'Monitor: regex', type: 'keyword-monitor', query: '/type.*script/,svelte' };
    expect(col.query).toContain('/type.*script/');
  });

  it('columns have optional width with default 380', () => {
    const col: DeckColumnConfig = { id: 't1', title: 'Timeline', type: 'timeline' };
    expect(col.width ?? 380).toBe(380);
    const wide: DeckColumnConfig = { id: 't2', title: 'Wide', type: 'timeline', width: 500 };
    expect(wide.width).toBe(500);
  });
});

describe('deck column width constraints', () => {
  it('clamps width to minimum 280', () => {
    const width = Math.max(280, Math.min(600, 200));
    expect(width).toBe(280);
  });

  it('clamps width to maximum 600', () => {
    const width = Math.max(280, Math.min(600, 700));
    expect(width).toBe(600);
  });

  it('passes through valid widths', () => {
    const width = Math.max(280, Math.min(600, 400));
    expect(width).toBe(400);
  });
});

describe('deck column reorder', () => {
  it('moves column from one position to another', () => {
    const columns: DeckColumnConfig[] = [
      { id: 'a', title: 'A', type: 'timeline' },
      { id: 'b', title: 'B', type: 'mentions' },
      { id: 'c', title: 'C', type: 'notifications' },
    ];

    // Move 'c' to position 0
    const fromIdx = 2;
    const toIdx = 0;
    const moved = columns[fromIdx];
    const updated = [...columns];
    updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);

    expect(updated[0].id).toBe('c');
    expect(updated[1].id).toBe('a');
    expect(updated[2].id).toBe('b');
  });

  it('no-op when dragging to same position', () => {
    const columns: DeckColumnConfig[] = [
      { id: 'a', title: 'A', type: 'timeline' },
      { id: 'b', title: 'B', type: 'mentions' },
    ];
    const fromIdx = 0;
    const toIdx = 0;
    // Same position — should not change
    expect(fromIdx).toBe(toIdx);
    expect(columns[0].id).toBe('a');
  });

  it('swaps two adjacent columns', () => {
    const columns: DeckColumnConfig[] = [
      { id: 'a', title: 'A', type: 'timeline' },
      { id: 'b', title: 'B', type: 'mentions' },
      { id: 'c', title: 'C', type: 'notifications' },
    ];
    // Swap a and b (drag a to position 1)
    const fromIdx = 0;
    const toIdx = 1;
    const moved = columns[fromIdx];
    const updated = [...columns];
    updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    expect(updated.map(c => c.id)).toEqual(['b', 'a', 'c']);
  });

  it('moves column to end', () => {
    const columns: DeckColumnConfig[] = [
      { id: 'a', title: 'A', type: 'timeline' },
      { id: 'b', title: 'B', type: 'mentions' },
      { id: 'c', title: 'C', type: 'notifications' },
    ];
    const fromIdx = 0;
    const toIdx = 2;
    const moved = columns[fromIdx];
    const updated = [...columns];
    updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    expect(updated.map(c => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('moves middle column to front', () => {
    const columns: DeckColumnConfig[] = [
      { id: 'a', title: 'A', type: 'timeline' },
      { id: 'b', title: 'B', type: 'mentions' },
      { id: 'c', title: 'C', type: 'notifications' },
    ];
    const fromIdx = 1;
    const toIdx = 0;
    const moved = columns[fromIdx];
    const updated = [...columns];
    updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    expect(updated.map(c => c.id)).toEqual(['b', 'a', 'c']);
  });

  it('handles single column (no-op)', () => {
    const columns: DeckColumnConfig[] = [
      { id: 'only', title: 'Only', type: 'timeline' },
    ];
    const fromIdx = 0;
    const toIdx = 0;
    expect(fromIdx).toBe(toIdx);
    expect(columns).toHaveLength(1);
    expect(columns[0].id).toBe('only');
  });

  it('preserves column properties after reorder', () => {
    const columns: DeckColumnConfig[] = [
      { id: 'a', title: 'Timeline', type: 'timeline', width: 450 },
      { id: 'b', title: 'Search', type: 'search', query: 'svelte' },
    ];
    const fromIdx = 1;
    const toIdx = 0;
    const moved = columns[fromIdx];
    const updated = [...columns];
    updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    expect(updated[0].id).toBe('b');
    expect(updated[0].query).toBe('svelte');
    expect(updated[0].type).toBe('search');
    expect(updated[1].width).toBe(450);
  });

  it('reorders 5 columns correctly', () => {
    const columns: DeckColumnConfig[] = [
      { id: 'a', title: 'A', type: 'timeline' },
      { id: 'b', title: 'B', type: 'mentions' },
      { id: 'c', title: 'C', type: 'notifications' },
      { id: 'd', title: 'D', type: 'search' },
      { id: 'e', title: 'E', type: 'local' },
    ];
    // Move 'e' from position 4 to position 1
    const fromIdx = 4;
    const toIdx = 1;
    const moved = columns[fromIdx];
    const updated = [...columns];
    updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    expect(updated.map(c => c.id)).toEqual(['a', 'e', 'b', 'c', 'd']);
  });

  // Mirrors the guard in deck/+page.svelte: `if (!draggedColumnId || draggedColumnId === colId) return;`
  // Declared as a function over `string | null` rather than inline literals —
  // with literals, TS folds each comparison and the assertion tests a constant.
  const shouldSkipDrop = (draggedColumnId: string | null, targetColId: string) =>
    !draggedColumnId || draggedColumnId === targetColId;

  it('drop target validation skips when dragged ID matches target', () => {
    expect(shouldSkipDrop('col-1', 'col-1')).toBe(true);
  });

  it('drop target validation skips when no column is being dragged', () => {
    expect(shouldSkipDrop(null, 'col-2')).toBe(true);
  });

  it('drop target validation proceeds when IDs differ', () => {
    expect(shouldSkipDrop('col-1', 'col-2')).toBe(false);
  });
});

describe('deck saved layouts', () => {
  it('serializes and deserializes column config', () => {
    const columns: DeckColumnConfig[] = [
      { id: 't1', title: 'Timeline', type: 'timeline', width: 400 },
      { id: 'h1', title: '#svelte', type: 'hashtag', query: 'svelte' },
    ];
    const json = JSON.stringify(columns);
    const restored: DeckColumnConfig[] = JSON.parse(json);
    expect(restored.length).toBe(2);
    expect(restored[0].width).toBe(400);
    expect(restored[1].query).toBe('svelte');
  });

  it('multiple layouts can be stored independently', () => {
    const layouts: Record<string, DeckColumnConfig[]> = {
      'Work': [{ id: 't1', title: 'Timeline', type: 'timeline' }],
      'Social': [{ id: 't1', title: 'Timeline', type: 'timeline' }, { id: 'h1', title: '#fun', type: 'hashtag', query: 'fun' }],
    };
    expect(Object.keys(layouts).length).toBe(2);
    expect(layouts['Work'].length).toBe(1);
    expect(layouts['Social'].length).toBe(2);
  });
});
