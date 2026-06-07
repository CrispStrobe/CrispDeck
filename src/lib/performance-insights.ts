/**
 * Post performance insights — pattern analysis from archive data.
 * Identifies what content types perform best without AI.
 */

import type { UnifiedPost } from './types';

export interface PerformanceInsight {
  category: string;
  description: string;
  metric: string;
  value: number;
  comparison?: number; // baseline for comparison
  multiplier?: number; // how much better than average
}

/**
 * Analyze posts and produce actionable insights.
 */
export function analyzePerformance(posts: UnifiedPost[]): PerformanceInsight[] {
  if (posts.length < 10) return [];

  const insights: PerformanceInsight[] = [];
  const avgEngagement = posts.reduce((s, p) => s + (p.likeCount ?? 0) + (p.repostCount ?? 0), 0) / posts.length;

  // Image vs text analysis
  const withMedia = posts.filter(p => p.embeds && (Array.isArray(p.embeds) ? (p.embeds as any[]).length > 0 : true));
  const withoutMedia = posts.filter(p => !p.embeds || (Array.isArray(p.embeds) && (p.embeds as any[]).length === 0));

  if (withMedia.length >= 5 && withoutMedia.length >= 5) {
    const mediaAvg = withMedia.reduce((s, p) => s + (p.likeCount ?? 0) + (p.repostCount ?? 0), 0) / withMedia.length;
    const textAvg = withoutMedia.reduce((s, p) => s + (p.likeCount ?? 0) + (p.repostCount ?? 0), 0) / withoutMedia.length;
    const multiplier = textAvg > 0 ? mediaAvg / textAvg : 1;

    if (multiplier > 1.2) {
      insights.push({
        category: 'media',
        description: `Posts with media get ${multiplier.toFixed(1)}x more engagement than text-only`,
        metric: 'engagement',
        value: mediaAvg,
        comparison: textAvg,
        multiplier,
      });
    } else if (multiplier < 0.8) {
      insights.push({
        category: 'media',
        description: `Text-only posts outperform media posts by ${(1 / multiplier).toFixed(1)}x`,
        metric: 'engagement',
        value: textAvg,
        comparison: mediaAvg,
        multiplier: 1 / multiplier,
      });
    }
  }

  // Length analysis
  const short = posts.filter(p => p.text.length <= 100);
  const medium = posts.filter(p => p.text.length > 100 && p.text.length <= 250);
  const long = posts.filter(p => p.text.length > 250);

  const avgByLength = [
    { label: 'short (≤100)', posts: short },
    { label: 'medium (100-250)', posts: medium },
    { label: 'long (>250)', posts: long },
  ].filter(g => g.posts.length >= 3).map(g => ({
    label: g.label,
    avg: g.posts.reduce((s, p) => s + (p.likeCount ?? 0) + (p.repostCount ?? 0), 0) / g.posts.length,
    count: g.posts.length,
  }));

  if (avgByLength.length >= 2) {
    const best = avgByLength.reduce((a, b) => a.avg > b.avg ? a : b);
    if (best.avg > avgEngagement * 1.3) {
      insights.push({
        category: 'length',
        description: `Your ${best.label} posts perform best (${best.avg.toFixed(1)} avg engagement)`,
        metric: 'engagement',
        value: best.avg,
        comparison: avgEngagement,
        multiplier: best.avg / avgEngagement,
      });
    }
  }

  // Time-of-day analysis
  const hourlyEng: number[] = Array(24).fill(0);
  const hourlyCnt: number[] = Array(24).fill(0);
  posts.forEach(p => {
    const h = new Date(p.createdAt).getHours();
    hourlyEng[h] += (p.likeCount ?? 0) + (p.repostCount ?? 0);
    hourlyCnt[h]++;
  });

  const hourlyAvg = hourlyEng.map((e, i) => hourlyCnt[i] > 2 ? e / hourlyCnt[i] : 0);
  const bestHour = hourlyAvg.indexOf(Math.max(...hourlyAvg));
  const bestHourAvg = hourlyAvg[bestHour];

  if (bestHourAvg > avgEngagement * 1.5 && hourlyCnt[bestHour] >= 3) {
    insights.push({
      category: 'timing',
      description: `Posts at ${bestHour}:00 get ${(bestHourAvg / avgEngagement).toFixed(1)}x average engagement`,
      metric: 'engagement',
      value: bestHourAvg,
      comparison: avgEngagement,
      multiplier: bestHourAvg / avgEngagement,
    });
  }

  // Day-of-week analysis
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayEng: number[] = Array(7).fill(0);
  const dayCnt: number[] = Array(7).fill(0);
  posts.forEach(p => {
    const d = new Date(p.createdAt).getDay();
    dayEng[d] += (p.likeCount ?? 0) + (p.repostCount ?? 0);
    dayCnt[d]++;
  });

  const dayAvg = dayEng.map((e, i) => dayCnt[i] > 2 ? e / dayCnt[i] : 0);
  const bestDay = dayAvg.indexOf(Math.max(...dayAvg));
  const bestDayAvg = dayAvg[bestDay];

  if (bestDayAvg > avgEngagement * 1.3 && dayCnt[bestDay] >= 3) {
    insights.push({
      category: 'timing',
      description: `${dayNames[bestDay]}s are your best day (${bestDayAvg.toFixed(1)} avg engagement)`,
      metric: 'engagement',
      value: bestDayAvg,
      comparison: avgEngagement,
      multiplier: bestDayAvg / avgEngagement,
    });
  }

  // Platform comparison
  const byPlatform = new Map<string, UnifiedPost[]>();
  posts.forEach(p => {
    const list = byPlatform.get(p.platform) ?? [];
    list.push(p);
    byPlatform.set(p.platform, list);
  });

  if (byPlatform.size >= 2) {
    const platformAvgs = [...byPlatform.entries()].map(([platform, psts]) => ({
      platform,
      avg: psts.reduce((s, p) => s + (p.likeCount ?? 0) + (p.repostCount ?? 0), 0) / psts.length,
    }));
    const best = platformAvgs.reduce((a, b) => a.avg > b.avg ? a : b);
    const worst = platformAvgs.reduce((a, b) => a.avg < b.avg ? a : b);

    if (best.avg > worst.avg * 1.5 && worst.avg > 0) {
      insights.push({
        category: 'platform',
        description: `${best.platform} gets ${(best.avg / worst.avg).toFixed(1)}x more engagement than ${worst.platform}`,
        metric: 'engagement',
        value: best.avg,
        comparison: worst.avg,
        multiplier: best.avg / worst.avg,
      });
    }
  }

  // Hashtag analysis
  const withHashtags = posts.filter(p => p.text.includes('#'));
  const withoutHashtags = posts.filter(p => !p.text.includes('#'));

  if (withHashtags.length >= 5 && withoutHashtags.length >= 5) {
    const hashAvg = withHashtags.reduce((s, p) => s + (p.likeCount ?? 0) + (p.repostCount ?? 0), 0) / withHashtags.length;
    const noHashAvg = withoutHashtags.reduce((s, p) => s + (p.likeCount ?? 0) + (p.repostCount ?? 0), 0) / withoutHashtags.length;

    if (hashAvg > noHashAvg * 1.3) {
      insights.push({
        category: 'hashtags',
        description: `Posts with hashtags get ${(hashAvg / noHashAvg).toFixed(1)}x more engagement`,
        metric: 'engagement',
        value: hashAvg,
        comparison: noHashAvg,
        multiplier: hashAvg / noHashAvg,
      });
    }
  }

  return insights.sort((a, b) => (b.multiplier ?? 1) - (a.multiplier ?? 1));
}
