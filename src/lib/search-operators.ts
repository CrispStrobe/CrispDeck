/**
 * Building search queries from the quick-filter buttons.
 *
 * Each of these was an expression inside the search page's template — the
 * "past week" button computed its own date inline — so the tests restated them
 * and could not notice a change.
 */

/** One search operator the Bluesky backend understands. */
export interface SearchOperator {
  /** Example usage, as shown to the user. */
  op: string;
  /** What it does, in a few words. */
  desc: string;
}

/**
 * Operators Bluesky's search supports.
 *
 * Mastodon takes `from:@user@instance` and bare `#hashtag`; Threads takes plain
 * keywords only, which is why the quick filters are hidden for it.
 */
export const BLUESKY_SEARCH_OPERATORS: SearchOperator[] = [
  { op: 'from:handle.bsky.social', desc: 'posts by a user' },
  { op: 'since:2026-01-01', desc: 'posts after date' },
  { op: 'until:2026-12-31', desc: 'posts before date' },
  { op: 'lang:en', desc: 'filter by language' },
  { op: 'has:media', desc: 'posts with images/video' },
];

/** Add an operator to a query, keeping single spaces and no stray edges. */
export function appendOperator(query: string, op: string): string {
  return (query.trim() + ' ' + op).trim();
}

/** `from:` for the signed-in account, or null when there isn't one. */
export function fromMeOperator(handle: string | undefined | null): string | null {
  return handle ? `from:${handle}` : null;
}

/** `since:` one week before `now`, as a plain YYYY-MM-DD date. */
export function pastWeekOperator(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 7);
  return `since:${d.toISOString().split('T')[0]}`;
}
