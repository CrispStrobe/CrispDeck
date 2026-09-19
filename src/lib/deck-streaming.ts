/**
 * Which deck columns can stream, and how.
 *
 * A column's live updates depend on its type: Mastodon exposes distinct
 * streaming endpoints (user, public, public:local, hashtag, list) and Bluesky
 * has only the Jetstream firehose, which is useful for the column types whose
 * contents can be recognised from it. Columns backed by a search or an external
 * feed have nothing to subscribe to and poll instead.
 *
 * This lived inline in the deck page, so the tests kept a parallel copy of both
 * the streamable list and the type mapping.
 */

/** Column types with a live subscription available. */
export const STREAMABLE_COLUMN_TYPES: readonly string[] = [
  'timeline', 'mentions', 'notifications', 'local', 'federated', 'hashtag', 'list', 'user',
];

/**
 * Column types Bluesky can stream.
 *
 * Jetstream carries the whole network, so a column only qualifies when its
 * contents can be recognised from an event — a followed author, the signed-in
 * user, a mention. Everything else would mean filtering the firehose against a
 * question it cannot answer.
 */
export const BLUESKY_STREAMABLE_COLUMN_TYPES: readonly string[] = ['timeline', 'user', 'mentions'];

export function isStreamableColumn(type: string): boolean {
  return STREAMABLE_COLUMN_TYPES.includes(type);
}

export function isBlueskyStreamable(type: string): boolean {
  return BLUESKY_STREAMABLE_COLUMN_TYPES.includes(type);
}

/**
 * The Mastodon stream endpoint for a column, or null when it cannot stream.
 *
 * `user` is the default: the home timeline, mentions and notifications all
 * arrive on it. hashtag and list need the query as their parameter, and fall
 * back to `user` without one rather than subscribing to a stream with no
 * subject.
 */
export function mastodonStreamFor(
  type: string,
  query?: string,
): { streamType: string; streamParam?: string } | null {
  if (!isStreamableColumn(type)) return null;
  if (type === 'local') return { streamType: 'public:local' };
  if (type === 'federated') return { streamType: 'public' };
  if (type === 'hashtag' && query) return { streamType: 'hashtag', streamParam: query };
  if (type === 'list' && query) return { streamType: 'list', streamParam: query };
  return { streamType: 'user' };
}
