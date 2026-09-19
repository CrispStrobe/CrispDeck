/**
 * Conversation list model.
 *
 * These types and rules lived inside the messages page, where nothing could
 * import them, so the tests kept their own copies.
 */
import type { Platform } from '$lib/types';

export interface Conversation {
  id: string;
  platform: Platform;
  participant: { handle: string; displayName?: string; avatar?: string };
  lastMessage?: string;
  lastDate?: string;
  unread: boolean;
}

export interface Message {
  id: string;
  text: string;
  sender: { handle: string; displayName?: string; avatar?: string };
  createdAt: string;
  isOurs: boolean;
}

/** How many conversations are waiting, for the nav badge. */
export function countUnread(conversations: Conversation[]): number {
  return conversations.filter((c) => c.unread).length;
}

/**
 * Most recent first. A conversation with no date sorts last rather than
 * jumping to the top, which is what comparing undefined would do.
 */
export function sortByRecent(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => (b.lastDate ?? '').localeCompare(a.lastDate ?? ''));
}

/**
 * Which network a typed handle belongs to.
 *
 * Mastodon handles carry an @; Bluesky handles are bare domains. Note this
 * treats anything with an @ as Mastodon, so a Bluesky handle typed with a
 * leading @ would be misread — clean it with cleanBskyHandle first.
 */
export function inferPlatformFromHandle(handle: string): Platform {
  return handle.includes('@') ? 'mastodon' : 'bluesky';
}

/**
 * Compact age for a conversation row: minutes, then hours, then a date.
 *
 * Deliberately not $lib/time-format's relativeTime — this one has no "now"
 * bucket and no day counter, because a conversation list shows fewer, older
 * entries than a timeline does.
 */
export function formatConversationTime(dateStr: string, now: number = Date.now()): string {
  const d = new Date(dateStr);
  const diff = now - d.getTime();
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
