/**
 * Keyboard focus arithmetic for the deck.
 *
 * Which column and which post within it are focused, and how h/l/j/k and the
 * number keys move that. The rules lived inside the deck page mixed with the
 * scrollIntoView calls that follow them, so deck-keyboard.test.ts built a
 * parallel `createNavState` and tested that instead.
 *
 * Pure index maths: the caller still does the scrolling.
 */

export interface DeckFocus {
  /** Focused column index, or -1 for none. */
  column: number;
  /** Focused post index within that column, or -1 for none. */
  post: number;
}

export const NO_FOCUS: DeckFocus = { column: -1, post: -1 };

/**
 * Focus a column by index. Out of range is ignored rather than clamped — the
 * number keys address columns directly, and 7 with four columns open should do
 * nothing rather than land on the last one.
 *
 * Moving column always drops the post focus: the index would otherwise point
 * into a different column's list.
 */
export function focusColumn(focus: DeckFocus, index: number, columnCount: number): DeckFocus {
  if (index < 0 || index >= columnCount) return focus;
  return { column: index, post: -1 };
}

/** Focus a post within the focused column, clamped to what is there. */
export function focusPost(focus: DeckFocus, index: number, postCount: number): DeckFocus {
  if (focus.column < 0) return focus;
  if (postCount <= 0) return { ...focus, post: -1 };
  const clamped = Math.min(Math.max(index, 0), postCount - 1);
  return { ...focus, post: clamped };
}

/** h / ArrowLeft — stops at the first column rather than wrapping. */
export function focusPrevColumn(focus: DeckFocus, columnCount: number): DeckFocus {
  return focusColumn(focus, focus.column <= 0 ? 0 : focus.column - 1, columnCount);
}

/** l / ArrowRight — from nothing focused, lands on the first column. */
export function focusNextColumn(focus: DeckFocus, columnCount: number): DeckFocus {
  const next = focus.column < 0 ? 0 : Math.min(focus.column + 1, columnCount - 1);
  return focusColumn(focus, next, columnCount);
}

/** j — focuses the first column first if nothing is focused yet. */
export function focusNextPost(focus: DeckFocus, columnCount: number, postCount: number): DeckFocus {
  const base = focus.column < 0 ? focusColumn(focus, 0, columnCount) : focus;
  if (base.column < 0) return base;
  return focusPost(base, base.post + 1, postCount);
}

/** k — moving above the first post stays on it. */
export function focusPrevPost(focus: DeckFocus, postCount: number): DeckFocus {
  return focusPost(focus, focus.post - 1, postCount);
}

/** The column a number key addresses, or null when it addresses none. */
export function columnForNumberKey(key: string, columnCount: number): number | null {
  const num = parseInt(key, 10);
  if (!Number.isInteger(num) || num < 1 || num > 9 || num > columnCount) return null;
  return num - 1;
}
