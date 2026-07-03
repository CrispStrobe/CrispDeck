/**
 * "For You" algorithmic feed — locally computed, privacy-preserving.
 *
 * Ranks posts by how much the user interacts with each author,
 * based on engagement data from the local archive/IndexedDB.
 * No data ever leaves the device.
 */

import type { UnifiedPost } from './types';

export interface AuthorAffinity {
  handle: string;
  score: number; // higher = more interaction
}

/**
 * Build author affinity scores from a history of the user's own interactions.
 * Each liked/reposted/replied-to author gets a score bump.
 */
export function buildAffinityMap(
  likedPosts: { authorHandle: string }[],
  repostedPosts: { authorHandle: string }[],
  repliedPosts: { authorHandle: string }[],
): Map<string, number> {
  const map = new Map<string, number>();

  function add(handle: string, weight: number) {
    const key = handle.toLowerCase();
    map.set(key, (map.get(key) ?? 0) + weight);
  }

  for (const p of likedPosts) add(p.authorHandle, 1);
  for (const p of repostedPosts) add(p.authorHandle, 2);
  for (const p of repliedPosts) add(p.authorHandle, 3); // replies = strongest signal

  return map;
}

/**
 * Score a post for the "For You" feed.
 *
 * Combines:
 * - Author affinity (how much user interacts with this author)
 * - Post engagement (likes, reposts, replies from others)
 * - Recency (newer posts score higher)
 */
export function scoreForYou(
  post: UnifiedPost,
  affinityMap: Map<string, number>,
  now: number = Date.now(),
): number {
  const handle = post.author.handle.toLowerCase();
  const affinity = affinityMap.get(handle) ?? 0;

  // Engagement score (capped to avoid viral posts dominating)
  const engagement = Math.min(
    (post.likeCount ?? 0) * 1 + (post.repostCount ?? 0) * 2 + (post.replyCount ?? 0) * 1.5,
    100
  );

  // Recency decay: halves every 6 hours
  const ageMs = now - new Date(post.createdAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  const recency = Math.pow(0.5, ageHours / 6);

  // Combined score: affinity is the strongest signal
  return (affinity * 10 + engagement) * recency;
}

/**
 * Rank posts for "For You" feed.
 * Filters out reposts and sorts by personalized score.
 * Optimized: pre-computes timestamps to avoid repeated Date parsing.
 */
export function rankForYou(
  posts: UnifiedPost[],
  affinityMap: Map<string, number>,
): UnifiedPost[] {
  const now = Date.now();
  const filtered = posts.filter(p => !p.isRepost);

  // Pre-compute timestamps and handle lookups to avoid repeated work in scoring
  const scored = filtered.map(p => {
    const handle = p.author.handle.toLowerCase();
    const affinity = affinityMap.get(handle) ?? 0;
    const engagement = Math.min(
      (p.likeCount ?? 0) * 1 + (p.repostCount ?? 0) * 2 + (p.replyCount ?? 0) * 1.5,
      100
    );
    const ageMs = now - new Date(p.createdAt).getTime();
    const recency = Math.pow(0.5, ageMs / (1000 * 60 * 60 * 6));
    const score = (affinity * 10 + engagement) * recency;
    return { post: p, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map(({ post }) => post);
}
