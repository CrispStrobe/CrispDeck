/**
 * When a deck column may scroll itself.
 *
 * A locked column stays where the reader left it; an unlocked one follows new
 * posts as they arrive. The condition also refuses to jump on the very first
 * load — `prevCount > 0` — because arriving at a column and being thrown to the
 * bottom is not "following along", it is losing your place before you had one.
 *
 * The rule lived as an expression inside DeckColumn.svelte, and the tests
 * restated it rather than calling it.
 */

/** Columns are locked unless the user says otherwise. */
export const DEFAULT_SCROLL_LOCK = true;

/** A column's lock state, defaulting for configs saved before the option existed. */
export function isColumnLocked(
  column: { scrollLock?: boolean } | Record<string, unknown> | null | undefined,
): boolean {
  const locked = (column as { scrollLock?: boolean } | null | undefined)?.scrollLock;
  return locked ?? DEFAULT_SCROLL_LOCK;
}

/** Whether newly arrived posts should pull the column down to them. */
export function shouldAutoScroll(
  scrollLock: boolean,
  prevCount: number,
  currentCount: number,
): boolean {
  return !scrollLock && currentCount > prevCount && prevCount > 0;
}
