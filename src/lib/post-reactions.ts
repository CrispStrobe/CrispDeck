import type { UnifiedPost } from './types';

/** Viewer flags only belong to the account which fetched this row. */
export function postReactionSnapshot(post: UnifiedPost) {
  const raw = post.raw as any;
  const record = post.platform === 'mastodon' ? raw?.reblog ?? raw : raw?.post ?? raw;
  const scoped = post.sourceAccountId !== undefined;
  const liked = post.platform === 'bluesky' ? !!record?.viewer?.like : !!record?.favourited;
  const boosted = post.platform === 'bluesky' ? !!record?.viewer?.repost : !!record?.reblogged;
  return {
    key: JSON.stringify([post.platform, post.uri, post.sourceAccountId ?? null]),
    scoped, liked: scoped && liked, boosted: scoped && boosted,
    likeCount: post.likeCount ?? 0, boostCount: post.repostCount ?? 0,
  };
}
