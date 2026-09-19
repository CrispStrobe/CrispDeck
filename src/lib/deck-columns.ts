/**
 * The canonical list of deck column types.
 *
 * The union lived in DeckColumn.svelte, where it is a type and nothing more —
 * there was no runtime list to check against, so deck.test.ts wrote its own and
 * asserted "supports all 14 column types" while the app had grown to 20.
 *
 * Declaring the array here and deriving the type from it means the two cannot
 * drift: adding a column type is one edit, and the test counts the real thing.
 */
export const COLUMN_TYPES = [
  'timeline', 'mentions', 'notifications', 'my-posts', 'search', 'list',
  'hashtag', 'user', 'feed', 'local', 'federated', 'tag-group', 'rss',
  'keyword-monitor', 'threads-search', 'messages', 'trending', 'activity',
  'likes', 'followers',
] as const;

export type ColumnType = (typeof COLUMN_TYPES)[number];

/** Column types that are meaningless without a query to drive them. */
export const QUERY_REQUIRED_COLUMN_TYPES: readonly ColumnType[] = [
  'search', 'hashtag', 'user', 'list', 'feed', 'tag-group', 'rss', 'keyword-monitor',
  'threads-search',
];

export function isColumnType(value: string): value is ColumnType {
  return (COLUMN_TYPES as readonly string[]).includes(value);
}

export function requiresQuery(type: ColumnType): boolean {
  return QUERY_REQUIRED_COLUMN_TYPES.includes(type);
}

/** Width limits for a deck column, in px. */
export const MIN_COLUMN_WIDTH = 280;
export const MAX_COLUMN_WIDTH = 600;
export const DEFAULT_COLUMN_WIDTH = 380;

/**
 * Keep a width inside the resize limits.
 *
 * The finite check is a guard the inline version did not have: a drag that
 * produced NaN would otherwise be clamped to NaN and persisted as the column's
 * width, which lays out as zero.
 */
export function clampColumnWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_COLUMN_WIDTH;
  return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, width));
}

/** Move a column, returning a new array. Out-of-range indices are a no-op. */
export function moveColumn<T>(columns: T[], from: number, to: number): T[] {
  if (from === to) return [...columns];
  if (from < 0 || from >= columns.length || to < 0 || to >= columns.length) return [...columns];
  const next = [...columns];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
