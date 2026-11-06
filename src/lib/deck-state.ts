import type { UnifiedPost } from './types';

/** Refresh updates rows in place and prepends arrivals; pagination appends. */
export function mergeColumnPosts(existing: UnifiedPost[], incoming: UnifiedPost[], older = false): UnifiedPost[] {
  const updates = new Map(incoming.map(post => [post.uri, post]));
  const known = new Set(existing.map(post => post.uri));
  const fresh = [...updates.values()].filter(post => !known.has(post.uri));
  const retained = existing.map(post => updates.get(post.uri) ?? post);
  return older ? [...retained, ...fresh] : [...fresh, ...retained];
}

/** Never reintroduce content removed by a delete event during an in-flight load. */
export function withoutDeletedPosts(posts: UnifiedPost[], deleted: ReadonlySet<string>): UnifiedPost[] {
  return posts.filter(post => !deleted.has(post.uri));
}
