import type { ClientEntry } from './api/client-factory';
import type { UnifiedPost } from './types';

const normalizedHandle = (handle: string) => handle.trim().replace(/^@/, '').toLowerCase();

/** A scoped row must never perform an action as a different connected account. */
export function postSourceClient(post: UnifiedPost, clients: Map<number, ClientEntry>): ClientEntry | undefined {
  const candidates = [...clients.values()].filter(entry => entry.platform === post.platform);
  let entry: ClientEntry | undefined;
  if (post.sourceAccountId !== undefined) {
    entry = clients.get(post.sourceAccountId);
  } else if (post.sourceAccount) {
    const matches = candidates.filter(candidate => normalizedHandle(candidate.handle) === normalizedHandle(post.sourceAccount!));
    if (matches.length === 1) entry = matches[0];
  } else if (candidates.length === 1) {
    entry = candidates[0];
  }
  if (!entry || entry.platform !== post.platform || entry.degraded) return undefined;
  if (post.sourceAccount && normalizedHandle(entry.handle) !== normalizedHandle(post.sourceAccount)) return undefined;
  return entry;
}
