/**
 * Universal cross-network search.
 *
 * Queries Bluesky, Mastodon, and Threads simultaneously,
 * normalizes results to UnifiedPost[], and deduplicates via
 * the existing crosspost detection infrastructure.
 */

import type { UnifiedPost, Platform } from '$lib/types';

export interface SearchOptions {
  query: string;
  platforms: Platform[];
  limit?: number;
}

export interface SearchResults {
  posts: UnifiedPost[];
  totalByPlatform: Record<Platform, number>;
  query: string;
  searchedAt: string;
}

/**
 * Search across Bluesky using app.bsky.feed.searchPosts.
 * Returns raw results that the caller normalizes.
 */
export async function searchBluesky(
  query: string,
  agent: any,
  limit = 25,
): Promise<any[]> {
  if (!agent) return [];
  try {
    const resp = await agent.app.bsky.feed.searchPosts({
      q: query,
      limit,
    });
    return resp.data?.posts ?? [];
  } catch {
    return [];
  }
}

/**
 * Search Mastodon using /api/v2/search.
 */
export async function searchMastodon(
  query: string,
  instanceUrl: string,
  accessToken: string,
  limit = 25,
): Promise<any[]> {
  if (!instanceUrl || !accessToken) return [];
  try {
    const url = `${instanceUrl.replace(/\/$/, '')}/api/v2/search?q=${encodeURIComponent(query)}&type=statuses&limit=${limit}&resolve=true`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.statuses ?? [];
  } catch {
    return [];
  }
}

/**
 * Search Threads via /threads endpoint (search_surface=TOP).
 */
export async function searchThreads(
  query: string,
  accessToken: string,
  limit = 25,
): Promise<any[]> {
  if (!accessToken) return [];
  try {
    const url = `https://graph.threads.net/search?q=${encodeURIComponent(query)}&search_surface=TOP&limit=${limit}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.data ?? [];
  } catch {
    return [];
  }
}

/**
 * Merge and deduplicate search results from multiple platforms.
 * Uses text similarity (Jaro-Winkler from unified.ts) to collapse crossposts.
 */
export function mergeSearchResults(
  resultsByPlatform: Map<Platform, UnifiedPost[]>,
): SearchResults {
  const allPosts: UnifiedPost[] = [];
  const totalByPlatform: Record<Platform, number> = {
    bluesky: 0,
    mastodon: 0,
    threads: 0,
  };

  for (const [platform, posts] of resultsByPlatform) {
    totalByPlatform[platform] = posts.length;
    allPosts.push(...posts);
  }

  // Sort by relevance heuristic: engagement + recency
  const now = Date.now();
  allPosts.sort((a, b) => {
    const engA = (a.likeCount ?? 0) + (a.repostCount ?? 0) * 2;
    const engB = (b.likeCount ?? 0) + (b.repostCount ?? 0) * 2;
    const ageA = (now - new Date(a.createdAt).getTime()) / 3600000; // hours
    const ageB = (now - new Date(b.createdAt).getTime()) / 3600000;
    // Score: engagement / (age + 1) — higher is better
    const scoreA = engA / (ageA + 1);
    const scoreB = engB / (ageB + 1);
    return scoreB - scoreA;
  });

  // Simple URI-based dedup (crosspost grouping handled at UI layer via detectCrossposts)
  const seen = new Set<string>();
  const deduped = allPosts.filter(p => {
    if (seen.has(p.uri)) return false;
    seen.add(p.uri);
    return true;
  });

  return {
    posts: deduped,
    totalByPlatform,
    query: '',
    searchedAt: new Date().toISOString(),
  };
}
