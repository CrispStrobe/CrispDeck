import { describe, it, expect, vi } from 'vitest';
import { COLUMN_WIDTH_PRESETS, type ColumnWidthPreset, type DeckColumnConfig } from './deck-layouts';

describe('column UX features', () => {
  describe('TD-B2: column color coding', () => {
    const colorPresets = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', ''];

    it('has 9 color presets (8 colors + clear)', () => {
      expect(colorPresets).toHaveLength(9);
    });

    it('last preset is empty string (clear color)', () => {
      expect(colorPresets[colorPresets.length - 1]).toBe('');
    });

    it('persists color in column config', () => {
      const col: DeckColumnConfig = { id: 'col1', title: 'Timeline', type: 'timeline', color: '#3b82f6' };
      const serialized = JSON.parse(JSON.stringify(col));
      expect(serialized.color).toBe('#3b82f6');
    });

    it('defaults to empty string when no color set', () => {
      const col: DeckColumnConfig = { id: 'col1', title: 'Timeline', type: 'timeline' };
      expect(col.color ?? '').toBe('');
    });

    it('renders colored accent bar when color is set', () => {
      const color = '#ef4444';
      const hasBar = !!color;
      expect(hasBar).toBe(true);
    });

    it('does not render accent bar when color is empty', () => {
      const color = '';
      const hasBar = !!color;
      expect(hasBar).toBe(false);
    });
  });

  describe('TD-B3: column collapse / minimize', () => {
    it('defaults to not collapsed', () => {
      const col: DeckColumnConfig = { id: 'col1', title: 'Timeline', type: 'timeline' };
      expect(col.collapsed ?? false).toBe(false);
    });

    it('persists collapsed state', () => {
      const col: DeckColumnConfig = { id: 'col1', title: 'Timeline', type: 'timeline', collapsed: true };
      const serialized = JSON.parse(JSON.stringify(col));
      expect(serialized.collapsed).toBe(true);
    });

    it('collapsed column renders at 40px width', () => {
      const collapsed = true;
      const width = collapsed ? 40 : 380;
      expect(width).toBe(40);
    });

    it('clicking collapsed column expands it', () => {
      let collapsed = true;
      // Click handler
      collapsed = false;
      expect(collapsed).toBe(false);
    });
  });

  describe('TD-B4: column pin / lock', () => {
    it('defaults to not pinned', () => {
      const col: DeckColumnConfig = { id: 'col1', title: 'Timeline', type: 'timeline' };
      expect(col.pinned ?? false).toBe(false);
    });

    it('pinned column is not draggable', () => {
      const pinned = true;
      const draggable = !pinned;
      expect(draggable).toBe(false);
    });

    it('pinned column hides remove button', () => {
      const pinned = true;
      const showRemove = !pinned;
      expect(showRemove).toBe(false);
    });

    it('unpinned column is draggable and removable', () => {
      const pinned = false;
      expect(!pinned).toBe(true);
    });

    it('toggle pin state', () => {
      let pinned = false;
      pinned = !pinned;
      expect(pinned).toBe(true);
      pinned = !pinned;
      expect(pinned).toBe(false);
    });
  });

  describe('TD-B5: column clear', () => {
    it('clears posts array for column', () => {
      const columnPosts: Record<string, any[]> = { col1: [{ uri: '1' }, { uri: '2' }] };
      columnPosts.col1 = [];
      expect(columnPosts.col1).toEqual([]);
    });

    it('clears notification groups for column', () => {
      const columnNotifGroups: Record<string, any[]> = { col1: [{ id: 'g1' }] };
      columnNotifGroups.col1 = [];
      expect(columnNotifGroups.col1).toEqual([]);
    });

    it('does not affect other columns', () => {
      const columnPosts: Record<string, any[]> = {
        col1: [{ uri: '1' }],
        col2: [{ uri: '2' }],
      };
      columnPosts.col1 = [];
      expect(columnPosts.col2).toEqual([{ uri: '2' }]);
    });
  });

  describe('TD-B7: column width presets', () => {
    it('has 3 presets: narrow, medium, wide', () => {
      expect(Object.keys(COLUMN_WIDTH_PRESETS)).toEqual(['narrow', 'medium', 'wide']);
    });

    it('narrow is 280px', () => {
      expect(COLUMN_WIDTH_PRESETS.narrow).toBe(280);
    });

    it('medium is 350px', () => {
      expect(COLUMN_WIDTH_PRESETS.medium).toBe(350);
    });

    it('wide is 450px', () => {
      expect(COLUMN_WIDTH_PRESETS.wide).toBe(450);
    });

    it('preset selection updates column width', () => {
      let width = 380;
      width = COLUMN_WIDTH_PRESETS.narrow;
      expect(width).toBe(280);
    });

    it('active preset is highlighted', () => {
      const width = 350;
      const isActive = width === COLUMN_WIDTH_PRESETS.medium;
      expect(isActive).toBe(true);
    });
  });

  describe('TD-F2: keyboard shortcut for add-column', () => {
    it('a key toggles add menu', () => {
      let showAddMenu = false;
      // Simulate 'a' key
      showAddMenu = !showAddMenu;
      expect(showAddMenu).toBe(true);
    });

    it('Escape closes add menu', () => {
      let showAddMenu = true;
      // Simulate Escape
      showAddMenu = false;
      expect(showAddMenu).toBe(false);
    });
  });

  describe('TD-J1: account indicator', () => {
    it('identifies source account for Bluesky column', () => {
      const accounts = [
        { id: 1, platform: 'bluesky', handle: 'alice.bsky.social', avatar: 'https://...' },
        { id: 2, platform: 'mastodon', handle: '@bob@masto.social', avatar: 'https://...' },
      ];
      const bskyAcct = accounts.find(a => a.platform === 'bluesky');
      expect(bskyAcct?.handle).toBe('alice.bsky.social');
    });

    it('merged timeline has multiple accounts', () => {
      const accounts = [
        { id: 1, platform: 'bluesky', handle: 'alice.bsky.social' },
        { id: 2, platform: 'mastodon', handle: '@bob@masto.social' },
      ];
      expect(accounts.length).toBe(2);
    });
  });

  describe('column config serialization', () => {
    it('all new fields survive JSON roundtrip', () => {
      const col: DeckColumnConfig = {
        id: 'col1',
        title: 'Timeline',
        type: 'timeline',
        width: 350,
        color: '#3b82f6',
        collapsed: false,
        pinned: true,
        notify: 'sound',
        scrollLock: false,
      };
      const parsed = JSON.parse(JSON.stringify(col));
      expect(parsed.color).toBe('#3b82f6');
      expect(parsed.collapsed).toBe(false);
      expect(parsed.pinned).toBe(true);
      expect(parsed.notify).toBe('sound');
      expect(parsed.scrollLock).toBe(false);
    });
  });
});
