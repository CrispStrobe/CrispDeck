/**
 * Groups notifications by post + type, collapsing e.g. "12 people liked your post"
 * into a single entry with an expandable actor list.
 */

import type { Platform } from '$lib/types';

export interface UnifiedNotification {
  id: string;
  platform: Platform;
  type: string;
  createdAt: string;
  author: { handle: string; displayName?: string; avatar?: string };
  text?: string;
  postUri?: string;
}

export interface NotificationGroup {
  /** Stable key for {#each} — first notification's id */
  id: string;
  /** Normalized type: 'like' | 'repost' | 'follow' | 'mention' | 'reply' | 'quote' | other */
  type: string;
  /** All actors who triggered this notification */
  actors: { handle: string; displayName?: string; avatar?: string; platform: Platform }[];
  /** The post this notification is about (undefined for follows) */
  postUri?: string;
  /** Preview text of the post or notification */
  text?: string;
  /** Timestamp of the most recent notification in the group */
  latestAt: string;
  /** Platforms involved in this group */
  platforms: Set<Platform>;
}

/** Normalize Mastodon notification types to unified types */
function normalizeType(type: string): string {
  switch (type) {
    case 'favourite': return 'like';
    case 'reblog': return 'repost';
    default: return type;
  }
}

/** Types that should be grouped by post (likes/reposts on the same post) */
const GROUPABLE_TYPES = new Set(['like', 'favourite', 'repost', 'reblog']);

/** Types that should be grouped without a post (follows) */
const FOLLOW_TYPES = new Set(['follow']);

/**
 * Group a flat list of notifications into collapsed groups.
 *
 * Grouping rules:
 * - Likes/favourites on the same post → one group
 * - Reposts/reblogs on the same post → one group
 * - Follows → one group (all new followers collapsed)
 * - Mentions, replies, quotes → NOT grouped (each is its own entry)
 */
export function groupNotifications(notifications: UnifiedNotification[]): NotificationGroup[] {
  const groups: Map<string, NotificationGroup> = new Map();

  for (const notif of notifications) {
    const normType = normalizeType(notif.type);
    let groupKey: string;

    if (FOLLOW_TYPES.has(notif.type)) {
      groupKey = 'follow';
    } else if (GROUPABLE_TYPES.has(notif.type) && notif.postUri) {
      groupKey = `${normType}:${notif.postUri}`;
    } else {
      // Mentions, replies, quotes — each is unique
      groupKey = `unique:${notif.id}`;
    }

    const existing = groups.get(groupKey);
    if (existing) {
      // Add actor if not already present (dedup by handle)
      if (!existing.actors.some(a => a.handle === notif.author.handle && a.platform === notif.platform)) {
        existing.actors.push({ ...notif.author, platform: notif.platform });
      }
      existing.platforms.add(notif.platform);
      // Keep the most recent timestamp
      if (notif.createdAt > existing.latestAt) {
        existing.latestAt = notif.createdAt;
      }
      // Keep text if we don't have one yet
      if (!existing.text && notif.text) {
        existing.text = notif.text;
      }
    } else {
      groups.set(groupKey, {
        id: notif.id,
        type: normType,
        actors: [{ ...notif.author, platform: notif.platform }],
        postUri: notif.postUri,
        text: notif.text,
        latestAt: notif.createdAt,
        platforms: new Set([notif.platform]),
      });
    }
  }

  // Sort by most recent first
  return [...groups.values()].sort((a, b) =>
    new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime()
  );
}
