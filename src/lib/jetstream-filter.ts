/**
 * Pure event matching for the Jetstream firehose.
 *
 * Kept separate from the client so it can run unchanged on the main thread or
 * inside the worker, and be tested without a WebSocket.
 */

export interface CountUpdate {
  uri: string; // post URI that was liked/reposted
  type: 'like' | 'repost';
  delta: 1 | -1; // +1 for create, -1 for delete
}

const AT_URI_RE = /at:\/\/[^"\\]+/g;

/**
 * Cheap rejection test run before JSON.parse.
 *
 * We subscribe to every like and repost on the network but only care about the
 * handful of posts currently on screen, so almost every message is discarded.
 * Parsing them all was the expensive part. Any message that would pass the
 * authoritative check below must contain the watched post's URI verbatim
 * between two quotes, so scanning for at:// URIs and testing the watch set
 * rejects the rest without building an object — and never produces a false
 * negative.
 */
export function mightMatch(raw: string, isWatched: (uri: string) => boolean): boolean {
  if (raw.indexOf('at://') === -1) return false;
  AT_URI_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AT_URI_RE.exec(raw)) !== null) {
    if (isWatched(m[0])) return true;
  }
  return false;
}

/** Authoritative decode of a Jetstream commit into a count update, or null. */
export function decodeEvent(data: any, isWatched: (uri: string) => boolean): CountUpdate | null {
  if (!data?.commit) return null;

  const { collection, operation, record } = data.commit;
  if (!collection || !operation) return null;

  let uri: string | undefined;
  let type: 'like' | 'repost' | undefined;

  if (collection === 'app.bsky.feed.like' && record?.subject?.uri) {
    uri = record.subject.uri;
    type = 'like';
  } else if (collection === 'app.bsky.feed.repost' && record?.subject?.uri) {
    uri = record.subject.uri;
    type = 'repost';
  }

  if (!uri || !type) return null;
  if (!isWatched(uri)) return null;

  const delta = operation === 'create' ? 1 : operation === 'delete' ? -1 : 0;
  if (delta === 0) return null;

  return { uri, type, delta: delta as 1 | -1 };
}

/** Full pipeline: pre-filter, parse, decode. Returns null for the common case. */
export function matchRawEvent(raw: string, isWatched: (uri: string) => boolean): CountUpdate | null {
  if (!mightMatch(raw, isWatched)) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null; // malformed message
  }
  return decodeEvent(data, isWatched);
}
