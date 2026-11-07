import type { UnifiedPost } from '$lib/types';

export interface ThreadRow { post: UnifiedPost; depth: number; selected: boolean }

function authorIdentity(post: UnifiedPost) {
  const raw = post.raw as { account?: { id?: string }; reblog?: { account?: { id?: string } } } | undefined;
  const id = post.platform === 'bluesky' ? /^at:\/\/(did:[^/]+)\//.exec(post.uri)?.[1]
    : post.platform === 'mastodon' ? (raw?.reblog ?? raw)?.account?.id : undefined;
  return { id, handle: post.author.handle.toLowerCase(), platform: post.platform };
}

function authorsMatch(author: ReturnType<typeof authorIdentity>, other: ReturnType<typeof authorIdentity>): boolean {
  return author.platform === other.platform &&
    (author.id && other.id ? author.id === other.id : author.handle === other.handle);
}

export function sameThreadAuthor(first: UnifiedPost, second: UnifiedPost): boolean {
  return authorsMatch(authorIdentity(first), authorIdentity(second));
}

/** Preserve parent-child relationships while keeping each branch together. */
export function threadRows(ancestors: UnifiedPost[], main: UnifiedPost, replies: UnifiedPost[]): ThreadRow[] {
  const unique = new Map<string, UnifiedPost>();
  for (const post of ancestors) if (post.uri !== main.uri && !unique.has(post.uri)) unique.set(post.uri, post);
  const knownAncestors = [...unique.values()];
  unique.set(main.uri, main);
  for (const post of replies) if (!unique.has(post.uri)) unique.set(post.uri, post);
  const ordered = [...unique.values()];
  const identities = new Map<string, UnifiedPost>();
  const authors = new Map(ordered.map(post => [post.uri, authorIdentity(post)]));
  for (const post of ordered) {
    identities.set(post.uri, post);
    const id = (post.raw as { id?: string } | undefined)?.id;
    if (id) identities.set(id, post);
  }
  // Base fallback relationships on the deduplicated ancestor chain, never on
  // positions in an input array which may repeat the selected post or a parent.
  const fallbackParents = new Map<string, UnifiedPost>();
  let previous: UnifiedPost | undefined;
  for (const post of [...knownAncestors, main]) {
    if (previous) fallbackParents.set(post.uri, previous);
    previous = post;
  }
  const ancestorUris = new Set(knownAncestors.map(post => post.uri));
  const children = new Map<string, UnifiedPost[]>();
  const roots: UnifiedPost[] = [];
  for (const post of ordered) {
    let parent = post.replyParentUri ? identities.get(post.replyParentUri) : undefined;
    // Ancestors are delivered as a chain; a blocked or missing parent may
    // mean their metadata is incomplete. Keep the known chain readable.
    parent ??= fallbackParents.get(post.uri);
    if (!parent && !ancestorUris.has(post.uri) && post !== main) parent = main;
    if (!parent || parent === post) roots.push(post);
    else {
      const siblings = children.get(parent.uri);
      if (siblings) siblings.push(post);
      else children.set(parent.uri, [post]);
    }
  }
  const rows: ThreadRow[] = [];
  const visited = new Set<string>();
  const visit = (start: UnifiedPost) => {
    const pending = [{ post: start, depth: 0 }];
    while (pending.length) {
      const { post, depth } = pending.pop()!;
      if (visited.has(post.uri)) continue;
      visited.add(post.uri);
      rows.push({ post, depth, selected: post.uri === main.uri });
      const author = authors.get(post.uri)!;
      const continuation: UnifiedPost[] = [];
      const others: UnifiedPost[] = [];
      for (const child of children.get(post.uri) ?? []) {
        const other = authors.get(child.uri)!;
        const sameAuthor = authorsMatch(author, other);
        (sameAuthor ? continuation : others).push(child);
      }
      // Reverse onto a stack to keep each branch together without recursion,
      // and preserve server order within author continuations and other replies.
      for (const branch of [others, continuation]) {
        for (let i = branch.length - 1; i >= 0; i--) pending.push({ post: branch[i], depth: depth + 1 });
      }
    }
  };
  for (const root of roots) visit(root);
  // Broken or cyclic parent data should not silently hide posts.
  for (const post of ordered) if (!visited.has(post.uri)) visit(post);
  return rows;
}
