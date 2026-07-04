import { describe, it, expect } from 'vitest';
import {
  createMultiSelect, toggleMultiSelect, togglePost, selectAll,
  deselectAll, selectRange, isSelected, selectedCount, getSelectedPosts,
} from './multi-select';
import type { UnifiedPost } from '$lib/types';

const makePost = (uri: string): UnifiedPost => ({
  uri, text: `Post ${uri}`, author: { handle: 'test' },
  createdAt: '2026-01-01', platform: 'bluesky', isRepost: false, raw: {},
});

describe('multi-select', () => {
  describe('createMultiSelect', () => {
    it('starts disabled with empty selection', () => {
      const s = createMultiSelect();
      expect(s.enabled).toBe(false);
      expect(s.selected.size).toBe(0);
    });
  });

  describe('toggleMultiSelect', () => {
    it('enables multi-select', () => {
      const s = toggleMultiSelect(createMultiSelect());
      expect(s.enabled).toBe(true);
    });

    it('disabling clears selection', () => {
      let s = createMultiSelect();
      s = toggleMultiSelect(s); // enable
      s = togglePost(s, 'uri1');
      s = togglePost(s, 'uri2');
      expect(s.selected.size).toBe(2);
      s = toggleMultiSelect(s); // disable
      expect(s.enabled).toBe(false);
      expect(s.selected.size).toBe(0);
    });
  });

  describe('togglePost', () => {
    it('selects a post', () => {
      let s = createMultiSelect();
      s = togglePost(s, 'uri1');
      expect(isSelected(s, 'uri1')).toBe(true);
    });

    it('deselects a selected post', () => {
      let s = createMultiSelect();
      s = togglePost(s, 'uri1');
      s = togglePost(s, 'uri1');
      expect(isSelected(s, 'uri1')).toBe(false);
    });

    it('supports multiple selections', () => {
      let s = createMultiSelect();
      s = togglePost(s, 'uri1');
      s = togglePost(s, 'uri2');
      s = togglePost(s, 'uri3');
      expect(selectedCount(s)).toBe(3);
    });
  });

  describe('selectAll', () => {
    it('selects all given URIs', () => {
      let s = createMultiSelect();
      s = selectAll(s, ['a', 'b', 'c', 'd']);
      expect(selectedCount(s)).toBe(4);
      expect(isSelected(s, 'a')).toBe(true);
      expect(isSelected(s, 'd')).toBe(true);
    });

    it('replaces previous selection', () => {
      let s = createMultiSelect();
      s = togglePost(s, 'old');
      s = selectAll(s, ['new1', 'new2']);
      expect(isSelected(s, 'old')).toBe(false);
      expect(selectedCount(s)).toBe(2);
    });
  });

  describe('deselectAll', () => {
    it('clears all selections', () => {
      let s = createMultiSelect();
      s = togglePost(s, 'a');
      s = togglePost(s, 'b');
      s = deselectAll(s);
      expect(selectedCount(s)).toBe(0);
    });
  });

  describe('selectRange', () => {
    const uris = ['a', 'b', 'c', 'd', 'e'];

    it('selects range from-to inclusive', () => {
      let s = createMultiSelect();
      s = selectRange(s, uris, 1, 3);
      expect(isSelected(s, 'b')).toBe(true);
      expect(isSelected(s, 'c')).toBe(true);
      expect(isSelected(s, 'd')).toBe(true);
      expect(isSelected(s, 'a')).toBe(false);
      expect(isSelected(s, 'e')).toBe(false);
    });

    it('works with reversed indices', () => {
      let s = createMultiSelect();
      s = selectRange(s, uris, 3, 1);
      expect(selectedCount(s)).toBe(3);
      expect(isSelected(s, 'b')).toBe(true);
      expect(isSelected(s, 'd')).toBe(true);
    });

    it('adds to existing selection', () => {
      let s = createMultiSelect();
      s = togglePost(s, 'a');
      s = selectRange(s, uris, 3, 4);
      expect(selectedCount(s)).toBe(3); // a + d + e
      expect(isSelected(s, 'a')).toBe(true);
    });
  });

  describe('getSelectedPosts', () => {
    it('returns matching posts from list', () => {
      const posts = [makePost('a'), makePost('b'), makePost('c')];
      let s = createMultiSelect();
      s = togglePost(s, 'a');
      s = togglePost(s, 'c');
      const selected = getSelectedPosts(s, posts);
      expect(selected).toHaveLength(2);
      expect(selected[0].uri).toBe('a');
      expect(selected[1].uri).toBe('c');
    });

    it('returns empty array when nothing selected', () => {
      const posts = [makePost('a'), makePost('b')];
      const s = createMultiSelect();
      expect(getSelectedPosts(s, posts)).toEqual([]);
    });

    it('ignores selected URIs not in post list', () => {
      const posts = [makePost('a')];
      let s = createMultiSelect();
      s = togglePost(s, 'a');
      s = togglePost(s, 'nonexistent');
      expect(getSelectedPosts(s, posts)).toHaveLength(1);
    });
  });

  describe('immutability', () => {
    it('does not mutate original state', () => {
      const s1 = createMultiSelect();
      const s2 = togglePost(s1, 'uri1');
      expect(s1.selected.size).toBe(0);
      expect(s2.selected.size).toBe(1);
    });

    it('each toggle returns new state object', () => {
      const s1 = createMultiSelect();
      const s2 = togglePost(s1, 'a');
      const s3 = togglePost(s2, 'b');
      expect(s1).not.toBe(s2);
      expect(s2).not.toBe(s3);
    });
  });
});
