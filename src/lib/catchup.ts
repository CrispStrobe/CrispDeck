/**
 * Catch-up mode: shows a finite, engagement-ranked summary of recent posts.
 * Inspired by Phanpy's catch-up feature.
 */

import type { UnifiedPost } from './types';

export type CatchupWindow = 1 | 3 | 6 | 12 | 24;

/** Score a post by engagement for ranking in catch-up view */
export function scorePost(post: UnifiedPost): number {
  return (post.likeCount ?? 0) * 2 + (post.repostCount ?? 0) * 3 + (post.replyCount ?? 0);
}

/**
 * Filter posts to those within the given time window and sort by engagement score.
 * Returns posts ranked by engagement (most engaging first), not chronologically.
 */
export function buildCatchupFeed(posts: UnifiedPost[], windowHours: CatchupWindow): UnifiedPost[] {
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000;

  const recent = posts.filter(p => {
    const postTime = new Date(p.createdAt).getTime();
    return postTime >= cutoff && !p.isRepost;
  });

  return recent.sort((a, b) => scorePost(b) - scorePost(a));
}
