/**
 * Deck keyboard navigation.
 *
 * This previously built a `createNavState` closure that reimplemented the
 * focus rules and tested that, so it passed whatever the deck page did. It now
 * exercises $lib/deck-focus, which the page's handlers call.
 */
import { describe, it, expect } from 'vitest';
import {
  NO_FOCUS, focusColumn, focusPost, focusPrevColumn, focusNextColumn,
  focusNextPost, focusPrevPost, columnForNumberKey, type DeckFocus,
} from './deck-focus';

const at = (column: number, post = -1): DeckFocus => ({ column, post });

describe('focusColumn', () => {
  it('focuses a column in range', () => {
    expect(focusColumn(NO_FOCUS, 1, 3)).toEqual({ column: 1, post: -1 });
  });

  it('ignores an index past the end', () => {
    expect(focusColumn(at(1), 5, 3)).toEqual(at(1));
  });

  it('ignores a negative index', () => {
    expect(focusColumn(at(1), -1, 3)).toEqual(at(1));
  });

  it('ignores everything when there are no columns', () => {
    expect(focusColumn(NO_FOCUS, 0, 0)).toEqual(NO_FOCUS);
  });

  /** The post index points into a specific column's list. */
  it('drops the post focus when the column changes', () => {
    expect(focusColumn(at(0, 4), 2, 3)).toEqual({ column: 2, post: -1 });
  });
});

describe('focusPost', () => {
  it('focuses a post in range', () => {
    expect(focusPost(at(0), 3, 10)).toEqual({ column: 0, post: 3 });
  });

  it('clamps past the last post', () => {
    expect(focusPost(at(0), 99, 10)).toEqual({ column: 0, post: 9 });
  });

  it('clamps below the first post', () => {
    expect(focusPost(at(0, 5), -3, 10)).toEqual({ column: 0, post: 0 });
  });

  it('does nothing without a focused column', () => {
    expect(focusPost(NO_FOCUS, 2, 10)).toEqual(NO_FOCUS);
  });

  it('focuses nothing in an empty column', () => {
    expect(focusPost(at(0, 3), 0, 0)).toEqual({ column: 0, post: -1 });
  });
});

describe('column navigation (h/l, ArrowLeft/ArrowRight)', () => {
  it('h moves focus left', () => {
    expect(focusPrevColumn(at(1), 3).column).toBe(0);
  });

  it('h stops at the first column rather than wrapping', () => {
    expect(focusPrevColumn(at(0), 3).column).toBe(0);
  });

  it('h from nothing focused lands on the first column', () => {
    expect(focusPrevColumn(NO_FOCUS, 3).column).toBe(0);
  });

  it('l moves focus right', () => {
    expect(focusNextColumn(at(0), 3).column).toBe(1);
  });

  it('l stops at the last column rather than wrapping', () => {
    expect(focusNextColumn(at(2), 3).column).toBe(2);
  });

  it('l from nothing focused lands on the first column', () => {
    expect(focusNextColumn(NO_FOCUS, 3).column).toBe(0);
  });

  it('does nothing when there are no columns', () => {
    expect(focusNextColumn(NO_FOCUS, 0)).toEqual(NO_FOCUS);
    expect(focusPrevColumn(NO_FOCUS, 0)).toEqual(NO_FOCUS);
  });

  it('moving column clears the focused post', () => {
    expect(focusNextColumn(at(0, 7), 3)).toEqual({ column: 1, post: -1 });
  });
});

describe('post navigation within a column (j/k)', () => {
  it('j moves down', () => {
    expect(focusNextPost(at(0, 2), 3, 10).post).toBe(3);
  });

  it('j from nothing focused takes the first column and its first post', () => {
    expect(focusNextPost(NO_FOCUS, 3, 10)).toEqual({ column: 0, post: 0 });
  });

  it('j stops at the last post', () => {
    expect(focusNextPost(at(0, 9), 3, 10).post).toBe(9);
  });

  it('k moves up', () => {
    expect(focusPrevPost(at(0, 4), 10).post).toBe(3);
  });

  it('k stops at the first post', () => {
    expect(focusPrevPost(at(0, 0), 10).post).toBe(0);
  });

  it('k does nothing without a focused column', () => {
    expect(focusPrevPost(NO_FOCUS, 10)).toEqual(NO_FOCUS);
  });

  it('j in an empty column focuses no post', () => {
    expect(focusNextPost(at(0), 3, 0)).toEqual({ column: 0, post: -1 });
  });
});

describe('number keys jump to a column', () => {
  it('1 addresses the first column', () => {
    expect(columnForNumberKey('1', 5)).toBe(0);
  });

  it('9 addresses the ninth', () => {
    expect(columnForNumberKey('9', 9)).toBe(8);
  });

  /** Addressing a column that is not open should do nothing, not clamp. */
  it('is null past the number of open columns', () => {
    expect(columnForNumberKey('7', 4)).toBeNull();
  });

  it('is null for 0, which addresses no column', () => {
    expect(columnForNumberKey('0', 5)).toBeNull();
  });

  it('is null for a non-digit key', () => {
    expect(columnForNumberKey('j', 5)).toBeNull();
    expect(columnForNumberKey('Enter', 5)).toBeNull();
    expect(columnForNumberKey('', 5)).toBeNull();
  });

  it('is null with no columns open', () => {
    expect(columnForNumberKey('1', 0)).toBeNull();
  });
});
