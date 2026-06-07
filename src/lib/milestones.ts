/**
 * Engagement milestones — detect when posts hit engagement thresholds.
 * Uses engagement-history snapshots and notification-alerts.
 */

import { triggerAlert } from './notification-alerts';

const STORAGE_KEY = 'crispdeck-milestones';

export interface MilestoneConfig {
  enabled: boolean;
  thresholds: number[]; // e.g. [10, 50, 100, 500, 1000]
}

export interface ReachedMilestone {
  uri: string;
  metric: 'likes' | 'reposts' | 'replies' | 'total';
  threshold: number;
  actualValue: number;
  reachedAt: string;
}

const DEFAULT_CONFIG: MilestoneConfig = {
  enabled: true,
  thresholds: [10, 50, 100, 500, 1000],
};

export function getMilestoneConfig(): MilestoneConfig {
  const raw = localStorage.getItem(STORAGE_KEY + '-config');
  if (!raw) return { ...DEFAULT_CONFIG };
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }; } catch { return { ...DEFAULT_CONFIG }; }
}

export function setMilestoneConfig(config: Partial<MilestoneConfig>): void {
  const current = getMilestoneConfig();
  localStorage.setItem(STORAGE_KEY + '-config', JSON.stringify({ ...current, ...config }));
}

/** Get all milestones that have been reached (and notified) */
function getReachedMilestones(): ReachedMilestone[] {
  const raw = localStorage.getItem(STORAGE_KEY + '-reached');
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function saveReachedMilestones(milestones: ReachedMilestone[]): void {
  localStorage.setItem(STORAGE_KEY + '-reached', JSON.stringify(milestones));
}

function hasReached(uri: string, metric: string, threshold: number): boolean {
  return getReachedMilestones().some(
    m => m.uri === uri && m.metric === metric && m.threshold === threshold
  );
}

/**
 * Check a post's current engagement against thresholds.
 * Returns any NEW milestones that were just reached.
 * Triggers alerts for new milestones.
 */
export function checkMilestones(post: {
  uri: string;
  text: string;
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
}): ReachedMilestone[] {
  const config = getMilestoneConfig();
  if (!config.enabled) return [];

  const newMilestones: ReachedMilestone[] = [];
  const checks: Array<{ metric: 'likes' | 'reposts' | 'total'; value: number }> = [
    { metric: 'likes', value: post.likeCount ?? 0 },
    { metric: 'reposts', value: post.repostCount ?? 0 },
    { metric: 'total', value: (post.likeCount ?? 0) + (post.repostCount ?? 0) + (post.replyCount ?? 0) },
  ];

  for (const { metric, value } of checks) {
    for (const threshold of config.thresholds) {
      if (value >= threshold && !hasReached(post.uri, metric, threshold)) {
        const milestone: ReachedMilestone = {
          uri: post.uri,
          metric,
          threshold,
          actualValue: value,
          reachedAt: new Date().toISOString(),
        };
        newMilestones.push(milestone);
      }
    }
  }

  if (newMilestones.length > 0) {
    const reached = getReachedMilestones();
    reached.push(...newMilestones);
    // Keep only last 500 milestones
    saveReachedMilestones(reached.slice(-500));

    // Trigger alerts for the highest milestone per metric
    const bestMilestone = newMilestones.reduce((best, m) =>
      m.threshold > best.threshold ? m : best
    );
    const preview = post.text.substring(0, 60);
    triggerAlert(
      `${bestMilestone.threshold}+ ${bestMilestone.metric}!`,
      `"${preview}..." reached ${bestMilestone.actualValue} ${bestMilestone.metric}`,
    );
  }

  return newMilestones;
}

/** Get recent milestones for display */
export function getRecentMilestones(limit = 20): ReachedMilestone[] {
  return getReachedMilestones()
    .sort((a, b) => b.reachedAt.localeCompare(a.reachedAt))
    .slice(0, limit);
}
