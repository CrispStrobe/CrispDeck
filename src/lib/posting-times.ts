/**
 * Optimal posting time analysis.
 * Computes best hour per platform from archived post engagement data.
 */

import type { Platform } from './types';

export interface PostingTimeInsight {
  platform: Platform;
  bestHour: number; // 0-23
  avgEngagement: number;
}

/**
 * Compute the best posting hour for a platform based on historical engagement.
 * Takes archived posts with engagement data and returns the hour with highest avg engagement.
 */
export function computeBestHour(
  posts: { createdAt: string; likeCount: number; repostCount: number; platform: Platform }[],
  platform: Platform,
): PostingTimeInsight | null {
  const platformPosts = posts.filter(p => p.platform === platform);
  if (platformPosts.length < 5) return null; // Need minimum data

  const engByHour = Array(24).fill(0);
  const cntByHour = Array(24).fill(0);

  for (const p of platformPosts) {
    const h = new Date(p.createdAt).getHours();
    engByHour[h] += (p.likeCount ?? 0) + (p.repostCount ?? 0);
    cntByHour[h]++;
  }

  const avgByHour = engByHour.map((e, i) => cntByHour[i] > 0 ? e / cntByHour[i] : 0);
  const bestHour = avgByHour.indexOf(Math.max(...avgByHour));
  const avgEngagement = avgByHour[bestHour];

  if (avgEngagement === 0) return null;

  return { platform, bestHour, avgEngagement };
}

/** Format hour as readable time */
export function formatHour(hour: number): string {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `${h}:00 ${ampm}`;
}
