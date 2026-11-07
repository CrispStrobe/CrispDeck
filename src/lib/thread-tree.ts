import type { UnifiedPost } from '$lib/types';

export interface ThreadRow { post: UnifiedPost; depth: number; selected: boolean }

/** Preserve parent-child relationships while keeping each branch together. */
export function threadRows(ancestors: UnifiedPost[], main: UnifiedPost, replies: UnifiedPost[]): ThreadRow[] {
  const posts = [...ancestors, main, ...replies];
  const unique = new Map<string, UnifiedPost>();
  for (const post of posts) if (!unique.has(post.uri)) unique.set(post.uri, post);
  const ordered = [...unique.values()];
  const identities = new Map<string, UnifiedPost>();
  for (const post of ordered) {
    identities.set(post.uri, post);
    const id = (post.raw as { id?: string } | undefined)?.id;
    if (id) identities.set(id, post);
  }
  const children = new Map<string, UnifiedPost[]>();
  const roots: UnifiedPost[] = [];
  for (const [index, post] of ordered.entries()) {
    let parent = post.replyParentUri ? identities.get(post.replyParentUri) : undefined;
    // Ancestors are delivered as a chain; a blocked or missing parent may
    // mean their metadata is incomplete. Keep the known chain readable.
    if (!parent && index > 0 && index <= ancestors.length) parent = ordered[index - 1];
    if (!parent && index > ancestors.length && post !== main) parent = main;
    if (!parent || parent === post) roots.push(post);
    else children.set(parent.uri, [...(children.get(parent.uri) ?? []), post]);
  }
  const rows: ThreadRow[] = [];
  const visited = new Set<string>();
  const visit = (post: UnifiedPost, depth: number) => {
    if (visited.has(post.uri)) return;
    visited.add(post.uri);
    rows.push({ post, depth, selected: post.uri === main.uri });
    const branches = children.get(post.uri) ?? [];
    // An author's continuation stays adjacent to the post it replies to.
    branches.sort((a, b) => Number(b.author.handle.toLowerCase() === post.author.handle.toLowerCase()) - Number(a.author.handle.toLowerCase() === post.author.handle.toLowerCase()));
    for (const child of branches) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  // Broken or cyclic parent data should not silently hide posts.
  for (const post of ordered) if (!visited.has(post.uri)) visit(post, 0);
  return rows;
}
