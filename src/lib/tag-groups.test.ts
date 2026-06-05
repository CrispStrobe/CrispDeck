import { describe, it, expect, beforeEach } from 'vitest';
import { listTagGroups, saveTagGroup, updateTagGroup, deleteTagGroup } from './tag-groups';

const store: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
  },
});

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

describe('tag-groups', () => {
  it('returns empty array when no groups saved', () => {
    expect(listTagGroups()).toEqual([]);
  });

  it('saves and lists a tag group', () => {
    const group = saveTagGroup({ name: 'Tech', tags: ['javascript', 'typescript', 'svelte'] });
    expect(group.id).toBeTruthy();
    expect(group.name).toBe('Tech');
    expect(group.tags).toEqual(['javascript', 'typescript', 'svelte']);

    const groups = listTagGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Tech');
  });

  it('saves multiple groups', () => {
    saveTagGroup({ name: 'Tech', tags: ['js'] });
    saveTagGroup({ name: 'News', tags: ['news', 'politics'] });
    expect(listTagGroups()).toHaveLength(2);
  });

  it('updates a tag group', () => {
    const group = saveTagGroup({ name: 'Tech', tags: ['js'] });
    updateTagGroup(group.id, { tags: ['js', 'ts', 'rust'] });
    const updated = listTagGroups().find(g => g.id === group.id);
    expect(updated?.tags).toEqual(['js', 'ts', 'rust']);
    expect(updated?.name).toBe('Tech');
  });

  it('updates name only', () => {
    const group = saveTagGroup({ name: 'Old', tags: ['a'] });
    updateTagGroup(group.id, { name: 'New' });
    expect(listTagGroups()[0].name).toBe('New');
    expect(listTagGroups()[0].tags).toEqual(['a']);
  });

  it('deletes a tag group', () => {
    const g1 = saveTagGroup({ name: 'A', tags: ['a'] });
    saveTagGroup({ name: 'B', tags: ['b'] });
    expect(listTagGroups()).toHaveLength(2);
    deleteTagGroup(g1.id);
    expect(listTagGroups()).toHaveLength(1);
    expect(listTagGroups()[0].name).toBe('B');
  });

  it('delete non-existent group is no-op', () => {
    saveTagGroup({ name: 'A', tags: ['a'] });
    deleteTagGroup('nonexistent');
    expect(listTagGroups()).toHaveLength(1);
  });

  it('generates unique IDs', () => {
    const g1 = saveTagGroup({ name: 'A', tags: ['a'] });
    const g2 = saveTagGroup({ name: 'B', tags: ['b'] });
    expect(g1.id).not.toBe(g2.id);
  });
});
