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
 * Remembers which post each like/repost record pointed at.
 *
 * A Jetstream delete commit identifies only the record being deleted — it
 * carries no `record`, so no subject:
 *
 *   {"rev":"...","operation":"delete","collection":"app.bsky.feed.like","rkey":"..."}
 *
 * Without this map there is no way to know which post an unlike belongs to, and
 * the decrement was simply unreachable: counters only ever went up for as long
 * as a post stayed on screen.
 *
 * Only creates whose subject is currently on screen are remembered, so the map
 * stays small on its own; `max` is a backstop for a long-lived tab.
 */
export class SubjectIndex {
  private entries = new Map<string, string>();
  constructor(private max = 5000) {}

  private static key(did: string, collection: string, rkey: string) {
    return `${did}/${collection}/${rkey}`;
  }

  remember(did: string, collection: string, rkey: string, uri: string): void {
    const k = SubjectIndex.key(did, collection, rkey);
    // Re-insert so iteration order is least-recent-first.
    this.entries.delete(k);
    this.entries.set(k, uri);
    if (this.entries.size > this.max) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
  }

  /** Look up and consume — a record can only be deleted once. */
  take(did: string, collection: string, rkey: string): string | undefined {
    const k = SubjectIndex.key(did, collection, rkey);
    const uri = this.entries.get(k);
    if (uri !== undefined) this.entries.delete(k);
    return uri;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

/** Deletes carry no subject uri, so the at:// gate can never pass them. */
function isDeleteCommit(raw: string): boolean {
  return raw.indexOf('"operation":"delete"') !== -1;
}

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
export function decodeEvent(
  data: any,
  isWatched: (uri: string) => boolean,
  index?: SubjectIndex
): CountUpdate | null {
  if (!data?.commit) return null;

  const { collection, operation, record, rkey } = data.commit;
  if (!collection || !operation) return null;

  const type: 'like' | 'repost' | undefined =
    collection === 'app.bsky.feed.like' ? 'like'
    : collection === 'app.bsky.feed.repost' ? 'repost'
    : undefined;
  if (!type) return null;

  if (operation === 'create') {
    const uri = record?.subject?.uri;
    if (!uri || !isWatched(uri)) return null;
    // Remember it so the matching delete can be attributed later.
    if (index && data.did && rkey) index.remember(data.did, collection, rkey, uri);
    return { uri, type, delta: 1 };
  }

  if (operation === 'delete') {
    if (!index || !data.did || !rkey) return null;
    const uri = index.take(data.did, collection, rkey);
    if (!uri || !isWatched(uri)) return null;
    return { uri, type, delta: -1 };
  }

  return null;
}

/**
 * Full pipeline: pre-filter, parse, decode. Returns null for the common case.
 *
 * Creates are gated on containing a watched at:// uri. Deletes cannot be gated
 * that way (they carry no subject), so they are parsed and resolved through the
 * index instead — affordable because deletes are a small fraction of the
 * firehose, around 1% of commits when measured against the live stream.
 */
export function matchRawEvent(
  raw: string,
  isWatched: (uri: string) => boolean,
  index?: SubjectIndex
): CountUpdate | null {
  const isDelete = index !== undefined && isDeleteCommit(raw);
  if (!isDelete && !mightMatch(raw, isWatched)) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null; // malformed message
  }
  return decodeEvent(data, isWatched, index);
}
