import type { UnifiedPost } from '$lib/types';

/** AppView provides the immediate parent alongside a feed reply when available. */
export function replyContext(post: UnifiedPost): { uri: string; author?: string; text?: string } | null {
  if (!post.replyParentUri) return null;
  if (post.platform !== 'bluesky') return { uri: post.replyParentUri };
  const parent = (post.raw as any)?.reply?.parent;
  if (!parent || parent.$type !== 'app.bsky.feed.defs#postView' || parent.uri !== post.replyParentUri) return { uri: post.replyParentUri };
  return {
    uri: parent.uri,
    author: parent.author?.displayName || parent.author?.handle,
    // Do not expose text from labelled parent posts outside their normal moderation view.
    text: parent.labels?.length ? undefined : parent.record?.text,
  };
}
