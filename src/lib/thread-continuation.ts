import type { UnifiedPost } from '$lib/types';

/** Group only direct self-replies, not the author's replies to other people. */
export function partitionThreadReplies(main: UnifiedPost, replies: UnifiedPost[]) {
  const unique = new Map<string, UnifiedPost>();
  for (const post of replies) if (post.uri !== main.uri && !unique.has(post.uri)) unique.set(post.uri, post);
  const ordered = [...unique.values()];
  const sameAuthor = (post: UnifiedPost) => {
    const did = (p: UnifiedPost) => p.platform === 'bluesky' ? /^at:\/\/([^/]+)\//.exec(p.uri)?.[1] : undefined;
    const accountId = (p: UnifiedPost) => (p.raw as any)?.account?.id as string | undefined;
    const a = did(main) ?? accountId(main), b = did(post) ?? accountId(post);
    return a && b ? a === b : main.author.handle.toLowerCase() === post.author.handle.toLowerCase();
  };
  const identities = (post: UnifiedPost) => [post.uri, (post.raw as any)?.id].filter(Boolean);
  const children = (parent: UnifiedPost) => ordered.filter(post => post.replyParentUri && identities(parent).includes(post.replyParentUri) && sameAuthor(post))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.uri.localeCompare(b.uri));
  const continuation: UnifiedPost[] = [];
  const visited = new Set<string>([main.uri]);
  function visit(parent: UnifiedPost) {
    for (const post of children(parent)) {
      if (visited.has(post.uri)) continue;
      visited.add(post.uri);
      continuation.push(post);
      visit(post);
    }
  }
  visit(main);
  return { continuation, replies: ordered.filter(post => !visited.has(post.uri)) };
}
