import { describe, it, expect, beforeEach } from 'vitest';
import {
  listLayouts, getLayout, saveLayout, deleteLayout,
  renameLayout, getActiveLayoutName, setActiveLayoutName,
  duplicateLayout,
  type DeckColumnConfig,
} from './deck-layouts';

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

const workColumns: DeckColumnConfig[] = [
  { id: 't1', title: 'Timeline', type: 'timeline' },
  { id: 'n1', title: 'Notifications', type: 'notifications' },
];

const socialColumns: DeckColumnConfig[] = [
  { id: 't1', title: 'Timeline', type: 'timeline' },
  { id: 'h1', title: '#fun', type: 'hashtag', query: 'fun' },
  { id: 'h2', title: '#music', type: 'hashtag', query: 'music' },
];

describe('deck-layouts', () => {
  it('returns empty array when no layouts saved', () => {
    expect(listLayouts()).toEqual([]);
  });

  it('saves and retrieves a layout', () => {
    saveLayout('Work', workColumns);
    const layouts = listLayouts();
    expect(layouts).toHaveLength(1);
    expect(layouts[0].name).toBe('Work');
    expect(layouts[0].columns).toHaveLength(2);
    expect(layouts[0].columns[0].type).toBe('timeline');
  });

  it('getLayout finds by name', () => {
    saveLayout('Work', workColumns);
    saveLayout('Social', socialColumns);
    const layout = getLayout('Social');
    expect(layout?.columns).toHaveLength(3);
    expect(layout?.columns[1].query).toBe('fun');
  });

  it('getLayout returns undefined for non-existent', () => {
    expect(getLayout('missing')).toBeUndefined();
  });

  it('overwrites layout with same name', () => {
    saveLayout('Work', workColumns);
    saveLayout('Work', socialColumns);
    expect(listLayouts()).toHaveLength(1);
    expect(listLayouts()[0].columns).toHaveLength(3);
  });

  it('saves multiple layouts independently', () => {
    saveLayout('Work', workColumns);
    saveLayout('Social', socialColumns);
    expect(listLayouts()).toHaveLength(2);
  });

  it('deletes a layout', () => {
    saveLayout('Work', workColumns);
    saveLayout('Social', socialColumns);
    deleteLayout('Work');
    expect(listLayouts()).toHaveLength(1);
    expect(listLayouts()[0].name).toBe('Social');
  });

  it('delete non-existent layout is no-op', () => {
    saveLayout('Work', workColumns);
    deleteLayout('missing');
    expect(listLayouts()).toHaveLength(1);
  });

  it('renames a layout', () => {
    saveLayout('Work', workColumns);
    renameLayout('Work', 'Office');
    expect(listLayouts()[0].name).toBe('Office');
    expect(getLayout('Work')).toBeUndefined();
    expect(getLayout('Office')).toBeDefined();
  });

  it('rename updates active layout name if matching', () => {
    saveLayout('Work', workColumns);
    setActiveLayoutName('Work');
    renameLayout('Work', 'Office');
    expect(getActiveLayoutName()).toBe('Office');
  });

  it('tracks active layout name', () => {
    expect(getActiveLayoutName()).toBeNull();
    setActiveLayoutName('Work');
    expect(getActiveLayoutName()).toBe('Work');
  });

  it('deleting active layout clears active name', () => {
    saveLayout('Work', workColumns);
    setActiveLayoutName('Work');
    deleteLayout('Work');
    expect(getActiveLayoutName()).toBeNull();
  });

  it('duplicates a layout with unique name', () => {
    saveLayout('Work', workColumns);
    const dup = duplicateLayout('Work');
    expect(dup).not.toBeNull();
    expect(dup!.name).toBe('Work (copy)');
    expect(dup!.columns).toHaveLength(2);
    expect(listLayouts()).toHaveLength(2);
  });

  it('duplicate generates incrementing names to avoid collision', () => {
    saveLayout('Work', workColumns);
    duplicateLayout('Work');
    const dup2 = duplicateLayout('Work');
    expect(dup2!.name).toBe('Work (copy 2)');
    expect(listLayouts()).toHaveLength(3);
  });

  it('duplicate of non-existent returns null', () => {
    expect(duplicateLayout('missing')).toBeNull();
  });

  it('preserves column width and query in saved layout', () => {
    const cols: DeckColumnConfig[] = [
      { id: 's1', title: 'Search', type: 'search', query: 'svelte', width: 500 },
    ];
    saveLayout('Custom', cols);
    const layout = getLayout('Custom');
    expect(layout!.columns[0].width).toBe(500);
    expect(layout!.columns[0].query).toBe('svelte');
  });

  it('saving layout deep-clones columns (no mutation)', () => {
    const cols: DeckColumnConfig[] = [{ id: 't1', title: 'TL', type: 'timeline' }];
    saveLayout('Test', cols);
    cols[0].title = 'MUTATED';
    expect(getLayout('Test')!.columns[0].title).toBe('TL');
  });

  it('layout has createdAt timestamp', () => {
    saveLayout('Work', workColumns);
    const layout = getLayout('Work');
    expect(layout!.createdAt).toBeTruthy();
    expect(new Date(layout!.createdAt).getTime()).toBeGreaterThan(0);
  });

  it('preserves streaming flag on columns', () => {
    const cols: DeckColumnConfig[] = [
      { id: 't1', title: 'Timeline', type: 'timeline', streaming: true },
    ];
    saveLayout('Live', cols);
    expect(getLayout('Live')!.columns[0].streaming).toBe(true);
  });
});
